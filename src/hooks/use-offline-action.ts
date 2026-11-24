import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError, errorMessage } from '../lib/api';
import { enqueue, flushPendingOps } from '../lib/sync';
import { uuid } from '../lib/auth';
import { useOnline } from './use-online';
import { useToast } from './use-toast';

export interface RequestDescriptor {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

interface OfflineActionConfig<TVars> {
  request: (vars: TVars) => RequestDescriptor;
  invalidate?: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Apply a local optimistic change and return a rollback function. */
  optimistic?: (vars: TVars) => () => void;
  success?: string;
  queued?: string;
  /** Called after a successful online write. */
  onSuccess?: (vars: TVars) => void | Promise<void>;
}

/**
 * A write that behaves identically online and offline.
 *
 * Online: apply optimistically → send with an idempotency key → invalidate →
 * roll back and report on failure.
 * Offline: queue the exact request in IndexedDB and apply the optimistic change.
 * The queue is replayed on reconnect with the same key, so retries are safe.
 */
export function useOfflineAction<TVars>(config: OfflineActionConfig<TVars>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (vars: TVars): Promise<boolean> => {
      const req = config.request(vars);

      if (!online) {
        enqueue({ ...req, id: uuid(), label: config.queued });
        config.optimistic?.(vars);
        toast.info(config.queued ?? 'ذخیره شد. بعد از اتصال به اینترنت ارسال می‌شود.');
        return true;
      }

      setPending(true);
      let rollback: (() => void) | undefined;
      try {
        rollback = config.optimistic?.(vars);
        await apiRequest(req.path, {
          method: req.method,
          body: req.body,
          headers: { 'idempotency-key': uuid() },
        });
        await Promise.all(
          (config.invalidate ?? []).map((key) => queryClient.invalidateQueries({ queryKey: key })),
        );
        if (config.success) toast.success(config.success);
        await config.onSuccess?.(vars);
        return true;
      } catch (err) {
        rollback?.();
        if (err instanceof ApiError && err.isOffline) {
          // Went offline mid-flight: keep the change rather than losing it.
          enqueue({ ...req, id: uuid(), label: config.queued });
          config.optimistic?.(vars);
          toast.info(config.queued ?? 'ذخیره شد. بعد از اتصال به اینترنت ارسال می‌شود.');
          return true;
        }
        toast.error(errorMessage(err));
        return false;
      } finally {
        setPending(false);
      }
    },
    [config, online, queryClient, toast],
  );

  return { run, pending };
}

/** Replays queued writes and reports the outcome. */
export function useSyncNow() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const syncNow = useCallback(async () => {
    setBusy(true);
    try {
      const result = await flushPendingOps();
      await queryClient.invalidateQueries();
      if (result.applied > 0 && result.failed === 0) {
        toast.success(`${result.applied} تغییر ذخیره‌شده با سرور همگام شد.`);
      } else if (result.failed > 0) {
        toast.warning(`${result.failed} تغییر قابل اعمال نبود. جزئیات در بخش تنظیمات.`);
      } else if (result.remaining > 0) {
        toast.warning('همگام‌سازی کامل نشد. بعداً دوباره تلاش کنید.');
      } else {
        toast.info('همه‌چیز همگام است.');
      }
    } finally {
      setBusy(false);
    }
  }, [queryClient, toast]);

  return { syncNow, busy };
}
