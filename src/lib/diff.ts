// Line + word diff of two notes, for the side-by-side conflict view. Pure (DOMParser passed in).
export interface Line { text: string; html: string }
export type Row =
  | { kind: 'same'; left: Line; right: Line }
  | { kind: 'changed'; left: Line; right: Line; words: WordOp[] }
  | { kind: 'removed'; left: Line }
  | { kind: 'added'; right: Line }
  | { kind: 'fold'; count: number; rows: Row[] };
export type WordOp = { op: 'same' | 'del' | 'ins'; text: string };
export interface Summary { changed: number; added: number; removed: number; formatOnly: number; titleChanged: boolean }

const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TD', 'TH', 'IMG', 'DIV']);

export function linesOf(html: string, parser: { parseFromString(s: string, t: string): Document }): Line[] {
  const doc = parser.parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const out: Line[] = [];
  const walk = (el: Element, depth: number) => {
    for (const c of Array.from(el.children)) {
      const tag = c.tagName.toUpperCase();
      const isAtt = tag === 'DIV' && c.hasAttribute('data-pn-att');
      if (tag === 'IMG') { out.push({ text: '[image]', html: '<em>[image]</em>' }); continue; }
      if (isAtt) { out.push({ text: `[file: ${c.getAttribute('data-name') ?? ''}]`, html: `<em>[📎 ${esc(c.getAttribute('data-name') ?? '')}]</em>` }); continue; }
      if (BLOCK.has(tag) && tag !== 'DIV' && !c.querySelector('p, h1, h2, h3, h4, h5, h6, pre, table')) {
        const prefix = c.closest('li') ? `${'  '.repeat(Math.max(0, depth - 1))}${c.closest('li[data-checked="true"]') ? '☑ ' : c.closest('li[data-checked]') ? '☐ ' : '• '}` : '';
        const text = prefix + (c.textContent ?? '').replace(/\s+/g, ' ').trim();
        out.push({ text, html: esc(prefix) + c.innerHTML });
        if (c.querySelector('img')) out.push({ text: '[image]', html: '<em>[image]</em>' });
        continue;
      }
      walk(c, depth + (tag === 'UL' || tag === 'OL' ? 1 : 0));
    }
  };
  walk(doc.body, 0);
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length, m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

export function wordDiff(a: string, b: string): WordOp[] {
  const wa = a.split(/(\s+)/).filter(Boolean), wb = b.split(/(\s+)/).filter(Boolean);
  const pairs = lcs(wa, wb, (x, y) => x === y);
  const ops: WordOp[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [wa.length, wb.length] as [number, number]]) {
    if (i < pi) ops.push({ op: 'del', text: wa.slice(i, pi).join('') });
    if (j < pj) ops.push({ op: 'ins', text: wb.slice(j, pj).join('') });
    if (pi < wa.length) ops.push({ op: 'same', text: wa[pi] });
    i = pi + 1; j = pj + 1;
  }
  return ops;
}

function similar(a: string, b: string): boolean {
  const wa = a.toLowerCase().split(/\W+/).filter(Boolean), wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (!wa.length || !wb.size) return false;
  const common = wa.filter((w) => wb.has(w)).length;
  return (2 * common) / (wa.length + wb.size) >= 0.4;
}

/** left = version on the left (current note), right = the other version */
export function diffLines(left: Line[], right: Line[]): { rows: Row[]; summary: Summary } {
  const pairs = lcs(left, right, (x, y) => x.text === y.text);
  const raw: Row[] = [];
  const summary: Summary = { changed: 0, added: 0, removed: 0, formatOnly: 0, titleChanged: false };
  let i = 0, j = 0;
  const flushGap = (ie: number, je: number) => {
    const dels = left.slice(i, ie), ins = right.slice(j, je);
    // pair lines side by side as "changed" only when they are clearly the same line edited
    let x = 0, y = 0;
    while (x < dels.length || y < ins.length) {
      if (x < dels.length && y < ins.length && similar(dels[x].text, ins[y].text)) {
        raw.push({ kind: 'changed', left: dels[x], right: ins[y], words: wordDiff(dels[x].text, ins[y].text) }); summary.changed++; x++; y++;
      } else if (x < dels.length && (y >= ins.length || !ins.slice(y).some((l) => similar(dels[x].text, l.text)))) {
        raw.push({ kind: 'removed', left: dels[x++] }); summary.removed++;
      } else {
        raw.push({ kind: 'added', right: ins[y++] }); summary.added++;
      }
    }
  };
  for (const [pi, pj] of pairs) {
    flushGap(pi, pj);
    const same = left[pi].html.replace(/\s+/g, ' ') === right[pj].html.replace(/\s+/g, ' ');
    if (same) raw.push({ kind: 'same', left: left[pi], right: right[pj] });
    else { raw.push({ kind: 'changed', left: left[pi], right: right[pj], words: [{ op: 'same', text: left[pi].text }] }); summary.formatOnly++; }
    i = pi + 1; j = pj + 1;
  }
  flushGap(left.length, right.length);
  // fold long runs of unchanged lines, keeping 2 lines of context around each change
  const rows: Row[] = [];
  let run: Row[] = [];
  const flushRun = (atEnd: boolean, atStart: boolean) => {
    const keepHead = atStart ? 0 : 2, keepTail = atEnd ? 0 : 2;
    if (run.length > keepHead + keepTail + 2) {
      rows.push(...run.slice(0, keepHead));
      const hidden = run.slice(keepHead, run.length - keepTail);
      rows.push({ kind: 'fold', count: hidden.length, rows: hidden });
      rows.push(...run.slice(run.length - keepTail));
    } else rows.push(...run);
    run = [];
  };
  raw.forEach((r) => { if (r.kind === 'same') run.push(r); else { flushRun(false, rows.length === 0); rows.push(r); } });
  flushRun(true, rows.length === 0);
  return { rows, summary };
}

export function summaryText(s: Summary): string {
  const parts: string[] = [];
  if (s.titleChanged) parts.push('title differs');
  if (s.changed > 0) parts.push(`${s.changed} line${s.changed === 1 ? '' : 's'} changed`);
  if (s.added) parts.push(`${s.added} line${s.added === 1 ? '' : 's'} only in the other version`);
  if (s.removed) parts.push(`${s.removed} line${s.removed === 1 ? '' : 's'} only in the current note`);
  if (s.formatOnly) parts.push(`${s.formatOnly} formatting-only change${s.formatOnly === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'No visible differences';
}
