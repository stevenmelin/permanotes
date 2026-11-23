import JSZip from 'jszip';
import type { PnBundle } from './types';

// .pn file = ZIP container:
//   permanotes.json        bundle manifest (folders, notes, attachment metadata)
//   attachments/<id>       raw attachment bytes
export const PN_MANIFEST = 'permanotes.json';
export const PN_EXT = '.pn';

export async function packPn(bundle: PnBundle, getBytes: (id: string) => Promise<Uint8Array | ArrayBuffer | Blob>): Promise<Uint8Array> {
  const zip = new JSZip();
  const clean = {
    ...bundle,
    folders: bundle.folders.map(({ dirty: _d, synced_at: _s, ...f }) => f),
    notes: bundle.notes.map(({ dirty: _d, synced_at: _s, ...n }) => n),
    attachments: bundle.attachments.map(({ dirty: _d, synced_at: _s, has_blob: _h, ...a }) => a),
  };
  zip.file(PN_MANIFEST, JSON.stringify(clean, null, 1));
  for (const a of bundle.attachments) {
    zip.file(`attachments/${a.id}`, await getBytes(a.id), { binary: true, compression: a.mime.startsWith('text/') ? 'DEFLATE' : 'STORE' });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function unpackPn(data: ArrayBuffer | Uint8Array): Promise<{ bundle: PnBundle; files: Map<string, Uint8Array> }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (e) {
    throw new Error(`This is not a valid .pn file (it could not be opened as a PermaNotes container): ${e instanceof Error ? e.message : String(e)}`);
  }
  const m = zip.file(PN_MANIFEST);
  if (!m) throw new Error(`This .pn file is missing ${PN_MANIFEST}.`);
  const bundle = JSON.parse(await m.async('string')) as PnBundle;
  if (bundle.format !== 'permanotes') throw new Error('This file is not a PermaNotes file.');
  if (bundle.version > 1) throw new Error(`This .pn file was made by a newer PermaNotes (format v${bundle.version}). Update PermaNotes to open it.`);
  const files = new Map<string, Uint8Array>();
  for (const a of bundle.attachments) {
    const f = zip.file(`attachments/${a.id}`);
    if (f) files.set(a.id, await f.async('uint8array'));
  }
  return { bundle, files };
}
