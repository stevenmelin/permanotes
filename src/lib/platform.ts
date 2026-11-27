// Bridge to the desktop shell (Electron preload). On iPhone / browser, falls back to downloads and file pickers.
export interface OpenedFile { name: string; bytes: Uint8Array }
export interface DesktopBridge {
  saveFile(defaultName: string, bytes: Uint8Array): Promise<string | null>;
  pendingFiles(): Promise<OpenedFile[]>;
  onOpenFile(cb: (f: OpenedFile) => void): void;
  writeBackup(name: string, bytes: Uint8Array, keep: number): Promise<string>;
  openAttachment(name: string, bytes: Uint8Array): Promise<void>;
  backupFolder(): Promise<string>;
  showBackupFolder(): Promise<void>;
  version(): Promise<string>;
  onMenu(cb: (id: string) => void): void;
  openNoteWindow(noteId: string, screenX: number, screenY: number): Promise<void>;
  /** a note/tab drag ended; opens note windows if it was dropped outside this window. True if it did. */
  dragEnded(noteIds: string[]): Promise<boolean>;
}

declare global { interface Window { permanotes?: DesktopBridge } }

export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? window.permanotes : undefined;
export const isDesktop = !!desktop;
export const APP_VERSION = __APP_VERSION__;
// Set when this window was opened to show one note (dragged out of the main window)
export const SOLO_NOTE: string | null = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('note') : null;

export async function saveBytes(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): Promise<string | null> {
  if (desktop) return desktop.saveFile(name, bytes);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  // iPhone: the share sheet lets you "Save to Files"
  const file = new File([blob], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && nav.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return name; } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.click();
  });
}

export async function openAttachmentBlob(name: string, blob: Blob) {
  if (desktop) { await desktop.openAttachment(name, new Uint8Array(await blob.arrayBuffer())); return; }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 300_000);
}
