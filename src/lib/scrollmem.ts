// Remembers scroll positions on this device only (never synced), so reopening the app lands exactly where you left off.
const KEY = 'pn.scroll';
type Mem = Record<string, { top: number; at: number }>;
let mem: Mem | null = null;
const load = (): Mem => { if (mem) return mem; try { mem = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Mem; } catch { mem = {}; } return mem; };
let timer: ReturnType<typeof setTimeout> | null = null;
const persist = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const m = load();
    const keys = Object.keys(m);
    if (keys.length > 300) keys.sort((a, b) => m[a].at - m[b].at).slice(0, keys.length - 300).forEach((k) => delete m[k]);
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage full: positions just aren't kept */ }
  }, 300);
};
export function saveScroll(key: string, top: number) { load()[key] = { top: Math.round(top), at: Date.now() }; persist(); }
export function getScroll(key: string): number { return load()[key]?.top ?? 0; }
export function flushScroll() { if (timer) { clearTimeout(timer); timer = null; } try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* ignore */ } }
if (typeof window !== 'undefined') { window.addEventListener('beforeunload', flushScroll); window.addEventListener('pagehide', flushScroll); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushScroll(); }); }

// Restore a position, re-applying while images finish loading and the page grows (up to ~2s).
export function restoreScroll(el: HTMLElement, top: number) {
  if (!top) { el.scrollTop = 0; return; }
  let tries = 0;
  const apply = () => {
    el.scrollTop = top;
    if (Math.abs(el.scrollTop - top) > 2 && tries++ < 40) setTimeout(apply, 50);
  };
  apply();
  // late-loading images can still shift things once more
  el.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', () => { if (tries < 40) el.scrollTop = top; }, { once: true }); });
}
