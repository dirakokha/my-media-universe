import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './use-auth';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'mmu-theme';

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light') return raw;
  } catch {
    /* ignore */
  }
  return 'dark';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('light', theme === 'light');
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#fafaf8' : '#0a0b0d');
}

/**
 * Theme resolution order: explicit local choice → server preference → dark.
 * The local choice wins so the UI never flashes before the session loads.
 */
export function useTheme() {
  const { user, updatePreferences } = useAuth();
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    const serverTheme = user?.preferences?.theme;
    const initial = stored ?? serverTheme ?? 'dark';
    setThemeState(initial);
    applyTheme(initial);
    setReady(true);
  }, [user?.preferences?.theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      if (user && user.preferences.theme !== next) {
        void updatePreferences({ theme: next }).catch(() => undefined);
      }
    },
    [user, updatePreferences],
  );

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggle, ready };
}
