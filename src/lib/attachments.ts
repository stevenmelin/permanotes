import * as db from './db';
import { saveLocal, state } from './store';
import { ATT_PREFIX, inlineAttachmentIdsIn } from './util';

const urlCache = new Map<string, string>();
const reverse = new Map<string, string>(); // blob url -> id
let downloader: ((id: string) => Promise<Blob>) | null = null;
export const setDownloader = (fn: (id: string) => Promise<Blob>) => { downloader = fn; };

export async function getAttachmentBlob(id: string): Promise<Blob> {
  const local = await db.getBlob(id);
  if (local) return local;
  if (!downloader) throw new Error(`Attachment ${state.attachments.get(id)?.name ?? id} is not on this device and sync is not set up.`);
  const blob = await downloader(id);
  await db.putBlob(id, blob);
  const meta = state.attachments.get(id);
  if (meta) await saveLocal('attachments', [{ ...meta, has_blob: true }], true);
  return blob;
}

export async function getAttachmentUrl(id: string): Promise<string> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getAttachmentBlob(id);
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  reverse.set(url, id);
  return url;
}

// Replace pn-att:<id> with displayable blob: URLs for the editor. Failures are returned, not hidden.
export async function resolveHtml(html: string): Promise<{ html: string; failures: string[] }> {
  const failures: string[] = [];
  let out = html;
  for (const id of inlineAttachmentIdsIn(html)) {
    try {
      const url = await getAttachmentUrl(id);
      out = out.split(ATT_PREFIX + id).join(url);
    } catch (e) {
      failures.push(`${state.attachments.get(id)?.name ?? id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { html: out, failures };
}

// Turn blob: URLs back into pn-att:<id> before saving.
export function unresolveHtml(html: string): string {
  return html.replace(/blob:[^"'\s)]+/g, (u) => {
    const id = reverse.get(u);
    return id ? ATT_PREFIX + id : u;
  });
}

export function rememberUrl(id: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  reverse.set(url, id);
  return url;
}
