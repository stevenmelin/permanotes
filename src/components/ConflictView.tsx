import { useMemo, useState } from 'react';
import { diffLines, linesOf, summaryText, type Row } from '../lib/diff';
import * as store from '../lib/store';
import type { Note } from '../lib/types';

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(); };

// Side-by-side review of a note that was changed in two places.
export function ConflictView({ note, index, run, onDone }: { note: Note; index: number; run: (l: string, f: () => Promise<unknown>) => Promise<void>; onDone: () => void }) {
  const c = note.conflicts![index];
  const total = note.conflicts!.length;
  const { rows, summary } = useMemo(() => {
    const p = new DOMParser();
    const r = diffLines(linesOf(note.html, p), linesOf(c.html, p));
    r.summary.titleChanged = note.title !== c.title;
    return r;
  }, [note.html, note.title, c.html, c.title]);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const cell = (r: Row, side: 'left' | 'right') => {
    if (r.kind === 'fold') return null;
    if (r.kind === 'same') return <div className="cv-line" dangerouslySetInnerHTML={{ __html: r.left.html || '&nbsp;' }} />;
    if (r.kind === 'removed') return side === 'left' ? <div className="cv-line cv-only" dangerouslySetInnerHTML={{ __html: r.left.html || '&nbsp;' }} /> : <div className="cv-line cv-gap" />;
    if (r.kind === 'added') return side === 'right' ? <div className="cv-line cv-only" dangerouslySetInnerHTML={{ __html: r.right.html || '&nbsp;' }} /> : <div className="cv-line cv-gap" />;
    // changed: word-level highlights
    return (
      <div className="cv-line cv-changed">
        {r.words.map((w, i) => w.op === 'same' ? <span key={i}>{w.text}</span>
          : side === 'left' ? (w.op === 'del' ? <mark key={i} className="cv-del">{w.text}</mark> : null)
          : (w.op === 'ins' ? <mark key={i} className="cv-ins">{w.text}</mark> : null))}
      </div>
    );
  };

  return (
    <div className="conflict-view">
      <div className="cv-head">
        <div>
          <b>{c.auto ? 'Older version merged automatically' : 'This note was changed in two places'}</b>{total > 1 && <span className="small"> · {index + 1} of {total}</span>}
          <div className="cv-summary">{summaryText(summary)}</div>
        </div>
        <div className="cv-actions">
          <button onClick={() => void run('Keeping current…', async () => { await store.dropConflict(note.id, index); if (total === 1) onDone(); })} title="Keep the note as it is now and discard the other version">✓ Keep current</button>
          <button onClick={() => void run('Using other version…', async () => { await store.useConflictVersion(note.id, index); if (total === 1) onDone(); })} title="Replace the note with the other version">Use other version</button>
          <button onClick={() => void run('Keeping both…', async () => { await store.keepConflictAsCopy(note.id, index); if (total === 1) onDone(); })} title="Keep the other version as a separate note">Keep both</button>
          {c.auto && total > 1 && <button onClick={() => void run('Dismissing…', async () => { for (let i = total - 1; i >= 0; i--) if (note.conflicts![i].auto) await store.dropConflict(note.id, i); onDone(); })}>Dismiss all older versions</button>}
          <button className="cv-later" onClick={onDone} title="Edit the note now and review this later">Review later</button>
        </div>
      </div>
      <div className="cv-cols-head">
        <div><b>Current note</b>{summary.titleChanged && <div className="small">Title: {note.title}</div>}<div className="small">saved {when(note.updated_at)}</div></div>
        <div><b>Other version</b> <span className="small">({c.source})</span>{summary.titleChanged && <div className="small">Title: {c.title}</div>}<div className="small">saved {when(c.at)}</div></div>
      </div>
      <div className="cv-body">
        {rows.map((r, i) => r.kind === 'fold' ? (
          open.has(i)
            ? r.rows.map((rr, k) => <div className="cv-row" key={`${i}-${k}`}>{cell(rr, 'left')}{cell(rr, 'right')}</div>)
            : <button key={i} className="cv-fold" onClick={() => setOpen(new Set(open).add(i))}>⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'} — show</button>
        ) : (
          <div className={`cv-row cv-${r.kind}`} key={i}>{cell(r, 'left')}{cell(r, 'right')}</div>
        ))}
        {rows.length === 0 && <div className="hint">Both versions are empty.</div>}
      </div>
    </div>
  );
}
