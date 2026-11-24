import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Local IndexedDB store used for two things:
 *  1. caching server responses so the app is readable offline
 *  2. the pending-write queue so offline edits are never lost
 */

interface MMUSchema extends DBSchema {
  cache: {
    key: string;
    value: { state: unknown; savedAt: number };
  };
  queue: {
    key: string;
    value: PendingOp;
    indexes: { 'by-queued': number };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

export interface PendingOp {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  queuedAt: number;
  label?: string;
}

let dbPromise: Promise<IDBPDatabase<MMUSchema>> | null = null;

function open(): Promise<IDBPDatabase<MMUSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MMUSchema>('my-media-universe', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('queue')) {
          const store = db.createObjectStore('queue', { keyPath: 'id' });
          store.createIndex('by-queued', 'queuedAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return (await db.get('cache', key)) as T | null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, state: unknown): Promise<void> {
  try {
    const db = await open();
    await db.put('cache', { state, savedAt: Date.now() } as unknown as MMUSchema['cache']['value'], key);
  } catch {
    /* IndexedDB may be unavailable (private mode) — the app still works online. */
  }
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return (await db.get('meta', key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await db.put('meta', value as MMUSchema['meta']['value'], key);
  } catch {
    /* ignore */
  }
}

export async function metaDelete(key: string): Promise<void> {
  try {
    const db = await open();
    await db.delete('meta', key);
  } catch {
    /* ignore */
  }
}

// ── Pending write queue ────────────────────────────────────────────────────

export async function queueAdd(op: PendingOp): Promise<void> {
  const db = await open();
  await db.put('queue', op);
}

export async function queueAll(): Promise<PendingOp[]> {
  try {
    const db = await open();
    return await db.getAllFromIndex('queue', 'by-queued');
  } catch {
    return [];
  }
}

export async function queueRemove(id: string): Promise<void> {
  const db = await open();
  await db.delete('queue', id);
}

export async function queueClear(): Promise<void> {
  const db = await open();
  await db.clear('queue');
}

export async function queueCount(): Promise<number> {
  try {
    const db = await open();
    return await db.count('queue');
  } catch {
    return 0;
  }
}
