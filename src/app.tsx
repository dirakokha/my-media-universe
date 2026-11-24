import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, RouterProvider, createBrowserRouter, useLocation, useRouteError } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './hooks/use-toast';
import { AuthProvider, useAuth } from './hooks/use-auth';
import { queryClient } from './lib/query';
import { startSync } from './lib/sync';
import { AppShell } from './components/layout/app-shell';
import { AuthLoadingScreen, LoginPage, RegisterPage, VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage, RecoverPage, SetupPage, NotFoundPage } from './pages/auth-pages';
import { HomePage } from './pages/home-page';
import { CollectionPage, SearchPage } from './pages/library-pages';
import { ItemPage } from './pages/item-page';
import { ListsPage, ListDetailPage } from './pages/lists-pages';
import { StatsPage } from './pages/stats-page';
import { SettingsPage } from './pages/settings-page';
import { AdminPage } from './pages/admin-page';
import { useLists } from './hooks/use-library';
import { Button } from './components/ui/button';

/* ─────────────────────────────────────────────────────────────
   Guards
   ───────────────────────────────────────────────────────────── */

function FullScreenLoader() {
  return <AuthLoadingScreen />;
}

function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!user.emailVerified && location.pathname !== '/verify') return <Navigate to="/verify" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnly({ children, allowUnverified = false }: { children: ReactNode; allowUnverified?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) {
    if (user.emailVerified) return <Navigate to="/" replace />;
    if (!allowUnverified) return <Navigate to="/verify" replace />;
  }
  return <>{children}</>;
}

function VerifyGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return <AppShell />;
}

/** `/lists/watchlist` resolves the per-user automatic watchlist id. */
function WatchlistRedirect() {
  const { data } = useLists();
  useEffect(() => {
    if (!data) return;
  }, [data]);
  if (data?.watchlistId) return <Navigate to={`/lists/${data.watchlistId}`} replace />;
  return <FullScreenLoader />;
}

function CrashScreen({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'خطای نامشخص';
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-[18px] font-bold text-ink">مشکلی در نمایش این صفحه پیش آمد</h1>
      <p className="max-w-md text-[12.5px] leading-6 text-ink-faint">{message}</p>
      <Button variant="primary" onClick={() => window.location.assign('/')}>بازگشت به خانه</Button>
    </div>
  );
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }
  render() {
    if (this.state.error) return <CrashScreen error={this.state.error} />;
    return this.props.children;
  }
}

function RouteError() {
  return <CrashScreen error={useRouteError()} />;
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: <PublicOnly><LoginPage /></PublicOnly>,
  },
  {
    path: '/register',
    element: <PublicOnly><RegisterPage /></PublicOnly>,
  },
  {
    path: '/forgot-password',
    element: <PublicOnly><ForgotPasswordPage /></PublicOnly>,
  },
  {
    path: '/reset-password',
    element: <PublicOnly><ResetPasswordPage /></PublicOnly>,
  },
  {
    path: '/recover',
    element: <PublicOnly><RecoverPage /></PublicOnly>,
  },
  {
    path: '/setup',
    element: <PublicOnly allowUnverified><SetupPage /></PublicOnly>,
  },
  {
    path: '/verify',
    element: <VerifyGate><VerifyEmailPage /></VerifyGate>,
  },
  {
    path: '/',
    element: <RequireAuth><Shell /></RequireAuth>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'movies', element: <CollectionPage key="movies" kind="movie" /> },
      { path: 'series', element: <CollectionPage key="series" kind="series" /> },
      { path: 'anime', element: <CollectionPage key="anime" kind="anime" /> },
      { path: 'item/:id', element: <ItemPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'lists', element: <ListsPage /> },
      { path: 'lists/watchlist', element: <WatchlistRedirect /> },
      { path: 'lists/:id', element: <ListDetailPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'admin/invitations', element: <RequireAuth admin><AdminPage /></RequireAuth> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

/* ─────────────────────────────────────────────────────────────
   Providers
   ───────────────────────────────────────────────────────────── */

function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    let stop: (() => void) | undefined;
    void (async () => {
      stop = startSync();
    })();
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    return () => stop?.();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function App() {
  return (
    <Providers>
      <RouteErrorBoundary>
        <RouterProvider router={router} />
      </RouteErrorBoundary>
    </Providers>
  );
}

