import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  BackupFile,
  Category,
  DriveStatus,
  MediaDetail,
  MediaItem,
  MediaList,
  Paginated,
  StatsPayload,
} from '../shared/types';
import type { LibraryFilters } from '../shared/types';

export const libraryKeys = {
  all: ['library'] as const,
  list: (filters: LibraryFilters) => ['library', 'list', filters] as const,
  detail: (id: string) => ['library', 'detail', id] as const,
};

export function useLibrary(filters: LibraryFilters = {}) {
  return useQuery({
    queryKey: libraryKeys.list(filters),
    queryFn: () => api.get<Paginated<MediaItem>>('/api/library?' + new URLSearchParams(
      Object.entries(filters).reduce<Record<string, string>>((acc, [k, v]) => {
        if (v !== undefined && v !== '' && v !== null) acc[k] = String(v);
        return acc;
      }, {}),
    ).toString()),
    staleTime: 30_000,
  });
}

export function useInfiniteLibrary(filters: Omit<LibraryFilters, 'limit' | 'offset'> = {}, pageSize = 40) {
  return useInfiniteQuery({
    queryKey: ['library', 'infinite', filters, pageSize],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
      }
      params.set('limit', String(pageSize));
      params.set('offset', String(pageParam));
      return api.get<Paginated<MediaItem>>(`/api/library?${params.toString()}`);
    },
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
    staleTime: 30_000,
  });
}

export function useMediaDetail(id: string | undefined) {
  return useQuery({
    queryKey: libraryKeys.detail(id ?? ''),
    queryFn: () => api.get<MediaDetail>(`/api/library/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ categories: Category[] }>('/api/collections/categories'),
    staleTime: 60_000,
  });
}

export function useLists() {
  return useQuery({
    queryKey: ['lists'],
    queryFn: () => api.get<{ lists: MediaList[]; watchlistId: string }>('/api/collections/lists'),
    staleTime: 60_000,
  });
}

export function useList(id: string | undefined) {
  return useQuery({
    queryKey: ['list', id],
    queryFn: () => api.get<{ list: MediaList; items: MediaItem[] }>(`/api/collections/lists/${id}`),
    enabled: Boolean(id),
  });
}

export function useStats(range: string, from?: string, to?: string) {
  const params = new URLSearchParams({ range });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return useQuery({
    queryKey: ['stats', range, from ?? '', to ?? ''],
    queryFn: () => api.get<StatsPayload>(`/api/stats?${params.toString()}`),
    staleTime: 60_000,
  });
}

export function useDriveStatus() {
  return useQuery({
    queryKey: ['drive', 'status'],
    queryFn: () => api.get<DriveStatus>('/api/backup/google/status'),
    staleTime: 30_000,
  });
}

export function useBackups() {
  return useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ backups: BackupFile[] }>('/api/backup/list'),
    staleTime: 30_000,
  });
}

/** Invalidates everything that depends on library content. */
export function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['library'] });
}
