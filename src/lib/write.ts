import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError, errorMessage } from './api';
import { enqueue } from './sync';
import { uuid } from './auth';
import { useToast } from '../hooks/use-toast';
import { useOnline } from '../hooks/use-online';
import type { MediaDetail } from '../shared/types';
import { libraryKeys } from '../hooks/use-library';

export interface QueuedWrite<T> {
  result: T | null;
  queued: boolean;
  error?: string;
}

/**
 * Sends a write; if the device is offline (before or during the request) the
 * exact request is queued in IndexedDB and replayed later with the same
 * idempotency key. Never throws for offline conditions — it reports them.
 */
export function useWriteOrQueue() {
  const toast = useToast();
  const online = useOnline();
  const queryClient = useQueryClient();

  return useCallback(
    async <T>(
      method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
      options: { label?: string; invalidate?: readonly unknown[][]; silent?: boolean } = {},
    ): Promise<QueuedWrite<T>> => {
      const key = uuid();
      const queueIt = () => {
        enqueue({ id: key, method, path, body, label: options.label });
        // Never report a queued write as simply "saved": say it will be sent later.
        if (!options.silent) {
          toast.info(
            options.label
              ? `${options.label} بعد از اتصال به اینترنت ارسال می‌شود.`
              : 'ذخیره شد. بعد از اتصال به اینترنت ارسال می‌شود.',
          );
        }
        return { result: null, queued: true } as QueuedWrite<T>;
      };

      if (!online) return queueIt();

      try {
        const result = await apiRequest<T>(path, { method, body, headers: { 'idempotency-key': key } });
        await Promise.all(
          (options.invalidate ?? [['library']]).map((k) => queryClient.invalidateQueries({ queryKey: k })),
        );
        return { result, queued: false };
      } catch (err) {
        if (err instanceof ApiError && err.isOffline) return queueIt();
        const message = errorMessage(err);
        if (!options.silent) toast.error(message);
        return { result: null, queued: false, error: message };
      }
    },
    [online, queryClient, toast],
  );
}

/** Optimistic helpers for a single item's detail query. */
export function useDetailCache(id: string) {
  const queryClient = useQueryClient();
  const key = libraryKeys.detail(id);

  const patch = useCallback(
    (updater: (detail: MediaDetail) => MediaDetail) => {
      queryClient.setQueryData<MediaDetail>(key, (old) => (old ? updater(old) : old));
    },
    [queryClient, key],
  );

  const snapshot = useCallback(() => queryClient.getQueryData<MediaDetail>(key), [queryClient, key]);

  const restore = useCallback(
    (snap: MediaDetail | undefined) => {
      if (snap) queryClient.setQueryData(key, snap);
    },
    [queryClient, key],
  );

  return { patch, snapshot, restore, invalidate: () => queryClient.invalidateQueries({ queryKey: ['library'] }) };
}
