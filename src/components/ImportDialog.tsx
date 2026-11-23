import { useState } from 'react';
import { importOneNoteExport, type ImportReport } from '../lib/onenoteImport';
import { importPn } from '../lib/pnio';
import { pickFiles } from '../lib/platform';
import { errText } from '../lib/util';

export function ImportDialog({ onClose, onError, onDone, targetFolder }: { onClose: () => void; onError: (m: string) => void; onDone: (m: string) => void; targetFolder: string | null }) {
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fatal, setFatal] = useState('');

  const oneNote = async () => {
    const [f] = await pickFiles('.zip,application/zip');
    if (!f) return;
    setFatal(''); setReport(null); setProgress({ done: 0, total: 1, label: 'Opening zip…' });
    try {
      const r = await importOneNoteExport(await f.arrayBuffer(), (done, total, label) => setProgress({ done, total, label }));
      setReport(r);
      onDone(`Imported ${r.notes} OneNote pages.`);
    } catch (e) {
      setFatal(errText(e)); onError(`OneNote import failed: ${errText(e)}`);
    } finally { setProgress(null); }
  };

  const pn = async () => {
    const files = await pickFiles('.pn', true);
    for (const f of files) {
      try { onDone(await importPn(await f.arrayBuffer(), targetFolder)); } catch (e) { onError(`Opening ${f.name} failed: ${errText(e)}`); }
    }
    if (files.length) onClose();
  };

  const pct = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;
  return (
    <div className="modal-back" onClick={() => { if (!progress) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Import</h2>{!progress && <button onClick={onClose}>Close</button>}</div>
        {!progress && !report && (
          <>
            <button className="big" onClick={() => void oneNote()}>From OneNote…<span>Choose “OneNote Export.zip” made by the Export My OneNote tool</span></button>
            <button className="big" onClick={() => void pn()}>Open .pn file…<span>A note, folder, or whole library saved from PermaNotes</span></button>
            <p className="small">Importing the same OneNote export twice creates duplicates.</p>
          </>
        )}
        {progress && (
          <div>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <p>{pct}% — page {progress.done} of {progress.total}</p>
            <p className="small">{progress.label}</p>
            <p className="small">Keep this window open until it finishes.</p>
          </div>
        )}
        {fatal && <pre className="err">{fatal}</pre>}
        {report && (
          <div>
            <p><b>Done.</b> {report.notes} pages, {report.folders} folders, {report.attachments} images/attachments.</p>
            {report.failures.length > 0 && (
              <details open><summary className="err">{report.failures.length} problem(s) — these did NOT import</summary>
                {report.failures.map((x, i) => <pre key={i} className="err">{x}</pre>)}
              </details>
            )}
            {report.warnings.length > 0 && (
              <details><summary>{report.warnings.length} note(s)</summary>
                {report.warnings.map((x, i) => <pre key={i}>{x}</pre>)}
              </details>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
