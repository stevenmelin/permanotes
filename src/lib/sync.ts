import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { setDownloader } from './attachments';
import * as db from './db';
import { onLocalChange, saveLocal, state } from './store';
import type { AttachmentMeta, Folder, Note } from './types';
import { errText, uid } from './util';
import { DEFAULT_SYNC } from '../config';

export const BUCKET = 'attachments';
export const TABLES = ['folders', 'notes', 'attachments'] as const;
type Table = typeof TABLES[number];

export interface SyncSettings { url: string; key: string }
export type SyncPhase = 'not-set-up' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';
export interface SyncStatus { phase: SyncPhase; message: string; email: string | null; problems: string[]; lastSynced: string | null; progress: number | null }

const SETTINGS_KEY = 'pn.supabase';
let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let status: SyncStatus = { phase: 'not-set-up', message: 'Sync is not set up — notes are saved on this device only.', email: null, problems: [], lastSynced: null, progress: null };
const listeners = new Set<(s: SyncStatus) => void>();
export const onStatus = (fn: (s: SyncStatus) => void) => { listeners.add(fn); fn(status); return () => { listeners.delete(fn); }; };
const setStatus = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; for (const l of listeners) l(status); };
export const getStatus = () => status;

// Built-in database unless this device was pointed elsewhere (or sync was turned off) in Settings
export function loadSettings(): SyncSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === 'off') return null;
    return raw ? (JSON.parse(raw) as SyncSettings) : DEFAULT_SYNC;
  } catch { return DEFAULT_SYNC; }
}
export const usingBuiltIn = () => { const s = loadSettings(); return !!s && s.url === DEFAULT_SYNC.url && s.key === DEFAULT_SYNC.key; };

export async function saveSettings(s: SyncSettings | null) {
  if (s) {
    const url = s.url.trim().replace(/\/+$/, '');
    if (!/^https:\/\/.+/.test(url)) throw new Error('The Project URL should start with https:// (copy it from Supabase > Project Settings > API).');
    if (s.key.trim().length < 20) throw new Error('That key looks too short. Copy the "anon public" or "publishable" key from Supabase > Project Settings > API.');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url, key: s.key.trim() }));
  } else {
    localStorage.setItem(SETTINGS_KEY, 'off');
  }
  await startSync();
}

export async function startSync() {
  if (channel) { await channel.unsubscribe(); channel = null; }
  const s = loadSettings();
  if (!s) { client = null; setStatus({ phase: 'not-set-up', message: 'Sync is not set up — notes are saved on this device only.', email: null }); return; }
  client = createClient(s.url, s.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pn.auth' } });
  setDownloader(downloadBlob);
  client.auth.onAuthStateChange((_e, session) => {
    setStatus({ email: session?.user.email ?? null });
  });
  const { data, error } = await client.auth.getSession();
  if (error) { setStatus({ phase: 'error', message: `Could not read sign-in: ${error.message}` }); return; }
  if (!data.session) { setStatus({ phase: 'signed-out', message: 'Sign in to sync your notes (gear › Sync).', email: null }); return; }
  setStatus({ email: data.session.user.email ?? null });
  subscribeRealtime();
  void syncNow();
}

function requireClient(): SupabaseClient {
  if (!client) throw new Error('Sync is not set up. Open Settings and paste your Supabase Project URL and key.');
  return client;
}

export async function signIn(email: string, password: string, create: boolean) {
  const c = requireClient();
  const res = create ? await c.auth.signUp({ email, password }) : await c.auth.signInWithPassword({ email, password });
  if (res.error) throw new Error(res.error.message);
  if (!res.data.session) throw new Error('Account created, but Supabase is waiting for email confirmation. Either click the link in the email Supabase sent, or turn off "Confirm email" (Supabase > Authentication > Sign In / Providers > Email) and sign in again.');
  await kvReset();
  setStatus({ email: res.data.session.user.email ?? null });
  subscribeRealtime();
  await syncNow();
}

export async function signOut() {
  const c = requireClient();
  const { error } = await c.auth.signOut();
  if (error) throw new Error(error.message);
  if (channel) { await channel.unsubscribe(); channel = null; }
  setStatus({ phase: 'signed-out', message: 'Signed out. Notes stay on this device.', email: null });
}

async function kvReset() { await db.kvSet('lastPull', null); }

function subscribeRealtime() {
  const c = client;
  if (!c || channel) return;
  channel = c.channel('pn-changes');
  for (const t of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => schedule(400));
  }
  channel.subscribe();
}

// ---------- scheduling ----------
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;
export function schedule(ms = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, ms);
}
onLocalChange(() => schedule());
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => schedule(100));
  setInterval(() => { if (client) void syncNow(); }, 60_000);
}

export async function syncNow(): Promise<void> {
  if (!client) return;
  if (running) { again = true; return; }
  const { data } = await client.auth.getSession();
  if (!data.session) { setStatus({ phase: 'signed-out', message: 'Sign in to sync your notes.' }); return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus({ phase: 'offline', message: 'Offline — changes are saved on this device and will sync when you reconnect.' }); return; }
  running = true;
  const problems: string[] = [];
  try {
    setStatus({ phase: 'syncing', message: 'Syncing…', progress: null });
    await pull(data.session.user.id);
    await push(data.session.user.id, problems);
    setStatus({
      phase: problems.length ? 'error' : 'synced',
      message: problems.length ? `Synced, but ${problems.length} item(s) failed — see Settings > Sync problems.` : 'All changes synced.',
      problems, lastSynced: new Date().toISOString(), progress: null,
    });
  } catch (e) {
    const msg = errText(e);
    const offline = /Failed to fetch|NetworkError|Load failed|network/i.test(msg);
    setStatus({ phase: offline ? 'offline' : 'error', message: offline ? `Can't reach the sync server — working offline. (${msg.split('\n')[0]})` : `Sync failed: ${msg.split('\n')[0]}`, problems: [...problems, msg], progress: null });
  } finally {
    running = false;
    if (again) { again = false; schedule(200); }
  }
}

// ---------- pull ----------
type Row = Record<string, unknown> & { id: string; updated_at: string; server_updated_at: string };

async function fetchSince(table: Table, since: string | null): Promise<Row[]> {
  const c = requireClient();
  const out: Row[] = [];
  const page = 500;
  for (let from = 0; ; from += page) {
    let q = c.from(table).select('*').order('server_updated_at', { ascending: true }).range(from, from + page - 1);
    if (since) q = q.gt('server_updated_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`Reading ${table} from Supabase failed: ${error.message}${error.hint ? ` (${error.hint})` : ''}${/relation|does not exist|schema cache/i.test(error.message) ? ' — did you run supabase/schema.sql in the Supabase SQL editor?' : ''}`);
    out.push(...(data as Row[]));
    if (!data || data.length < page) break;
  }
  return out;
}

async function pull(_userId: string) {
  const since = (await db.kvGet<string | null>('lastPull')) ?? null;
  let maxSeen = since;
  // Re-read the last 2 minutes each time so a row committed slightly late is never missed (re-applying is harmless).
  const query = since ? new Date(Date.parse(since.replace(/(\.\d{3})\d+/, '$1')) - 120_000).toISOString() : null;
  const track = (r: Row) => { if (!maxSeen || r.server_updated_at > maxSeen) maxSeen = r.server_updated_at; };

  const rf = await fetchSince('folders', query);
  const folders: Folder[] = [];
  for (const r of rf) {
    track(r);
    const l = state.folders.get(r.id);
    if (l?.dirty && l.updated_at > r.updated_at) continue; // local is newer; push will win
    folders.push({ id: r.id, parent_id: (r.parent_id as string) ?? null, name: r.name as string, sort: (r.sort as number) ?? 0, updated_at: r.updated_at, deleted: !!r.deleted, dirty: false, synced_at: r.updated_at });
  }
  await saveLocal('folders', folders, true);

  const ra = await fetchSince('attachments', query);
  const atts: AttachmentMeta[] = [];
  for (const r of ra) {
    track(r);
    const l = state.attachments.get(r.id);
    if (l?.dirty && l.updated_at > r.updated_at) continue;
    atts.push({ id: r.id, note_id: (r.note_id as string) ?? null, name: r.name as string, mime: r.mime as string, size: Number(r.size ?? 0), created_at: r.created_at as string, updated_at: r.updated_at, deleted: !!r.deleted, dirty: false, synced_at: r.updated_at, has_blob: l?.has_blob ?? false });
  }
  await saveLocal('attachments', atts, true);

  const rn = await fetchSince('notes', query);
  const notes: Note[] = [];
  const copies: Note[] = [];
  for (const r of rn) {
    track(r);
    const remote: Note = { id: r.id, folder_id: (r.folder_id as string) ?? null, title: (r.title as string) ?? '', html: (r.html as string) ?? '', tags: (r.tags as string[]) ?? [], sort: Number(r.sort ?? 0), pinned: r.pinned == null ? null : Number(r.pinned), created_at: r.created_at as string, updated_at: r.updated_at, deleted: !!r.deleted, dirty: false, synced_at: r.updated_at };
    const l = state.notes.get(r.id);
    if (l?.dirty && l.updated_at !== r.updated_at) {
      if (r.updated_at === l.synced_at) continue; // server still has the version we started from; our edit wins on push
      // Both sides changed since the last sync: keep both. The local edit becomes a copy.
      if (!l.deleted && !remote.deleted && (l.html !== remote.html || l.title !== remote.title)) {
        copies.push({ ...l, id: uid(), title: `${l.title || 'Untitled'} (conflict copy)`, dirty: true, synced_at: null });
      } else if (l.updated_at > r.updated_at) {
        continue;
      }
    }
    notes.push(remote);
  }
  await saveLocal('notes', notes, true);
  if (copies.length) await saveLocal('notes', copies);
  if (maxSeen !== since) await db.kvSet('lastPull', maxSeen);
}

// ---------- push ----------
const strip = <T extends object>(o: T) => {
  const { dirty: _d, synced_at: _s, has_blob: _h, ...rest } = o as T & { dirty?: unknown; synced_at?: unknown; has_blob?: unknown };
  return rest;
};

async function push(userId: string, problems: string[]) {
  const c = requireClient();

  const dirtyAtts = [...state.attachments.values()].filter((a) => a.dirty);
  let done = 0;
  for (const a of dirtyAtts) {
    try {
      if (!a.deleted) {
        const blob = await db.getBlob(a.id);
        if (!blob) throw new Error('file data is missing on this device');
        const up = await c.storage.from(BUCKET).upload(`${userId}/${a.id}`, blob, { upsert: true, contentType: a.mime || 'application/octet-stream' });
        if (up.error) throw new Error(`${up.error.message}${/exceed|size|too large|413/i.test(up.error.message) ? ' (Supabase free plan: 50 MB per file, 1 GB total)' : ''}`);
      }
      const { error } = await c.from('attachments').upsert({ ...strip(a), user_id: userId, storage_path: `${userId}/${a.id}` });
      if (error) throw new Error(error.message);
      await markClean('attachments', a);
    } catch (e) {
      problems.push(`Attachment "${a.name}": ${errText(e).split('\n')[0]}`);
    }
    done++;
    if (dirtyAtts.length > 5) setStatus({ message: `Uploading attachments ${done}/${dirtyAtts.length}…`, progress: done / dirtyAtts.length });
  }

  for (const table of ['folders', 'notes'] as const) {
    const dirty = [...(state[table] as Map<string, Folder | Note>).values()].filter((x) => x.dirty);
    let batch: (Folder | Note)[] = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const rows = batch.map((x) => ({ ...strip(x), user_id: userId }));
      const { error } = await c.from(table).upsert(rows);
      if (error) {
        problems.push(`Saving ${batch.length} ${table} to Supabase failed: ${error.message}${/column|schema cache|invalid input syntax for type integer/i.test(error.message) ? ' — your Supabase database needs the latest setup: open supabase/schema.sql (from the newest Source zip), paste it into Supabase > SQL Editor and click Run.' : ''}`);
      } else {
        for (const x of batch) await markClean(table, x);
      }
      batch = []; bytes = 0;
    };
    for (const x of dirty) {
      batch.push(x);
      bytes += 'html' in x ? x.html.length : 200;
      if (batch.length >= 100 || bytes > 1_500_000) await flush();
    }
    await flush();
  }
}

async function markClean(kind: 'folders' | 'notes' | 'attachments', pushed: Folder | Note | AttachmentMeta) {
  const map = state[kind] as Map<string, Folder | Note | AttachmentMeta>;
  const cur = map.get(pushed.id);
  if (!cur) return;
  // If it changed again while uploading, it stays dirty for the next round, but the server now has `pushed`.
  const clean = cur.updated_at === pushed.updated_at
    ? { ...cur, dirty: false, synced_at: cur.updated_at }
    : { ...cur, synced_at: pushed.updated_at };
  if (kind === 'folders') await saveLocal('folders', [clean as Folder], true);
  else if (kind === 'notes') await saveLocal('notes', [clean as Note], true);
  else await saveLocal('attachments', [clean as AttachmentMeta], true);
}

async function downloadBlob(id: string): Promise<Blob> {
  const c = requireClient();
  const { data: s } = await c.auth.getSession();
  if (!s.session) throw new Error('Sign in to download this attachment.');
  const { data, error } = await c.storage.from(BUCKET).download(`${s.session.user.id}/${id}`);
  if (error || !data) throw new Error(`Download failed: ${error?.message ?? 'no data'}`);
  return data;
}

export async function storageUsage(): Promise<number> {
  let total = 0;
  for (const a of state.attachments.values()) if (!a.deleted) total += a.size;
  return total;
}
