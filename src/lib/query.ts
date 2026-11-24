import { QueryClient, dehydrate, hydrate, type DehydratedState } from '@tanstack/react-query';
import { cacheGet, cacheSet } from './idb';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

const CACHE_KEY = 'react-query-cache-v1';
const MAX_CACHE_BYTES = 4_000_000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

let saveTimer: number | undefined;

/**
 * Persists the successful part of the query cache to IndexedDB so previously
 * loaded content stays readable offline. Deliberately debounced: the cache is
 * large and writes are comparatively expensive.
 */
export function startCachePersistence(): void {
  queryClient.getQueryCache().subscribe(() => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveCache(), 900);
  });
}

async function saveCache(): Promise<void> {
  try {
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) => query.state.status === 'success',
    });
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_CACHE_BYTES) return;
    // cacheSet wraps the payload as { state, savedAt } — do not wrap it again here.
    await cacheSet(CACHE_KEY, state);
  } catch {
    /* non-fatal */
  }
}

export async function hydrateCacheFromLocal(): Promise<void> {
  const saved = await cacheGet<{ state: DehydratedState; savedAt: number }>(CACHE_KEY);
  if (!saved?.state) return;
  if (Date.now() - saved.savedAt > MAX_AGE_MS) return;
  try {
    hydrate(queryClient, saved.state);
  } catch {
    /* ignore a corrupted cache */
  }
}

export async function clearLocalCache(): Promise<void> {
  queryClient.clear();
  await cacheSet(CACHE_KEY, null);
}
