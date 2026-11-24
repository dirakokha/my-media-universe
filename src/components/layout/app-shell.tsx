import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  ChevronsUpDown,
  Cloud,
  CloudOff,
  Film,
  Home,
  ListVideo,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Tv,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../hooks/use-auth';
import { useTheme } from '../../hooks/use-theme';
import { subscribeSync, type SyncState } from '../../lib/sync';
import { APP_NAME_FA } from '../../shared/constants';
import { toPersianDigits } from '../../shared/jalali';
import { Button } from '../ui/button';
import { Dropdown, MenuItem, MenuSeparator } from '../ui/dropdown';

/* ── Logo ─────────────────────────────────────────────────────────────── */

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="rgb(var(--c-accent))" />
      <path d="M9 22.5V10.2l7 5.4 7-5.4v12.3" stroke="rgb(var(--c-accent-ink))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="24.6" r="1.3" fill="rgb(var(--c-accent-ink))" />
    </svg>
  );
}

/* ── Sync indicator ───────────────────────────────────────────────────── */

export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>({ pending: 0, flushing: false, lastFlushAt: null, lastError: null });
  useEffect(() => subscribeSync(setState), []);
  return state;
}

function SyncDot() {
  const sync = useSyncState();
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (!online) {
    return (
      <span
        title="آفلاین — تغییرات شما ذخیره شده‌اند"
        className="inline-flex h-2.5 w-2.5 rounded-full bg-[#e0a63c] shadow-[0_0_0_3px_rgba(224,166,60,0.18)]"
      />
    );
  }
  if (sync.flushing) {
    return <span title="در حال همگام‌سازی" className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />;
  }
  if (sync.pending > 0) {
    return (
      <span
        title={`${toPersianDigits(sync.pending)} تغییر در انتظار ارسال`}
        className="inline-flex h-2.5 w-2.5 rounded-full bg-[#e0a63c]"
      />
    );
  }
  return <span title="همگام شده" className="inline-flex h-2.5 w-2.5 rounded-full bg-success" />;
}

/* ── Sidebar ──────────────────────────────────────────────────────────── */

const NAV_MAIN = [
  { to: '/', label: 'خانه', icon: Home, end: true },
  { to: '/movies', label: 'فیلم‌ها', icon: Film },
  { to: '/series', label: 'سریال‌ها', icon: Tv },
  { to: '/anime', label: 'انیمه‌ها', icon: Sparkles },
];

const NAV_SECONDARY = [
  { to: '/lists', label: 'فهرست‌های من', icon: ListVideo },
  { to: '/stats', label: 'آمار', icon: BarChart3 },
];

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  onClick,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors',
          isActive ? 'bg-raised font-semibold text-ink' : 'text-ink-soft hover:bg-raised/60 hover:text-ink',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={[
              'absolute inset-y-2 start-0 w-[3px] rounded-full transition-opacity',
              isActive ? 'bg-accent opacity-100' : 'opacity-0',
            ].join(' ')}
          />
          <Icon size={17} strokeWidth={isActive ? 2.2 : 1.8} className={isActive ? 'text-accent' : ''} />
          <span className="flex-1">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const sync = useSyncState();
  const isAdmin = user?.role === 'admin';

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-s border-line bg-[rgb(var(--c-sidebar))] lg:flex">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <Logo size={30} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold tracking-tight text-ink">{APP_NAME_FA}</p>
          <p className="text-[10.5px] text-ink-faint">کتابخانه شخصی</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        <div className="space-y-0.5">
          {NAV_MAIN.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
        <div className="space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-faint">کتابخانه</p>
          {NAV_SECONDARY.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
        <div className="space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-faint">حساب کاربری</p>
          <NavItem to="/settings" label="تنظیمات" icon={Settings} />
          {isAdmin && <NavItem to="/admin/invitations" label="مدیریت دعوت‌ها" icon={Users} />}
        </div>
      </nav>

      <div className="space-y-2 border-t border-line px-3 py-3">
        <div className="flex items-center justify-between rounded-lg px-2 py-1">
          <span className="flex items-center gap-2 text-[11px] text-ink-faint">
            {typeof navigator !== 'undefined' && !navigator.onLine ? <CloudOff size={13} /> : <Cloud size={13} />}
            {typeof navigator !== 'undefined' && !navigator.onLine
              ? sync.pending > 0
                ? `آفلاین · ${toPersianDigits(sync.pending)} در انتظار ارسال`
                : 'آفلاین'
              : sync.pending > 0
                ? `${toPersianDigits(sync.pending)} در انتظار ارسال`
                : sync.flushing
                  ? 'در حال همگام‌سازی'
                  : 'همگام شده'}
          </span>
          <SyncDot />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-raised/50 px-2.5 py-1.5">
          <span className="flex items-center gap-2 text-[11.5px] text-ink-soft">
            {theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
            {theme === 'dark' ? 'حالت تاریک' : 'حالت روشن'}
          </span>
          <button
            type="button"
            onClick={toggle}
            role="switch"
            aria-checked={theme === 'light'}
            aria-label="تغییر پوسته"
            className="relative h-5 w-9 rounded-full bg-line-strong transition-colors data-[on=true]:bg-accent"
            data-on={theme === 'light'}
          >
            <span
              className={[
                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                theme === 'light' ? 'start-[18px]' : 'start-0.5',
              ].join(' ')}
            />
          </button>
        </div>

        {user && <UserMenu />}
      </div>

      <p className="px-5 pb-3 text-[9.5px] leading-4 text-ink-faint">
        اطلاعات فیلم و سریال از TMDB تأمین می‌شود. این محصول وابسته به TMDB نیست و توسط آن تأیید نشده است.
      </p>
    </aside>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  if (!user) return null;

  return (
    <Dropdown
      align="start"
      width={224}
      trigger={
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-raised"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-bold text-accent">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-ink">{user.username}</span>
            <span className="block truncate text-[10.5px] text-ink-faint">{user.email}</span>
          </span>
          <ChevronsUpDown size={13} className="shrink-0 text-ink-faint" />
        </button>
      }
    >
      {(close) => (
        <>
          <MenuItem icon={<Settings size={14} />} onClick={() => { close(); navigate('/settings'); }}>
            تنظیمات حساب
          </MenuItem>
          {isAdmin && (
            <MenuItem icon={<Users size={14} />} onClick={() => { close(); navigate('/admin/invitations'); }}>
              مدیریت دعوت‌ها
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={<LogOut size={14} />} danger onClick={() => { close(); void logout().then(() => navigate('/login')); }}>
            خروج از حساب
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

/* ── Mobile header + bottom navigation ────────────────────────────────── */

function MobileHeader() {
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const title =
    NAV_MAIN.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label ??
    NAV_SECONDARY.find((n) => location.pathname.startsWith(n.to))?.label ??
    (location.pathname.startsWith('/settings') ? 'تنظیمات' : null);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-[rgb(var(--c-canvas))]/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          aria-label="باز کردن منو"
          onClick={() => setMoreOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink"
        >
          <Menu size={20} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Logo size={24} />
          <span className="truncate text-[13.5px] font-bold text-ink">{title ?? APP_NAME_FA}</span>
        </div>
        <span className="pe-1"><SyncDot /></span>
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'حالت روشن' : 'حالت تاریک'}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink"
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      {moreOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label="بستن منو"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 animate-fade-in bg-black/55"
          />
          <div className="absolute inset-x-3 top-3 rounded-2xl border border-line bg-surface p-3 shadow-pop animate-scale-in">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Logo size={22} />
                <span className="text-[13px] font-bold text-ink">{APP_NAME_FA}</span>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="بستن"
                className="rounded-lg p-1.5 text-ink-faint hover:bg-raised hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {NAV_SECONDARY.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-3 text-[12.5px] text-ink"
                >
                  <item.icon size={16} className="text-ink-soft" />
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to="/search"
                className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-3 text-[12.5px] text-ink"
              >
                <Bell size={16} className="text-ink-soft" />
                جستجو
              </NavLink>
              <NavLink
                to="/settings"
                className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-3 text-[12.5px] text-ink"
              >
                <Settings size={16} className="text-ink-soft" />
                تنظیمات
              </NavLink>
              {user?.role === 'admin' && (
                <NavLink
                  to="/admin/invitations"
                  className="col-span-2 flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-3 text-[12.5px] text-ink"
                >
                  <Users size={16} className="text-ink-soft" />
                  مدیریت دعوت‌ها
                </NavLink>
              )}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void logout().then(() => navigate('/login'));
                }}
                className="col-span-2 flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-3 text-[12.5px] text-danger"
              >
                <LogOut size={16} />
                خروج از حساب
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[rgb(var(--c-canvas))]/95 backdrop-blur lg:hidden safe-bottom">
      <div className="mx-auto grid h-[62px] max-w-lg grid-cols-5 px-1">
        {NAV_MAIN.map((item) => {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] transition-colors',
                  isActive ? 'text-accent' : 'text-ink-faint hover:text-ink-soft',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={[
                      'flex h-7 w-11 items-center justify-center rounded-full transition-colors',
                      isActive ? 'bg-accent/15' : '',
                    ].join(' ')}
                  >
                    <item.icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
        <MobileMoreButton />
      </div>
    </nav>
  );
}

function MobileMoreButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = ['/lists', '/stats', '/settings', '/admin'].some((p) => location.pathname.startsWith(p));
  return (
    <button
      type="button"
      onClick={() => navigate('/lists')}
      className={[
        'flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] transition-colors',
        active ? 'text-accent' : 'text-ink-faint hover:text-ink-soft',
      ].join(' ')}
    >
      <span className={['flex h-7 w-11 items-center justify-center rounded-full transition-colors', active ? 'bg-accent/15' : ''].join(' ')}>
        <Menu size={19} strokeWidth={1.8} />
      </span>
      بیشتر
    </button>
  );
}

/* ── Shell ────────────────────────────────────────────────────────────── */

export function AppShell() {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-10 lg:pt-7">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <button
            type="button"
            onClick={() => navigate(back)}
            className="mb-2 inline-flex items-center gap-1 text-[11.5px] text-ink-faint transition-colors hover:text-ink"
          >
            ← بازگشت
          </button>
        )}
        <h1 className="text-[20px] font-bold leading-8 text-ink sm:text-[24px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[12.5px] leading-6 text-ink-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  icon,
}: {
  title: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        {icon && <span className="text-ink-faint">{icon}</span>}
        {title}
      </h2>
      {action}
    </div>
  );
}

export function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'حالت روشن' : 'حالت تاریک'}
      icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    />
  );
}

export { Button };
