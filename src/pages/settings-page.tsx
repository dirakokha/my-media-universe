import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Database,
  Download,
  HardDrive,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Moon,
  RefreshCw,
  Shield,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { PageHeader } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { Field, Input, Select } from '../components/ui/field';
import { Modal, ConfirmDialog } from '../components/ui/modal';
import { SectionCard } from '../components/ui/settings-bits';
import { Badge, Num, Skeleton, Toggle } from '../components/ui/bits';
import { useAuth } from '../hooks/use-auth';
import { useTheme } from '../hooks/use-theme';
import { useToast } from '../hooks/use-toast';
import { useOnline } from '../hooks/use-online';
import { useBackups, useDriveStatus } from '../hooks/use-library';
import { api, errorMessage } from '../lib/api';
import { deriveAuthKey, generateRecoveryKey, generateSalt, passwordIssues } from '../lib/auth';
import { clearLocalCache } from '../lib/query';
import { failedOps, clearFailedOps, getSyncState, subscribeSync, resetQueue, type FailedOp, type SyncState } from '../lib/sync';
import { useSyncNow } from '../hooks/use-offline-action';
import { formatJalaliLong, toPersianDigits } from '../shared/jalali';
import type { BackupFile, BackupSummary, DriveStatus, SessionInfo } from '../shared/types';

type Section = 'profile' | 'appearance' | 'security' | 'drive' | 'data' | 'sync';

const SECTIONS: { key: Section; label: string; icon: typeof UserRound }[] = [
  { key: 'profile', label: 'حساب کاربری', icon: UserRound },
  { key: 'appearance', label: 'ظاهر', icon: Sun },
  { key: 'security', label: 'امنیت', icon: Shield },
  { key: 'drive', label: 'Google Drive', icon: Cloud },
  { key: 'data', label: 'داده‌ها', icon: Database },
  { key: 'sync', label: 'همگام‌سازی', icon: RefreshCw },
];

export function SettingsPage() {
  const [params] = useSearchParams();
  const initial = (['profile', 'appearance', 'security', 'drive', 'data', 'sync'] as Section[]).includes(params.get('tab') as Section)
    ? (params.get('tab') as Section)
    : params.get('google')
      ? 'drive'
      : 'profile';
  const [section, setSection] = useState<Section>(initial);
  const toast = useToast();

  const googleResult = params.get('google');
  useEffect(() => {
    if (googleResult === 'connected') toast.success('Google Drive متصل شد.');
    if (googleResult === 'error') toast.error(`اتصال به Google Drive انجام نشد (${params.get('reason') ?? 'نامشخص'}).`);
  }, [googleResult, params, toast]);

  return (
    <>
      <PageHeader title="تنظیمات" subtitle="حساب، امنیت، پشتیبان‌گیری و داده‌های شما" />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="بخش‌های تنظیمات">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              data-active={section === s.key}
              onClick={() => setSection(s.key)}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] text-ink-soft transition-colors hover:bg-raised/60 hover:text-ink data-[active=true]:bg-raised data-[active=true]:font-semibold data-[active=true]:text-ink"
            >
              <s.icon size={16} className={section === s.key ? 'text-accent' : ''} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === 'profile' && <ProfileSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'drive' && <DriveSection />}
          {section === 'data' && <DataSection />}
          {section === 'sync' && <SyncSection />}
        </div>
      </div>
    </>
  );
}

/* ───────────────────────────────────────────────────────────── */

function ProfileSection() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const { salt } = await api.get<{ salt: string }>(`/api/auth/salt?identifier=${encodeURIComponent(user.username)}`);
      const authKey = await deriveAuthKey(password, salt);
      const result = await api.post<{ devOtp?: string }>('/api/auth/change-email', { email, authKey });
      toast.success('ایمیل تغییر کرد. کد تأیید به ایمیل جدید ارسال شد.');
      if (result.devOtp) toast.info(`حالت توسعه — کد: ${result.devOtp}`);
      setPassword('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-4">
      <SectionCard title="اطلاعات حساب" icon={<UserRound size={15} />}>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-[18px] font-bold text-accent">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">{user.username}</p>
            <p className="flex items-center gap-1.5 text-[12px] text-ink-faint">
              <Mail size={12} />
              <span className="ltr" dir="ltr">{user.email}</span>
              {user.emailVerified ? (
                <span className="flex items-center gap-0.5 text-success"><ShieldCheck size={12} /> تأیید شده</span>
              ) : (
                <span className="text-accent">تأیید نشده</span>
              )}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">
              نقش: {user.role === 'admin' ? 'مدیر' : 'عضو'} · عضویت از {formatJalaliLong(new Date(user.createdAt).toISOString().slice(0, 10))}
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-lg bg-raised/50 px-3 py-2 text-[11.5px] leading-5 text-ink-faint">
          نام کاربری برای جلوگیری از سردرگمی در دعوت‌ها و پشتیبان‌ها ثابت است. اگر نیاز به تغییر دارید، با مدیر تماس بگیرید.
        </p>
      </SectionCard>

      <SectionCard title="تغییر ایمیل" icon={<Mail size={15} />} description="برای تغییر ایمیل، رمز عبور فعلی لازم است. ایمیل جدید باید تأیید شود.">
        <form onSubmit={changeEmail} className="space-y-3">
          {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
          <Field label="ایمیل جدید">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="ltr text-start" required />
          </Field>
          <Field label="رمز عبور فعلی">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>تغییر ایمیل</Button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { user, updatePreferences } = useAuth();
  const [language, setLanguage] = useState<'fa' | 'en'>(user?.preferences.language ?? 'fa');
  const [autoBackup, setAutoBackup] = useState(user?.preferences.autoBackup ?? false);
  const toast = useToast();

  const save = async (patch: { theme?: 'dark' | 'light'; language?: 'fa' | 'en'; autoBackup?: boolean }) => {
    try {
      await updatePreferences(patch);
      toast.success('تنظیمات ذخیره شد.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="پوسته" icon={theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />} description="پوسته روی همین دستگاه و همچنین روی حساب شما ذخیره می‌شود.">
        <div className="grid grid-cols-2 gap-3">
          {(['dark', 'light'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              data-active={theme === mode}
              onClick={() => setTheme(mode)}
              className="rounded-xl border border-line bg-raised/40 p-3 text-start transition-colors hover:bg-raised data-[active=true]:border-accent data-[active=true]:bg-accent/10"
            >
              <span className="mb-2 block h-16 rounded-lg border border-line" style={{ background: mode === 'dark' ? 'linear-gradient(135deg,#12141a,#1c2029)' : 'linear-gradient(135deg,#fafaf8,#e9e9e3)' }} />
              <span className="flex items-center justify-between text-[13px] font-medium text-ink">
                {mode === 'dark' ? 'تاریک (پیش‌فرض)' : 'روشن'}
                {theme === mode && <Check size={15} className="text-accent" />}
              </span>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="زبان" icon={<span className="text-[12px] font-bold">آ</span>} description="رابط کاربری فارسی است. این ترجیح برای نسخه‌های بعدی و قالب پشتیبان‌ها ذخیره می‌شود.">
        <Select value={language} onChange={(e) => { setLanguage(e.target.value as 'fa' | 'en'); void save({ language: e.target.value as 'fa' | 'en' }); }} className="max-w-[240px]">
          <option value="fa">فارسی</option>
          <option value="en">English (به‌زودی)</option>
        </Select>
      </SectionCard>

      <SectionCard title="پشتیبان‌گیری خودکار" icon={<Cloud size={15} />} description="هر روز یک پشتیبان از داده‌های شما در پوشه‌ی اختصاصی Google Drive ساخته می‌شود (نیازمند اتصال Drive).">
        <Toggle checked={autoBackup} onChange={(v) => { setAutoBackup(v); void save({ autoBackup: v }); }} label="پشتیبان‌گیری روزانه" description="فقط وقتی Google Drive متصل باشد انجام می‌شود." />
      </SectionCard>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function SecuritySection() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busyPw, setBusyPw] = useState(false);
  const [errorPw, setErrorPw] = useState<string | null>(null);

  const [regenPw, setRegenPw] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busyRegen, setBusyRegen] = useState(false);
  const [regenAck, setRegenAck] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ sessions: SessionInfo[] }>('/api/auth/sessions'),
  });
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  const saltFor = async (): Promise<string> => {
    if (!user) throw new Error('وارد نشده‌اید');
    const { salt } = await api.get<{ salt: string }>(`/api/auth/salt?identifier=${encodeURIComponent(user.username)}`);
    return salt;
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setErrorPw(null);
    if (newPw !== confirmPw) return setErrorPw('تکرار رمز جدید یکسان نیست.');
    if (passwordIssues(newPw).length) return setErrorPw('رمز جدید شرایط لازم را ندارد (حداقل ۱۰ نویسه، شامل حروف و عدد).');
    setBusyPw(true);
    try {
      const currentSalt = await saltFor();
      const currentAuthKey = await deriveAuthKey(currentPw, currentSalt);
      const salt = generateSalt();
      const authKey = await deriveAuthKey(newPw, salt);
      await api.post('/api/auth/change-password', { currentAuthKey, salt, authKey });
      toast.success('رمز عبور تغییر کرد. سایر دستگاه‌ها از حساب خارج شدند.');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      setErrorPw(errorMessage(err));
    } finally {
      setBusyPw(false);
    }
  };

  const regenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newKey) {
      if (!regenPw) return;
      setBusyRegen(true);
      try {
        const salt = await saltFor();
        const authKey = await deriveAuthKey(regenPw, salt);
        const recoveryKey = generateRecoveryKey();
        await api.post('/api/auth/recovery/regenerate', { authKey, recoveryKey });
        setNewKey(recoveryKey);
        setRegenPw('');
        toast.success('کلید بازیابی جدید ساخته شد. آن را همین حالا ذخیره کنید.');
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusyRegen(false);
      }
      return;
    }
    if (!regenAck) return;
    setNewKey(null);
    setRegenAck(false);
    toast.success('کلید قبلی دیگر معتبر نیست.');
  };

  const revoke = async (id: string) => {
    try {
      await api.delete(`/api/auth/sessions/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('آن نشست بسته شد.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const logoutAll = async () => {
    try {
      await api.post('/api/auth/logout-all');
      queryClient.clear();
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <SectionCard title="تغییر رمز عبور" icon={<Lock size={15} />} description="پس از تغییر، همه‌ی دستگاه‌های دیگر از حساب خارج می‌شوند.">
        <form onSubmit={changePassword} className="space-y-3">
          {errorPw && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{errorPw}</div>}
          <Field label="رمز عبور فعلی">
            <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="رمز عبور جدید" hint="حداقل ۱۰ نویسه، شامل حروف و عدد.">
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" required />
            </Field>
            <Field label="تکرار رمز جدید">
              <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" required />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busyPw} disabled={!currentPw || !newPw || !confirmPw}>تغییر رمز</Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="کلید بازیابی" icon={<KeyRound size={15} />} description="اگر رمز و ایمیل را از دست بدهید، تنها راه بازگشت به حساب کلید بازیابی است. کلید جدید فقط یک بار نشان داده می‌شود.">
        {newKey ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-accent/30 bg-accent/[0.07] p-4">
              <p className="text-[12px] font-semibold text-ink">کلید بازیابی جدید</p>
              <code className="mt-2 block break-all rounded-lg bg-canvas/70 px-3 py-2.5 text-center text-[13px] font-semibold tracking-[0.12em] text-accent ltr" dir="ltr">{newKey}</code>
              <p className="mt-2 text-[11px] leading-5 text-ink-faint">همین حالا در یک جای امن (مثلاً مدیر رمز عبور) ذخیره کنید. کلید قبلی باطل شده است.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={regenAck} onChange={(e) => setRegenAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-accent))]" />
              <span className="text-[12.5px] text-ink-soft">کلید جدید را ذخیره کرده‌ام</span>
            </label>
            <Button variant="primary" disabled={!regenAck} onClick={regenerate}>بستن</Button>
          </div>
        ) : (
          <form onSubmit={regenerate} className="space-y-3">
            <Field label="رمز عبور فعلی">
              <Input type="password" value={regenPw} onChange={(e) => setRegenPw(e.target.value)} autoComplete="current-password" required />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" loading={busyRegen} disabled={!regenPw} icon={<KeyRound size={14} />}>ساخت کلید جدید</Button>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard title="دستگاه‌ها و نشست‌ها" icon={<Laptop size={15} />} description="نشست‌ها تا ۳۰ روز پس از آخرین استفاده معتبرند.">
        {sessionsQuery.isLoading ? <Skeleton className="h-20 w-full" /> : sessions.length === 0 ? <p className="text-[12px] text-ink-faint">نشستی پیدا نشد.</p> : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-soft">
                  {/android|iphone|ipad|mobile/i.test(s.userAgent ?? '') ? <Smartphone size={16} /> : <Laptop size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-ink">{describeAgent(s.userAgent)}</p>
                  <p className="text-[11px] text-ink-faint">
                    آخرین فعالیت: {formatJalaliLong(new Date(s.lastSeenAt).toISOString().slice(0, 10))}
                    {s.ip && <> · <span className="ltr" dir="ltr">{s.ip}</span></>}
                  </p>
                </div>
                {s.current ? (
                  <Badge color="#3ecf8e">این دستگاه</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setRevokeId(s.id)} className="text-danger">بستن</Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <Button variant="danger" size="sm" icon={<LogOut size={13} />} onClick={() => setLogoutAllOpen(true)}>خروج از همه‌ی دستگاه‌ها</Button>
        </div>
      </SectionCard>

      <ConfirmDialog open={revokeId !== null} onClose={() => setRevokeId(null)} onConfirm={() => (revokeId ? revoke(revokeId) : undefined)} title="بستن این نشست" message="آن دستگاه باید دوباره وارد شود." confirmLabel="بستن نشست" />
      <ConfirmDialog open={logoutAllOpen} onClose={() => setLogoutAllOpen(false)} onConfirm={logoutAll} title="خروج از همه‌ی دستگاه‌ها" message="شما هم از این دستگاه خارج می‌شوید." confirmLabel="خروج از همه" />
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'دستگاه ناشناخته';
  const os = /Windows/i.test(ua) ? 'ویندوز' : /Android/i.test(ua) ? 'اندروید' : /iPhone|iPad/i.test(ua) ? 'آیفون/آیپد' : /Mac/i.test(ua) ? 'مک' : /Linux/i.test(ua) ? 'لینوکس' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'کروم' : /Firefox\//.test(ua) ? 'فایرفاکس' : /Safari\//.test(ua) ? 'سافاری' : '';
  return [os, browser].filter(Boolean).join(' · ') || 'مرورگر ناشناخته';
}

/* ───────────────────────────────────────────────────────────── */

function DriveSection() {
  const statusQuery = useDriveStatus();
  const backupsQuery = useBackups();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, updatePreferences } = useAuth();
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'create' | string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ backup: BackupFile; summary: BackupSummary; sample: { title: string; kind: string; isAnime: boolean }[] } | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const status: DriveStatus | undefined = statusQuery.data;

  const connect = async () => {
    setBusy('connect');
    try {
      const { url } = await api.post<{ url: string }>('/api/backup/google/connect');
      window.location.assign(url);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.post('/api/backup/google/disconnect');
      toast.success('اتصال Google Drive قطع شد. فایل‌های پشتیبان قبلی در Drive شما باقی می‌مانند.');
      await queryClient.invalidateQueries({ queryKey: ['drive'] });
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy('create');
    try {
      const r = await api.post<{ itemCount: number; sizeBytes: number }>('/api/backup/create');
      toast.success(`پشتیبان ساخته شد (${toPersianDigits(r.itemCount)} عنوان).`);
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openPreview = async (backup: BackupFile) => {
    setBusy(backup.id);
    try {
      const r = await api.get<{ summary: BackupSummary; sample: { title: string; kind: string; isAnime: boolean }[] }>(`/api/backup/${backup.id}/preview`);
      setPreview({ backup, summary: r.summary, sample: r.sample });
      setPreviewOpen(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!preview) return;
    setBusy('restore');
    try {
      const r = await api.post<{ inserted: number }>(`/api/backup/${preview.backup.id}/restore`, { mode: restoreMode, confirm: true });
      toast.success(`بازیابی انجام شد: ${toPersianDigits(r.inserted)} عنوان.`);
      setPreviewOpen(false);
      setRestoreOpen(false);
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!preview) return;
    try {
      await api.delete(`/api/backup/${preview.backup.id}`);
      toast.success('پشتیبان حذف شد.');
      setDeleteOpen(false);
      setPreviewOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const setAuto = async (v: boolean) => {
    try {
      await api.post('/api/backup/auto', { enabled: v });
      await updatePreferences({ autoBackup: v });
      await queryClient.invalidateQueries({ queryKey: ['drive'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="اتصال Google Drive" icon={<Cloud size={15} />} description="پشتیبان‌ها در یک پوشه‌ی اختصاصی به نام «My Media Universe» در Drive شما ذخیره می‌شوند. برنامه فقط به همین پوشه دسترسی دارد (drive.file).">
        {statusQuery.isLoading ? <Skeleton className="h-16 w-full" /> : status && (
          <>
            {!status.configured && (
              <div className="mb-3 rounded-xl border border-accent/30 bg-accent/[0.07] px-3.5 py-3 text-[12px] leading-6 text-ink-soft">
                کلاینت Google OAuth هنوز تنظیم نشده است. مدیر باید <code className="ltr" dir="ltr">GOOGLE_CLIENT_ID</code> و <code className="ltr" dir="ltr">GOOGLE_CLIENT_SECRET</code> را در تنظیمات Worker قرار دهد.
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/40 px-4 py-3">
              <div className="flex items-center gap-3">
                {status.connected ? <Cloud size={20} className="text-success" /> : <CloudOff size={20} className="text-ink-faint" />}
                <div>
                  <p className="text-[13px] font-medium text-ink">{status.connected ? 'متصل' : 'متصل نیست'}</p>
                  <p className="text-[11.5px] text-ink-faint ltr" dir="ltr">{status.connected ? status.googleEmail : status.folderName}</p>
                </div>
              </div>
              {status.connected ? (
                <Button variant="danger" size="sm" loading={busy === 'disconnect'} onClick={disconnect}>قطع اتصال</Button>
              ) : (
                <Button variant="primary" size="sm" loading={busy === 'connect'} disabled={!status.configured} onClick={connect} icon={<HardDrive size={14} />}>
                  اتصال به Google Drive
                </Button>
              )}
            </div>
            {status.connected && (
              <div className="mt-3">
                <Toggle checked={Boolean(user?.preferences.autoBackup)} onChange={setAuto} label="پشتیبان‌گیری روزانه خودکار" description="هر ۲۴ ساعت، حداکثر ۲۵ پشتیبان نگه داشته می‌شود." />
              </div>
            )}
          </>
        )}
      </SectionCard>

      {status?.connected && (
        <SectionCard
          title="پشتیبان‌ها"
          icon={<HardDrive size={15} />}
          description="هر پشتیبان یک فایل JSON در Drive شماست. پیش از بازیابی می‌توانید محتوای آن را ببینید."
          action={<Button variant="primary" size="sm" loading={busy === 'create'} onClick={create} icon={<Upload size={13} />}>ساخت پشتیبان الان</Button>}
        >
          {backupsQuery.isLoading ? <Skeleton className="h-20 w-full" /> : (backupsQuery.data?.backups.length ?? 0) === 0 ? (
            <p className="text-[12px] text-ink-faint">هنوز پشتیبانی ساخته نشده است.</p>
          ) : (
            <ul className="divide-y divide-line">
              {backupsQuery.data!.backups.map((b) => {
                const expired = b.createdAt < Date.now() - 30 * 86_400_000;
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-ink ltr" dir="ltr">{b.name}</p>
                      <p className="text-[11px] text-ink-faint">
                        {formatJalaliLong(new Date(b.createdAt).toISOString().slice(0, 10))} · <Num>{b.itemCount}</Num> عنوان · <Num>{Math.max(1, Math.round(b.sizeBytes / 1024))}</Num> کیلوبایت · {b.kind === 'auto' ? 'خودکار' : 'دستی'}
                      </p>
                    </div>
                    <Badge color={expired ? '#e0a63c' : undefined}>{expired ? 'قدیمی' : `نسخه ${toPersianDigits(b.schemaVersion)}`}</Badge>
                    <Button variant="secondary" size="sm" loading={busy === b.id} onClick={() => openPreview(b)}>مشاهده</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} size="lg" title="پیش‌نمایش پشتیبان" description={preview?.backup.name} footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setDeleteOpen(true)}>حذف پشتیبان</Button>
          <div className="flex items-center gap-2">
            <div className="segmented">
              <button type="button" data-active={restoreMode === 'merge'} onClick={() => setRestoreMode('merge')}>ادغام</button>
              <button type="button" data-active={restoreMode === 'replace'} onClick={() => setRestoreMode('replace')}>جایگزینی کامل</button>
            </div>
            <Button variant="primary" size="sm" onClick={() => setRestoreOpen(true)}>بازیابی</Button>
          </div>
        </div>
      }>
        {preview && (
          <div className="space-y-4">
            <BackupSummaryView summary={preview.summary} />
            <div>
              <p className="mb-2 text-[12px] font-medium text-ink">نمونه‌ای از عنوان‌ها</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {preview.sample.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-raised/40 px-3 py-1.5 text-[12px] text-ink-soft">
                    <span className="truncate flex-1">{s.title}</span>
                    <Badge color={s.kind === 'movie' ? '#5aa9ff' : '#b98cff'}>{s.kind === 'movie' ? 'فیلم' : 'سریال'}{s.isAnime ? ' · انیمه' : ''}</Badge>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl bg-raised/50 px-3 py-2 text-[11.5px] leading-5 text-ink-faint">
              <strong className="text-ink-soft">ادغام:</strong> عنوان‌های موجود به‌روز می‌شوند و جدیدها اضافه می‌شوند؛ چیزی حذف نمی‌شود.
              <br />
              <strong className="text-ink-soft">جایگزینی کامل:</strong> کل کتابخانه فعلی با محتوای پشتیبان عوض می‌شود.
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} onConfirm={restore} danger={restoreMode === 'replace'} title={restoreMode === 'replace' ? 'جایگزینی کامل کتابخانه' : 'ادغام پشتیبان'} confirmLabel={restoreMode === 'replace' ? 'جایگزینی کن' : 'ادغام کن'} loading={busy === 'restore'}
        message={restoreMode === 'replace' ? 'همه‌ی عنوان‌ها، دسته‌ها، فهرست‌ها و تاریخچه‌ی تماشای فعلی با محتوای پشتیبان جایگزین می‌شوند. این کار قابل بازگشت نیست.' : 'عنوان‌های پشتیبان با موارد فعلی ادغام می‌شوند. موارد تکراری به‌روز می‌شوند.'} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={remove} danger title="حذف پشتیبان" confirmLabel="حذف" message="فایل از Google Drive شما حذف می‌شود." />
    </div>
  );
}

function BackupSummaryView({ summary }: { summary: BackupSummary }) {
  const tiles: [string, number | string | null][] = [
    ['عنوان‌ها', summary.counts.mediaItems],
    ['قسمت‌ها', summary.counts.episodes],
    ['تماشاها', summary.counts.watchEvents],
    ['دسته‌ها', summary.counts.categories],
    ['فهرست‌ها', summary.counts.lists],
    ['نسخه‌ی قالب', summary.schemaVersion],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-raised/40 p-3">
            <p className="text-[10.5px] text-ink-faint">{label}</p>
            <p className="mt-1 text-[18px] font-semibold text-ink tabular"><Num>{value ?? '—'}</Num></p>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-ink-faint">
        فیلم <Num>{summary.mediaTypes.movie}</Num> · سریال <Num>{summary.mediaTypes.series}</Num> · انیمه <Num>{summary.mediaTypes.anime}</Num>
        {summary.exportedAt && <> · ساخته‌شده در {formatJalaliLong(summary.exportedAt.slice(0, 10))}</>}
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function DataSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busyExport, setBusyExport] = useState(false);
  const [importData, setImportData] = useState<unknown>(null);
  const [importSummary, setImportSummary] = useState<BackupSummary | null>(null);
  const [importName, setImportName] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importOpen, setImportOpen] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const exportJson = async () => {
    setBusyExport(true);
    try {
      const res = await fetch('/api/account/export', { credentials: 'include' });
      if (!res.ok) throw new Error('دریافت فایل ممکن نشد.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-media-universe-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('فایل پشتیبان دانلود شد.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyExport(false);
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('حجم فایل بیش از ۲۰ مگابایت است.');
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      const r = await api.post<{ summary: BackupSummary }>('/api/backup/validate', { data });
      setImportData(data);
      setImportSummary(r.summary);
      setImportName(file.name);
      setImportOpen(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const r = await api.post<{ inserted: number }>('/api/account/import', { data: importData, mode: importMode, confirm: true });
      toast.success(`درون‌ریزی انجام شد: ${toPersianDigits(r.inserted)} عنوان.`);
      setImportConfirm(false);
      setImportOpen(false);
      setImportData(null);
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete('/api/account', { confirm: true });
      await clearLocalCache();
      await resetQueue();
      await logout();
      toast.success('حساب و داده‌های شما حذف شد.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="خروجی قابل حمل (JSON)" icon={<Download size={15} />} description="کل کتابخانه، امتیازها، یادداشت‌ها، فهرست‌ها و تاریخچه‌ی تماشا در یک فایل JSON. این فایل را در جای امن نگه دارید.">
        <Button variant="primary" icon={<Download size={14} />} loading={busyExport} onClick={exportJson}>دانلود فایل پشتیبان</Button>
      </SectionCard>

      <SectionCard title="درون‌ریزی از فایل" icon={<Upload size={15} />} description="فایل پشتیبان (JSON) این برنامه را انتخاب کنید. پیش از اعمال، خلاصه‌ی محتوا نشان داده می‌شود.">
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button variant="secondary" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>انتخاب فایل</Button>
      </SectionCard>

      <SectionCard title="حذف حساب" icon={<AlertTriangle size={15} className="text-danger" />} description="همه‌ی داده‌های شما برای همیشه از سرور حذف می‌شود. پشتیبان‌های قبلی در Google Drive شما (در صورت وجود) باقی می‌مانند و باید خودتان آن‌ها را پاک کنید.">
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => { setDeleteText(''); setDeleteOpen(true); }}>حذف حساب و داده‌ها</Button>
      </SectionCard>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} size="lg" title="پیش‌نمایش فایل" description={importName} footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="segmented">
            <button type="button" data-active={importMode === 'merge'} onClick={() => setImportMode('merge')}>ادغام</button>
            <button type="button" data-active={importMode === 'replace'} onClick={() => setImportMode('replace')}>جایگزینی کامل</button>
          </div>
          <Button variant="primary" size="sm" onClick={() => setImportConfirm(true)}>ادامه</Button>
        </div>
      }>
        {importSummary && (
          <div className="space-y-4">
            <BackupSummaryView summary={importSummary} />
            {Array.isArray((importData as { mediaItems?: unknown[] })?.mediaItems) && (
              <div>
                <p className="mb-2 text-[12px] font-medium text-ink">نمونه‌ای از عنوان‌ها</p>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {(importData as { mediaItems: { title: string; kind: string; isAnime?: boolean }[] }).mediaItems.slice(0, 12).map((m, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg bg-raised/40 px-3 py-1.5 text-[12px] text-ink-soft">
                      <span className="truncate flex-1">{m.title}</span>
                      <Badge color={m.kind === 'movie' ? '#5aa9ff' : '#b98cff'}>{m.kind === 'movie' ? 'فیلم' : 'سریال'}{m.isAnime ? ' · انیمه' : ''}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={importConfirm} onClose={() => setImportConfirm(false)} onConfirm={doImport} danger={importMode === 'replace'} loading={importing} title={importMode === 'replace' ? 'جایگزینی کامل' : 'ادغام فایل'} confirmLabel={importMode === 'replace' ? 'جایگزینی کن' : 'ادغام کن'}
        message={importMode === 'replace' ? 'داده‌های فعلی با فایل جایگزین می‌شوند. این کار قابل بازگشت نیست.' : 'محتوای فایل با داده‌های فعلی ادغام می‌شود.'} />

      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={deleteAccount} danger loading={deleting} title="حذف کامل حساب" confirmLabel="برای همیشه حذف کن"
        message={
          <div className="space-y-3">
            <p>برای تأیید، عبارت <strong className="text-ink">حذف</strong> را در کادر زیر بنویسید.</p>
            <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} className="h-10 w-full rounded-[10px] border border-line bg-canvas px-3 text-[13px] text-ink" />
            {deleteText.trim() !== 'حذف' && <p className="text-[11px] text-danger">تأیید نوشته نشده است.</p>}
          </div>
        }
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function SyncSection() {
  const { syncNow, busy } = useSyncNow();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SyncState>(getSyncState());
  const [failed, setFailed] = useState<FailedOp[]>([]);
  const online = useOnline();
  const toast = useToast();

  useEffect(() => {
    const unsub = subscribeSync(setState);
    void failedOps().then(setFailed);
    return unsub;
  }, []);

  const clearFailed = async () => {
    await clearFailedOps();
    setFailed([]);
    toast.success('فهرست تغییرات ناموفق پاک شد.');
  };

  return (
    <div className="space-y-4">
      <SectionCard title="وضعیت اتصال" icon={online ? <WifiOff size={15} className="text-success" /> : <CloudOff size={15} className="text-accent" />}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-ink">{online ? 'متصل به اینترنت' : 'آفلاین'}</p>
            <p className="text-[11.5px] text-ink-faint">
              {state.pending > 0 ? <><Num>{state.pending}</Num> تغییر در انتظار ارسال</> : state.flushing ? 'در حال ارسال تغییرات…' : 'همه‌ی تغییرات همگام شده‌اند'}
              {state.lastError && <> · آخرین خطا: {state.lastError}</>}
            </p>
          </div>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void syncNow()} icon={<RefreshCw size={13} />}>همگام‌سازی الان</Button>
        </div>
      </SectionCard>

      <SectionCard title="تغییرات ناموفق" icon={<AlertTriangle size={15} />} description="اگر تغییری با خطای قطعی رد شود، برای جلوگیری از گم‌شدن، اینجا نگه داشته می‌شود.">
        {failed.length === 0 ? <p className="text-[12px] text-ink-faint">هیچ تغییر ناموفقی ندارید.</p> : (
          <ul className="space-y-2">
            {failed.map((op) => (
              <li key={op.id} className="rounded-lg border border-line bg-raised/40 px-3 py-2 text-[11.5px]">
                <p className="text-ink-soft">{op.label ?? `${op.method} ${op.path}`}</p>
                <p className="text-danger">{op.error} ({toPersianDigits(op.status)})</p>
              </li>
            ))}
          </ul>
        )}
        {failed.length > 0 && <div className="mt-3 flex justify-end"><Button variant="secondary" size="sm" onClick={clearFailed}>پاک کردن فهرست</Button></div>}
      </SectionCard>

      <SectionCard title="حافظه‌ی محلی" icon={<Database size={15} />} description="برای تماشای آفلاین، بخشی از داده‌ها روی همین دستگاه نگه داشته می‌شود (حداکثر ۱۴ روز).">
        <Button variant="secondary" size="sm" onClick={async () => { await clearLocalCache(); await queryClient.invalidateQueries(); toast.success('حافظه‌ی محلی پاک شد.'); }}>پاک کردن حافظه‌ی محلی</Button>
      </SectionCard>

      <p className="text-[10.5px] leading-5 text-ink-faint">
        داده‌های فیلم و سریال از TMDB می‌آید. این محصول از API TMDB استفاده می‌کند اما وابسته به TMDB یا تأییدشده توسط آن نیست.
      </p>
    </div>
  );
}

