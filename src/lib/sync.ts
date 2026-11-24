import { apiRequest, ApiError } from './api';
import { metaGet, metaSet, queueAdd, queueAll, queueClear, queueCount, queueRemove, type PendingOp } from './idb';

/**
 * Offline write queue.
 *
 * Every write is given a stable client-generated id. When the device is offline
 * the request is stored in IndexedDB and replayed later with an `Idempotency-Key`
 * header, so a retry can never create a duplicate. Requests that fail with a
 * permanent 4xx are moved to a "needs attention" list instead of being silently lost.
 */

export interface FailedOp extends PendingOp {
  error: string;
  status: number;
}

type SyncListener = (state: SyncState) => void;

export interface SyncState {
  pending: number;
  flushing: boolean;
  lastFlushAt: number | null;
  lastError: string | null;
}

let state: SyncState = { pending: 0, flushing: false, lastFlushAt: null, lastError: null };
const listeners = new Set<SyncListener>();

function emit() {
  for (const l of listeners) l(state);
}

export function subscribeSync(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getSyncState(): SyncState {
  return state;
}

async function refreshPending() {
  state = { ...state, pending: await queueCount() };
  emit();
}

export function enqueue(op: Omit<PendingOp, 'id' | 'queuedAt'> & { id?: string }): PendingOp {
  const full: PendingOp = {
    id: op.id ?? crypto.randomUUID(),
    queuedAt: Date.now(),
    method: op.method,
    path: op.path,
    body: op.body,
    label: op.label,
  };
  void queueAdd(full).then(refreshPending);
  return full;
}

export async function pendingOps(): Promise<PendingOp[]> {
  return queueAll();
}

export async function failedOps(): Promise<FailedOp[]> {
  return (await metaGet<FailedOp[]>('failed-ops')) ?? [];
}

export async function clearFailedOps(): Promise<void> {
  await metaSet('failed-ops', []);
}

/** Replays queued writes in order. Stops on the first transient failure. */
export async function flushPendingOps(): Promise<{ applied: number; failed: number; remaining: number }> {
  if (state.flushing) {
    return { applied: 0, failed: 0, remaining: await queueCount() };
  }
  state = { ...state, flushing: true, lastError: null };
  emit();

  let applied = 0;
  let failed = 0;

  try {
    const ops = await queueAll();
    for (const op of ops) {
      try {
        await apiRequest(op.path, {
          method: op.method,
          body: op.body,
          headers: { 'idempotency-key': op.id },
          raw: true,
        });
        await queueRemove(op.id);
        applied += 1;
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 409) {
          // Permanent rejection — keep a copy so the user can see what did not save.
          const previous = (await metaGet<FailedOp[]>('failed-ops')) ?? [];
          await metaSet('failed-ops', [
            { ...op, error: err.message, status: err.status },
            ...previous,
          ].slice(0, 20));
          await queueRemove(op.id);
          failed += 1;
          continue;
        }
        state = { ...state, lastError: err instanceof Error ? err.message : 'خطای نامشخص' };
        break;
      }
    }
    const remaining = await queueCount();
    state = {
      ...state,
      flushing: false,
      pending: remaining,
      lastFlushAt: applied > 0 ? Date.now() : state.lastFlushAt,
    };
    emit();
    return { applied, failed, remaining };
  } catch (err) {
    state = {
      ...state,
      flushing: false,
      lastError: err instanceof Error ? err.message : 'خطای نامشخص',
    };
    emit();
    return { applied, failed, remaining: await queueCount() };
  }
}

/** Discards the queue (used after a full restore or account deletion). */
export async function resetQueue(): Promise<void> {
  await queueClear();
  await metaSet('failed-ops', []);
  state = { ...state, pending: 0, lastError: null };
  emit();
}

let started = false;

/** Wires browser connectivity events to automatic queue flushing. */
export function startSync(): () => void {
  if (started) return () => undefined;
  started = true;

  void refreshPending();

  const onOnline = () => {
    void flushPendingOps();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void flushPendingOps();
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    started = false;
  };
}
