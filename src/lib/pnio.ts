import { getAttachmentBlob } from './attachments';
import * as db from './db';
import { packPn, unpackPn } from './pnfile';
import { descendantFolderIds, liveFolders, liveNotes, saveLocal, state } from './store';
import type { AttachmentMeta, Folder, Note, PnBundle } from './types';
import { APP_VERSION, desktop, saveBytes } from './platform';
import { attachmentIdsIn, safeFileName } from './util';

function attachmentsFor(notes: Note[]): AttachmentMeta[] {
  const ids = new Set(notes.flatMap((n) => attachmentIdsIn(n.html)));
  return [...ids].map((id) => state.attachments.get(id)).filter((a): a is AttachmentMeta => !!a && !a.deleted);
}

async function build(kind: PnBundle['kind'], folders: Folder[], notes: Note[]): Promise<Uint8Array> {
  const bundle: PnBundle = { format: 'permanotes', version: 1, kind, exported_at: new Date().toISOString(), app_version: APP_VERSION, folders, notes, attachments: attachmentsFor(notes) };
  return packPn(bundle, async (id) => new Uint8Array(await (await getAttachmentBlob(id)).arrayBuffer()));
}

export async function exportNote(id: string) {
  const n = state.notes.get(id);
  if (!n) throw new Error('Note not found');
  const bytes = await build('note', [], [{ ...n, folder_id: null }]);
  return saveBytes(`${safeFileName(n.title || 'Untitled')}.pn`, bytes);
}

export async function exportFolder(id: string) {
  const ids = descendantFolderIds(id);
  const folders = ids.map((f) => state.folders.get(f)!).map((f) => (f.id === id ? { ...f, parent_id: null } : f));
  const notes = liveNotes().filter((n) => n.folder_id && ids.includes(n.folder_id));
  return saveBytes(`${safeFileName(state.folders.get(id)?.name ?? 'Folder')}.pn`, await build('folder', folders, notes));
}

export function libraryFileName() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `PermaNotes Library ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.pn`;
}

export async function buildLibrary(): Promise<Uint8Array> {
  return build('library', liveFolders(), liveNotes());
}

export async function exportLibrary() {
  return saveBytes(libraryFileName(), await buildLibrary());
}

// Import merges: items that already exist are only replaced if the file's copy is newer.
// A single note or folder file always comes in as a new copy so it never overwrites anything.
export async function importPn(data: ArrayBuffer | Uint8Array, targetFolder: string | null): Promise<string> {
  const { bundle, files } = await unpackPn(data);
  const copy = bundle.kind !== 'library';
  const idMap = new Map<string, string>();
  const mapId = (id: string) => { if (!copy) return id; let v = idMap.get(id); if (!v) { v = crypto.randomUUID(); idMap.set(id, v); } return v; };

  const atts: AttachmentMeta[] = [];
  const missing: string[] = [];
  for (const a of bundle.attachments) {
    const bytes = files.get(a.id);
    if (!bytes) { missing.push(a.name); continue; }
    const id = mapId(a.id);
    if (!copy && state.attachments.has(id)) continue;
    await db.putBlob(id, new Blob([bytes as BlobPart], { type: a.mime }));
    atts.push({ ...a, id, note_id: a.note_id ? mapId(a.note_id) : null, dirty: true, synced_at: null, has_blob: true });
  }
  await saveLocal('attachments', atts);

  const folders: Folder[] = [];
  for (const f of bundle.folders) {
    const nf: Folder = { ...f, id: mapId(f.id), parent_id: f.parent_id ? mapId(f.parent_id) : (copy ? targetFolder : null), dirty: true, synced_at: null };
    const ex = state.folders.get(nf.id);
    if (ex && ex.updated_at >= nf.updated_at) continue;
    folders.push(nf);
  }
  await saveLocal('folders', folders);

  const notes: Note[] = [];
  for (const n of bundle.notes) {
    let html = n.html;
    if (copy) for (const [oldId, newId] of idMap) html = html.split(oldId).join(newId);
    const nn: Note = { ...n, html, id: mapId(n.id), folder_id: n.folder_id ? mapId(n.folder_id) : (copy ? targetFolder : null), dirty: true, synced_at: null };
    const ex = state.notes.get(nn.id);
    if (ex && ex.updated_at >= nn.updated_at) continue;
    notes.push(nn);
  }
  await saveLocal('notes', notes);

  const what = bundle.kind === 'note' ? 'note' : bundle.kind === 'folder' ? 'folder' : 'library';
  let msg = `Opened ${what}: ${notes.length} note(s), ${folders.length} folder(s), ${atts.length} attachment(s) added or updated.`;
  if (missing.length) msg += `\nMISSING from the file: ${missing.join(', ')}`;
  return msg;
}

// Desktop only: a full-library .pn backup per day (today's file is refreshed whenever notes changed), keeping the last 14 days.
export async function dailyBackup(): Promise<string | null> {
  if (!desktop) return null;
  const notes = [...state.notes.values()];
  if (!notes.some((n) => !n.deleted)) return null;
  const stamp = `${notes.length}|${notes.reduce((m, n) => (n.updated_at > m ? n.updated_at : m), '')}|${state.folders.size}|${state.attachments.size}`;
  if ((await db.kvGet<string>('lastBackupStamp')) === stamp) return null;
  const path = await desktop.writeBackup(libraryFileName(), await buildLibrary(), 14);
  await db.kvSet('lastBackupStamp', stamp);
  return path;
}
