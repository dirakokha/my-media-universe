import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User, UserPreferences } from '../shared/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  verified: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [booted, setBooted] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: User }>('/api/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!isLoading) setBooted(true);
  }, [isLoading]);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* the cookie may already be gone */
    }
    queryClient.clear();
    await refresh();
  }, [queryClient, refresh]);

  const updatePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      await api.patch<{ user: User; preferences: UserPreferences }>('/api/auth/preferences', patch);
      queryClient.setQueryData<{ user: User }>(['me'], (old) =>
        old ? { user: { ...old.user, preferences: { ...old.user.preferences, ...patch } } } : old,
      );
      await refresh();
    },
    [queryClient, refresh],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: data?.user ?? null,
      loading: !booted,
      verified: Boolean(data?.user?.emailVerified),
      refresh,
      logout,
      updatePreferences,
    }),
    [data, booted, refresh, logout, updatePreferences],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
