import type { AttachmentMeta, Folder, Kind, Note } from './types';

const DB_NAME = 'permanotes';
const DB_VERSION = 1;
export const STORES = ['folders', 'notes', 'attachments', 'blobs', 'kv'] as const;
type Store = typeof STORES[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'blobs' || s === 'kv' ? undefined : { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(`Could not open the local database: ${req.error?.message ?? 'unknown error'}`));
    req.onblocked = () => reject(new Error('The local database is blocked by another open PermaNotes window. Close other windows and reload.'));
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function tx(store: Store, mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export async function getAll<T>(store: Store): Promise<T[]> {
  return wrap((await tx(store, 'readonly')).getAll()) as Promise<T[]>;
}

export async function get<T>(store: Store, key: string): Promise<T | undefined> {
  return wrap((await tx(store, 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function putMany(store: Kind, items: (Folder | Note | AttachmentMeta)[]): Promise<void> {
  if (!items.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const it of items) s.put(it);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error(`Saving to ${store} failed`));
    t.onabort = () => reject(t.error ?? new Error(`Saving to ${store} was aborted (disk full?)`));
  });
}

export async function del(store: Store, key: string): Promise<void> {
  await wrap((await tx(store, 'readwrite')).delete(key));
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await wrap((await tx('blobs', 'readwrite')).put(blob, id));
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return wrap((await tx('blobs', 'readonly')).get(id)) as Promise<Blob | undefined>;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return wrap((await tx('kv', 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await wrap((await tx('kv', 'readwrite')).put(value, key));
}

export async function requestPersistence(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* not supported: browser decides */ }
}
