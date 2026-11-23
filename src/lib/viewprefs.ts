// Per-device display settings (stored only on this device, never synced).
const KEY = 'pn.noteZoom';
export const NOTE_ZOOM_MIN = 0.6;
export const NOTE_ZOOM_MAX = 3;
const listeners = new Set<(z: number) => void>();

function defaultZoom(): number {
  // phones start a bit bigger; desktop starts at 100% (Ctrl+wheel zooms the whole desktop app)
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches && !window.permanotes ? 1.25 : 1;
}

export function getNoteZoom(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= NOTE_ZOOM_MIN && v <= NOTE_ZOOM_MAX ? v : defaultZoom();
  } catch { return defaultZoom(); }
}

export function setNoteZoom(z: number) {
  const v = Math.round(Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, z)) * 100) / 100;
  try { localStorage.setItem(KEY, String(v)); } catch { /* storage full/blocked: still applies for this session */ }
  for (const l of listeners) l(v);
}

export function onNoteZoom(fn: (z: number) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// iPhone/iPad: pinch on the page changes note text size only, instead of zooming the whole screen
// (which pushed the menus off screen).
export function installPinchToTextSize() {
  if (typeof document === 'undefined') return;
  let start = 1;
  const opts = { passive: false } as AddEventListenerOptions;
  document.addEventListener('gesturestart', (e) => { e.preventDefault(); start = getNoteZoom(); }, opts);
  document.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const scale = (e as unknown as { scale: number }).scale;
    if (scale) setNoteZoom(start * scale);
  }, opts);
  document.addEventListener('gestureend', (e) => e.preventDefault(), opts);
}
