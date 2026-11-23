import JSZip from 'jszip';
import * as db from './db';
import { convertPage } from './onenote';
import { saveLocal, state } from './store';
import type { AttachmentMeta, Folder, Note } from './types';
import { mimeFor, now, uid } from './util';

export interface ImportReport { notes: number; updated: number; folders: number; attachments: number; failures: string[]; warnings: string[]; keptEdits: string[] }
interface PageInfo { file: string; path: string[]; title?: string }

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importOneNoteExport(data: ArrayBuffer, onProgress: (done: number, total: number, label: string) => void, opts: { updateExisting: boolean } = { updateExisting: true }): Promise<ImportReport> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch (e) {
    throw new Error(`Could not open the zip: ${e instanceof Error ? e.message : String(e)}`);
  }
  const all = Object.keys(zip.files).map((p) => p.replace(/\\/g, '/'));
  const hier = all.find((p) => /(^|\/)hierarchy\.xml$/i.test(p));
  if (!hier) throw new Error('This zip is not a OneNote export from the "Export My OneNote" tool (hierarchy.xml is missing).');
  const root = hier.slice(0, hier.length - 'hierarchy.xml'.length);
  const keyMap = new Map(Object.keys(zip.files).map((k) => [k.replace(/\\/g, '/'), k]));
  const rawPath = (rel: string) => keyMap.get(root + rel);

  // Page order + real (unsanitized) names come from pages.json; fall back to folder names.
  let pages: PageInfo[] = [];
  const pj = rawPath('pages.json');
  if (pj) {
    try {
      const parsed = JSON.parse((await zip.file(pj)!.async('string')).replace(/^﻿/, ''));
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      pages = arr.map((p: { File: string; Path: string[] | string; Title?: string }) => ({ file: p.File.replace(/\\/g, '/'), path: Array.isArray(p.Path) ? p.Path : [p.Path], title: p.Title }));
    } catch (e) {
      throw new Error(`pages.json in the export could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    pages = all.filter((p) => p.startsWith(root) && p.endsWith('.xml') && p !== hier && !zip.files[p]?.dir)
      .map((p) => p.slice(root.length)).sort()
      .map((file) => ({ file, path: file.split('/').slice(0, -1) }));
  }
  if (!pages.length) throw new Error('No pages were found in this export.');

  const report: ImportReport = { notes: 0, updated: 0, folders: 0, attachments: 0, failures: [], warnings: [], keptEdits: [] };
  const folderByPath = new Map<string, string>();
  // Reuse folders that already exist with the same path (no duplicate notebooks/sections)
  const pathOf = (id: string | null): string[] => {
    const out: string[] = [];
    let cur = id ? state.folders.get(id) : undefined;
    for (let g = 0; cur && g < 50; g++) { out.unshift(cur.name); cur = cur.parent_id ? state.folders.get(cur.parent_id) : undefined; }
    return out;
  };
  for (const f of state.folders.values()) if (!f.deleted) folderByPath.set(pathOf(f.id).join('\u0000'), f.id);
  // Pages from an earlier OneNote import, so re-importing updates them instead of duplicating
  const imports = (await db.kvGet<Record<string, string>>('onenoteImports')) ?? {};
  const existing = new Map<string, Note>();
  if (opts.updateExisting) {
    for (const n of state.notes.values()) if (!n.deleted && n.tags.includes('onenote')) existing.set(`${n.folder_id}\u0000${n.title}`, n);
  }
  const newFolders: Folder[] = [];
  const replacedAttachments: AttachmentMeta[] = [];
  const t0 = now();
  const ensureFolder = (path: string[]): string | null => {
    let parent: string | null = null;
    for (let i = 0; i < path.length; i++) {
      const key = path.slice(0, i + 1).join('\u0000');
      let id = folderByPath.get(key);
      if (!id) {
        id = uid();
        const siblings = newFolders.filter((f) => f.parent_id === parent).length + [...state.folders.values()].filter((f) => !f.deleted && f.parent_id === parent).length;
        newFolders.push({ id, parent_id: parent, name: path[i], sort: siblings, updated_at: t0, deleted: false, dirty: true, synced_at: null });
        folderByPath.set(key, id);
      }
      parent = id;
    }
    return parent;
  };

  const parser = new DOMParser();
  const batchNotes: Note[] = [];
  const batchAtts: AttachmentMeta[] = [];
  const sortCounter = new Map<string | null, number>();
  const flush = async () => {
    await saveLocal('attachments', batchAtts.splice(0));
    await saveLocal('notes', batchNotes.splice(0));
  };

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    onProgress(i, pages.length, `${p.path.join(' › ')} › ${p.title ?? p.file.split('/').pop()}`);
    const zp = rawPath(p.file);
    if (!zp) { report.failures.push(`${p.file}: listed in pages.json but not in the zip`); continue; }
    try {
      const xml = await zip.file(zp)!.async('string');
      const out = convertPage(xml, parser, uid, mimeFor);
      const folder_id = ensureFolder(p.path);
      const created = out.created ?? t0;
      const pageDate = out.modified ?? created;
      const key = `${folder_id}\u0000${out.title}`;
      const ex = existing.get(key);
      existing.delete(key); // each earlier page is matched at most once
      // "untouched since import" = its last change is the one the import made
      const untouched = ex ? (imports[ex.id] ?? pageDate) === ex.updated_at : false;
      const noteId = ex && untouched ? ex.id : uid();
      const pageDir = p.file.split('/').slice(0, -1).join('/');
      for (const a of out.attachments) {
        let bytes: Uint8Array;
        if (a.kind === 'image') bytes = b64ToBytes(a.base64);
        else {
          const fp = rawPath(`${pageDir}/${a.path}`);
          if (!fp) { report.failures.push(`"${out.title}": attachment ${a.name} missing from zip (${pageDir}/${a.path})`); continue; }
          bytes = await zip.file(fp)!.async('uint8array');
        }
        const blob = new Blob([bytes as BlobPart], { type: a.mime });
        await db.putBlob(a.id, blob);
        const t = now();
        batchAtts.push({ id: a.id, note_id: noteId, name: a.name, mime: a.mime, size: blob.size, created_at: t, updated_at: t, deleted: false, dirty: true, synced_at: null, has_blob: true });
        report.attachments++;
      }
      if (ex && untouched) {
        const t = now();
        for (const a of state.attachments.values()) if (a.note_id === ex.id && !a.deleted) replacedAttachments.push({ ...a, deleted: true, updated_at: t, dirty: true });
        batchNotes.push({ ...ex, html: out.html, updated_at: t, dirty: true });
        imports[ex.id] = t;
        report.updated++;
      } else {
        const sort = sortCounter.get(folder_id) ?? [...state.notes.values()].filter((n) => !n.deleted && n.folder_id === folder_id).length;
        sortCounter.set(folder_id, sort + 1);
        const title = ex ? `${out.title} (re-imported)` : out.title;
        if (ex) report.keptEdits.push(out.title);
        batchNotes.push({ id: noteId, folder_id, title, html: out.html, tags: ['onenote'], sort, created_at: created, updated_at: pageDate, deleted: false, dirty: true, synced_at: null });
        imports[noteId] = pageDate;
        report.notes++;
      }
      for (const w of out.warnings) report.warnings.push(`"${out.title}": ${w}`);
    } catch (e) {
      report.failures.push(`${p.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (batchNotes.length >= 25) {
      await saveLocal('folders', newFolders.filter((f) => !state.folders.has(f.id)));
      await flush();
    }
  }
  await saveLocal('folders', newFolders.filter((f) => !state.folders.has(f.id)));
  await flush();
  await saveLocal('attachments', replacedAttachments);
  await db.kvSet('onenoteImports', imports);
  report.folders = newFolders.length;
  onProgress(pages.length, pages.length, 'Done');
  return report;
}
