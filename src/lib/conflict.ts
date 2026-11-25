// Pure sync-decision helpers (no app imports, so they are unit-tested).
import type { Note, NoteConflict } from './types';

// The database returns "2026-11-25T16:25:01.123456+00:00"; the app writes "2026-11-25T16:25:01.123Z".
// Same moment, different text — comparing the text made every save look like a conflict (1.0.0–1.0.5 bug).
export function normTime(s: string | null | undefined): string {
  if (!s) return '';
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(t) ? s : new Date(t).toISOString();
}
export const sameTime = (a?: string | null, b?: string | null) => !!a && !!b && normTime(a) === normTime(b);
export const newer = (a: string, b: string) => normTime(a) > normTime(b);

const normHtml = (h: string) => h.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
export const sameContent = (a: Pick<Note, 'html' | 'title'>, b: Pick<Note, 'html' | 'title'>) =>
  a.title === b.title && normHtml(a.html) === normHtml(b.html);

export type Decision = 'take' | 'skip' | 'conflict';

/** What to do when the server sends `remote` and this device has `local`. */
export function decideNote(local: Note | undefined, remote: Note, full: boolean): Decision {
  if (!local || !local.dirty) return 'take';
  if (sameTime(local.updated_at, remote.updated_at)) return 'take'; // our own upload coming back
  if (sameContent(local, remote) && local.deleted === remote.deleted) return 'take';
  if (full) return local.deleted || remote.deleted ? 'take' : 'conflict';
  if (sameTime(remote.updated_at, local.synced_at)) return 'skip'; // server unchanged since our edit began: ours uploads next
  if (local.deleted || remote.deleted) return newer(local.updated_at, remote.updated_at) ? 'skip' : 'take';
  return 'conflict'; // really edited in two places
}

export function conflictFrom(local: Note, source: string, auto = false): NoteConflict {
  return { title: local.title, html: local.html, at: normTime(local.updated_at), source, auto };
}

const COPY_RE = /^(.*) \((conflict copy|this device)\)$/;
export const copyBase = (title: string) => COPY_RE.exec(title)?.[1] ?? null;
