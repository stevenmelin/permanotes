import * as db from './db';
import type { AttachmentMeta, Folder, Note, NoteConflict } from './types';
import { conflictFrom, copyBase, newer, sameContent } from './conflict';
import { now, uid } from './util';

// In-memory mirror of the local database. Every change is written to IndexedDB first, then
// marked dirty so the sync engine pushes it.

export const state = {
  folders: new Map<string, Folder>(),
  notes: new Map<string, Note>(),
  attachments: new Map<string, AttachmentMeta>(),
  loaded: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
export const subscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getVersion = () => version;
let changeHook: () => void = () => {};
export const onLocalChange = (fn: () => void) => { changeHook = fn; };

export function emit() {
  version++;
  for (const l of listeners) l();
}

export async function load() {
  const [f, n, a] = await Promise.all([
    db.getAll<Folder>('folders'), db.getAll<Note>('notes'), db.getAll<AttachmentMeta>('attachments'),
  ]);
  state.folders = new Map(f.map((x) => [x.id, x]));
  state.notes = new Map(n.map((x) => [x.id, x]));
  state.attachments = new Map(a.map((x) => [x.id, x]));
  state.loaded = true;
  emit();
}

async function saveLocal(kind: 'folders', items: Folder[], fromSync?: boolean): Promise<void>;
async function saveLocal(kind: 'notes', items: Note[], fromSync?: boolean): Promise<void>;
async function saveLocal(kind: 'attachments', items: AttachmentMeta[], fromSync?: boolean): Promise<void>;
async function saveLocal(kind: 'folders' | 'notes' | 'attachments', items: (Folder | Note | AttachmentMeta)[], fromSync = false) {
  if (!items.length) return;
  await db.putMany(kind, items);
  const map = state[kind] as Map<string, Folder | Note | AttachmentMeta>;
  for (const it of items) map.set(it.id, it);
  emit();
  if (!fromSync) changeHook();
  // keep other PermaNotes windows on this device (side-by-side note windows) in step
  try { channel?.postMessage({ kind, items, fromSync }); } catch (e) { console.error('Could not tell other windows about a change:', e); }
}

// Other windows on this device share the same local database; this mirrors their changes into memory.
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('permanotes-store') : null;
if (channel) {
  channel.onmessage = (ev: MessageEvent<{ kind: 'folders' | 'notes' | 'attachments'; items: (Folder | Note | AttachmentMeta)[]; fromSync: boolean }>) => {
    const { kind, items, fromSync } = ev.data;
    const map = state[kind] as Map<string, Folder | Note | AttachmentMeta>;
    for (const it of items) map.set(it.id, it);
    emit();
    if (!fromSync) changeHook(); // the main window uploads edits made in other windows
  };
}
export { saveLocal };

// ---------- folders ----------
export async function createFolder(name: string, parent_id: string | null): Promise<Folder> {
  const siblings = [...state.folders.values()].filter((f) => !f.deleted && f.parent_id === parent_id);
  const f: Folder = { id: uid(), parent_id, name, sort: siblings.length, updated_at: now(), deleted: false, dirty: true, synced_at: null };
  await saveLocal('folders', [f]);
  return f;
}

export async function updateFolder(id: string, patch: Partial<Folder>) {
  const f = state.folders.get(id);
  if (!f) throw new Error(`Folder ${id} not found`);
  await saveLocal('folders', [{ ...f, ...patch, updated_at: now(), dirty: true }]);
}

export function descendantFolderIds(id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const f of state.folders.values()) if (f.parent_id === out[i] && !f.deleted) out.push(f.id);
  }
  return out;
}

/** Delete a folder (and its subfolders). keepNotes: notes go back to the main list; otherwise they go to Trash. */
export async function deleteFolder(id: string, keepNotes = false) {
  const ids = descendantFolderIds(id);
  const t = now();
  const folders = ids.map((fid) => ({ ...state.folders.get(fid)!, deleted: true, updated_at: t, dirty: true }));
  const notes = [...state.notes.values()].filter((n) => n.folder_id && ids.includes(n.folder_id) && !n.deleted)
    .map((n) => (keepNotes ? { ...n, folder_id: null, updated_at: t, dirty: true } : { ...n, deleted: true, pinned: null, updated_at: t, dirty: true }));
  await saveLocal('notes', notes);
  await saveLocal('folders', folders);
  if (!keepNotes) await renumberPins();
}

export async function moveNotesToFolder(ids: string[], folderId: string | null) {
  await updateNotes(ids.map((id) => ({ id, patch: { folder_id: folderId } })));
}

// The OneNote import (before 1.0.12) put every note in "Notebook / Section" folders. Those folders are
// removed and their notes moved to the main list. Only folders made by the import qualify: created before
// this version and holding nothing but OneNote pages — folders you make yourself are never touched.
const IMPORT_FOLDER_CUTOFF = '2026-11-27T16:00:00.000Z';
export async function flattenImportedFolders(): Promise<number> {
  const live = liveFolders();
  let moved = 0;
  for (const top of live.filter((f) => !f.parent_id)) {
    const ids = descendantFolderIds(top.id);
    const subtree = ids.map((i) => state.folders.get(i)!).filter((f) => !f.deleted);
    if (subtree.some((f) => normIso(f.updated_at) >= IMPORT_FOLDER_CUTOFF)) continue;
    const notes = liveNotes().filter((n) => n.folder_id && ids.includes(n.folder_id));
    if (!notes.length || notes.some((n) => !n.tags.includes('onenote'))) continue;
    const t = now();
    await saveLocal('notes', notes.map((n) => ({ ...n, folder_id: null, updated_at: t, dirty: true })));
    await saveLocal('folders', subtree.map((f) => ({ ...f, deleted: true, updated_at: t, dirty: true })));
    moved += notes.length;
  }
  return moved;
}
const normIso = (s: string) => { const d = Date.parse(s.replace(/(\.\d{3})\d+/, '$1')); return Number.isNaN(d) ? s : new Date(d).toISOString(); };

// ---------- notes ----------
export async function createNote(folder_id: string | null, title = '', html = '<p></p>', tags: string[] = []): Promise<Note> {
  const t = now();
  const n: Note = { id: uid(), folder_id, title, html, tags, sort: minSort() - 1, pinned: null, created_at: t, updated_at: t, deleted: false, dirty: true, synced_at: null };
  await saveLocal('notes', [n]);
  return n;
}

// New notes go to the top of the custom order
function minSort() { let m = 0; for (const n of state.notes.values()) if (!n.deleted && n.sort < m) m = n.sort; return m; }

export async function updateNote(id: string, patch: Partial<Note>) {
  const n = state.notes.get(id);
  if (!n) throw new Error(`Note ${id} not found`);
  await saveLocal('notes', [{ ...n, ...patch, updated_at: now(), dirty: true }]);
}

// Save several notes at once (pinning, reordering, moving)
export async function updateNotes(changes: { id: string; patch: Partial<Note> }[]) {
  const t = now();
  const out: Note[] = [];
  for (const { id, patch } of changes) {
    const n = state.notes.get(id);
    if (!n) throw new Error(`Note ${id} not found`);
    out.push({ ...n, ...patch, updated_at: t, dirty: true });
  }
  await saveLocal('notes', out);
}

export const isPinned = (n: Note) => n.pinned != null;

export async function pinNotes(ids: string[], pin: boolean) {
  const pinned = liveNotes().filter(isPinned).sort((a, b) => a.pinned! - b.pinned!);
  if (pin) {
    let next = pinned.length ? pinned[pinned.length - 1].pinned! + 1 : 1;
    await updateNotes(ids.filter((id) => !isPinned(state.notes.get(id)!)).map((id) => ({ id, patch: { pinned: next++ } })));
  } else {
    await updateNotes(ids.filter((id) => isPinned(state.notes.get(id)!)).map((id) => ({ id, patch: { pinned: null } })));
  }
  await renumberPins();
}

// Keep pin numbers 1, 2, 3… with no gaps
export async function renumberPins(order?: string[]) {
  const pinned = order ?? liveNotes().filter(isPinned).sort((a, b) => a.pinned! - b.pinned!).map((n) => n.id);
  const changes = pinned.map((id, i) => ({ id, patch: { pinned: i + 1 } })).filter((c) => state.notes.get(c.id)!.pinned !== c.patch.pinned);
  if (changes.length) await updateNotes(changes);
}

// Place `moving` notes between `before` and `after` in a list ordered by `sort`.
// `list` is the full visible order (without the moving notes) so ties can be renumbered.
export async function placeNotes(moving: string[], list: Note[], index: number, extra: Partial<Note> = {}) {
  const prev = list[index - 1];
  const next = list[index];
  let changes: { id: string; patch: Partial<Note> }[];
  const lo = prev ? prev.sort : (next ? next.sort - moving.length - 1 : 0);
  const hi = next ? next.sort : lo + moving.length + 1;
  if (hi - lo > 1e-6 * (moving.length + 1)) {
    const step = (hi - lo) / (moving.length + 1);
    changes = moving.map((id, i) => ({ id, patch: { ...extra, sort: lo + step * (i + 1) } }));
  } else {
    // ties: renumber the whole visible list
    const ids = [...list.slice(0, index).map((n) => n.id), ...moving, ...list.slice(index).map((n) => n.id)];
    changes = ids.map((id, i) => ({ id, patch: moving.includes(id) ? { ...extra, sort: i } : { sort: i } }))
      .filter((c) => moving.includes(c.id) || state.notes.get(c.id)!.sort !== c.patch.sort);
  }
  await updateNotes(changes);
}

// ---------- conflicts ----------
// Review finished: drop the first conflict. Local only — nothing to upload.
export async function dropConflict(id: string, index = 0) {
  const n = state.notes.get(id);
  if (!n) throw new Error(`Note ${id} not found`);
  const conflicts = (n.conflicts ?? []).filter((_, i) => i !== index);
  await saveLocal('notes', [{ ...n, conflicts }], true);
}
export async function useConflictVersion(id: string, index = 0) {
  const n = state.notes.get(id)!;
  const c = n.conflicts![index];
  const conflicts = n.conflicts!.filter((_, i) => i !== index);
  await saveLocal('notes', [{ ...n, title: c.title, html: c.html, conflicts, updated_at: now(), dirty: true }]);
}
export async function keepConflictAsCopy(id: string, index = 0) {
  const n = state.notes.get(id)!;
  const c = n.conflicts![index];
  await createNote(n.folder_id, `${c.title || 'Untitled'} (other version)`, c.html, n.tags);
  await dropConflict(id, index);
}

// Fold the separate "(conflict copy)" notes made by 1.0.0–1.0.5 back into their original note.
// The newest version becomes the note; the other one is kept for review (as an auto-merged version).
export async function mergeOldConflictCopies(): Promise<number> {
  let merged = 0;
  const live = liveNotes();
  // oldest copies first so the newest version ends up on top
  const copies = live.filter((n) => copyBase(n.title) !== null).sort((a, b) => (newer(a.updated_at, b.updated_at) ? 1 : -1));
  for (const copy of copies) {
    const base = copyBase(copy.title)!;
    const orig = liveNotes().find((n) => n.id !== copy.id && n.folder_id === copy.folder_id && n.title === base);
    if (!orig) continue;
    const t = now();
    const asOrigTitle = { ...copy, title: base };
    const conflicts: NoteConflict[] = [...(orig.conflicts ?? [])];
    let updated: Note;
    if (sameContent(asOrigTitle, orig)) {
      updated = orig; // identical: just remove the duplicate
    } else if (newer(copy.updated_at, orig.updated_at)) {
      conflicts.push({ ...conflictFrom(orig, 'older version (auto-merged)', true) });
      updated = { ...orig, html: copy.html, updated_at: t, dirty: true };
    } else {
      conflicts.push({ ...conflictFrom(asOrigTitle, 'older version (auto-merged)', true) });
      updated = orig;
    }
    await saveLocal('notes', [{ ...updated, conflicts }, { ...copy, deleted: true, pinned: null, updated_at: t, dirty: true }]);
    merged++;
  }
  if (merged) await renumberPins();
  return merged;
}

// ---------- attachments ----------
export async function addAttachment(blob: Blob, name: string, mime: string, note_id: string | null, id = uid()): Promise<AttachmentMeta> {
  await db.putBlob(id, blob);
  const t = now();
  const a: AttachmentMeta = { id, note_id, name, mime, size: blob.size, created_at: t, updated_at: t, deleted: false, dirty: true, synced_at: null, has_blob: true };
  await saveLocal('attachments', [a]);
  return a;
}

export function liveFolders() { return [...state.folders.values()].filter((f) => !f.deleted); }
export function liveNotes() { return [...state.notes.values()].filter((n) => !n.deleted); }
export function allTags(): string[] {
  const s = new Set<string>();
  for (const n of liveNotes()) for (const t of n.tags) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b));
}
export function folderPath(id: string | null): string {
  const parts: string[] = [];
  let cur = id ? state.folders.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 50) { parts.unshift(cur.name); cur = cur.parent_id ? state.folders.get(cur.parent_id) : undefined; }
  return parts.join(' / ');
}
