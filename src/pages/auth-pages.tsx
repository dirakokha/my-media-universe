import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Copy, Eye, EyeOff, KeyRound, MailCheck } from 'lucide-react';
import { AuthShell, AuthLink } from '../components/auth/auth-shell';
import { Logo } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/field';
import { ConfirmDialog } from '../components/ui/modal';
import { useAuth } from '../hooks/use-auth';
import { useToast } from '../hooks/use-toast';
import { api, errorMessage, fieldErrors } from '../lib/api';
import {
  deriveAuthKey,
  generateRecoveryKey,
  generateSalt,
  isValidRecoveryKeyShape,
  normalizeRecoveryKey,
  passwordIssues,
  uuid,
} from '../lib/auth';
import type { User } from '../shared/types';

/* ─────────────────────────────────────────────────────────────
   Shared helpers
   ───────────────────────────────────────────────────────────── */

function PasswordInput(props: { value: string; onChange: (v: string) => void; error?: boolean; autoComplete: string; id?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={props.id}
        type={show ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        error={props.error}
        autoComplete={props.autoComplete}
        className="pe-11"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'پنهان کردن رمز' : 'نمایش رمز'}
        className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors hover:text-ink"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function PasswordChecklist({ password }: { password: string }) {
  if (!password) return null;
  const checks = [
    { label: 'حداقل ۱۰ نویسه', ok: password.length >= 10 },
    { label: 'شامل حروف و عدد', ok: /[A-Za-z\u0600-\u06FF]/.test(password) && /\d/.test(password) },
    { label: 'بدون فاصله در ابتدا و انتها', ok: password === password.trim() },
  ];
  return (
    <ul className="mt-2 space-y-1">
      {checks.map((check) => (
        <li key={check.label} className={['flex items-center gap-1.5 text-[11px]', check.ok ? 'text-success' : 'text-ink-faint'].join(' ')}>
          <Check size={11} strokeWidth={3} />
          {check.label}
        </li>
      ))}
    </ul>
  );
}

function RecoveryKeyPanel({ value, onCopied }: { value: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  };
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.07] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-ink">کلید بازیابی شما</p>
          <p className="mt-1 text-[11px] leading-5 text-ink-faint">
            این کلید فقط یک بار نمایش داده می‌شود. اگر رمز عبور و ایمیل خود را از دست بدهید، تنها راه بازگشت به حساب همین است.
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-soft transition-colors hover:text-ink"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? 'کپی شد' : 'کپی'}
        </button>
      </div>
      <code className="mt-3 block break-all rounded-lg bg-canvas/70 px-3 py-2.5 text-center text-[13px] font-semibold tracking-[0.12em] text-accent ltr" dir="ltr">
        {value}
      </code>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sign in
   ───────────────────────────────────────────────────────────── */

export function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate(user.emailVerified ? '/' : '/verify', { replace: true });
  }, [user, loading, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { salt } = await api.get<{ salt: string }>(`/api/auth/salt?identifier=${encodeURIComponent(identifier)}`);
      const authKey = await deriveAuthKey(password, salt);
      const result = await api.post<{ user: User }>('/api/auth/login', { identifier, authKey });
      toast.success('خوش آمدید.');
      await refresh();
      navigate(result.user.emailVerified ? '/' : '/verify', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="ورود به حساب"
      subtitle="برای ادامه، نام کاربری و رمز عبور خود را وارد کنید."
      footer={
        <>
          حساب ندارید؟ از مدیر بخواهید برایتان کد دعوت بسازد.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] leading-6 text-danger">
            <AlertTriangle size={15} className="mt-1 shrink-0" />
            {error}
          </div>
        )}
        <Field label="نام کاربری یا ایمیل" htmlFor="identifier">
          <Input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            dir="auto"
            required
          />
        </Field>
        <Field label="رمز عبور" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!identifier || !password}>
          ورود
        </Button>
        <div className="flex items-center justify-between text-[12px]">
          <Link to="/forgot-password" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
            رمز عبور را فراموش کرده‌ام
          </Link>
          <Link to="/recover" className="flex items-center gap-1 text-ink-soft underline-offset-4 hover:text-ink hover:underline">
            <KeyRound size={12} />
            بازیابی با کلید
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sign up (invitation only)
   ───────────────────────────────────────────────────────────── */

export function RegisterPage() {
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const [invitationCode, setInvitationCode] = useState(searchParams.get('invite') ?? '');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryKey] = useState(() => generateRecoveryKey());
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loading && user) navigate(user.emailVerified ? '/' : '/verify', { replace: true });
  }, [user, loading, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrors({});
    if (password !== confirm) {
      setErrors({ confirm: 'تکرار رمز عبور یکسان نیست' });
      return;
    }
    if (passwordIssues(password).length > 0) {
      setErrors({ password: 'رمز عبور شرایط لازم را ندارد' });
      return;
    }
    if (!ack) {
      setError('برای ادامه باید تأیید کنید که کلید بازیابی را در جای امنی ذخیره کرده‌اید.');
      return;
    }
    setBusy(true);
    try {
      const salt = generateSalt();
      const authKey = await deriveAuthKey(password, salt);
      const result = await api.post<{ user: User; devOtp?: string }>('/api/auth/register', {
        invitationCode: normalizeRecoveryKey(invitationCode),
        username,
        email,
        salt,
        authKey,
        recoveryKey,
        recoveryKeyAck: true,
      });
      await refresh();
      toast.success('حساب شما ساخته شد. اکنون ایمیل خود را تأیید کنید.');
      navigate('/verify', { replace: true, state: { devOtp: result.devOtp } });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(invitationCode && username && email && password && confirm && ack);

  return (
    <AuthShell
      title="ساخت حساب کاربری"
      subtitle="ثبت‌نام در این برنامه فقط با کد دعوت انجام می‌شود."
      footer={
        <>
          قبلاً حساب ساخته‌اید؟ <AuthLink to="/login">وارد شوید</AuthLink>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] leading-6 text-danger">
            <AlertTriangle size={15} className="mt-1 shrink-0" />
            {error}
          </div>
        )}

        <Field label="کد دعوت" htmlFor="invite" error={errors.invitationCode} hint="کد را از مدیر برنامه دریافت کرده‌اید.">
          <Input
            id="invite"
            value={invitationCode}
            onChange={(e) => setInvitationCode(e.target.value)}
            placeholder="MMU-XXXXX-XXXXX-XXXXX"
            className="ltr text-start font-mono text-[12px] tracking-wider"
            dir="ltr"
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام کاربری" htmlFor="username" error={errors.username} hint="۳ تا ۳۲ نویسه؛ حروف، عدد، نقطه و خط تیره.">
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" dir="auto" required />
          </Field>
          <Field label="ایمیل" htmlFor="email" error={errors.email}>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" className="ltr text-start" required />
          </Field>
        </div>

        <Field label="رمز عبور" htmlFor="reg-password" error={errors.password}>
          <PasswordInput id="reg-password" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordChecklist password={password} />
        </Field>

        <Field label="تکرار رمز عبور" htmlFor="confirm" error={errors.confirm}>
          <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>

        <RecoveryKeyPanel value={recoveryKey} />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-raised/40 p-3">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--c-accent))]"
          />
          <span className="text-[11.5px] leading-6 text-ink-soft">
            کلید بازیابی را در جای امنی ذخیره کرده‌ام و می‌دانم که نمایش دوباره‌ی آن ممکن نیست.
          </span>
        </label>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!ready}>
          ساخت حساب
        </Button>
      </form>
    </AuthShell>
  );
}

/* ─────────────────────────────────────────────────────────────
   Email verification
   ───────────────────────────────────────────────────────────── */

function OtpInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.split('').slice(0, 6);

  const set = (index: number, char: string) => {
    const next = digits.slice();
    next[index] = char.replace(/\D/g, '');
    onChange(next.join('').slice(0, 6));
    if (char && index < 5) refs.current[index + 1]?.focus();
  };

  return (
    <div className="flex justify-center gap-2" dir="ltr">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric"
          maxLength={1}
          value={digits[i] ?? ''}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (text) {
              e.preventDefault();
              onChange(text);
            }
          }}
          className="h-12 w-11 rounded-xl border border-line bg-surface text-center text-[18px] font-semibold text-ink tabular focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          aria-label={`رقم ${i + 1}`}
        />
      ))}
    </div>
  );
}

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user) navigate('/login', { replace: true });
      else if (user.emailVerified) navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  const verify = async () => {
    if (code.length !== 6) {
      toast.error('کد تأیید باید ۶ رقم باشد.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/verify-email', { code });
      toast.success('ایمیل شما تأیید شد.');
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const result = await api.post<{ devOtp?: string }>('/api/auth/verify-email/resend');
      toast.success('کد جدید ارسال شد.');
      if (result.devOtp) setDevOtp(result.devOtp);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AuthShell title="تأیید ایمیل" subtitle="کد ۶ رقمی که به ایمیل شما ارسال شد را وارد کنید.">
      <div className="space-y-6">
        {user && (
          <p className="rounded-xl border border-line bg-raised/40 px-4 py-3 text-[12px] leading-6 text-ink-soft">
            ایمیل شما: <span className="font-medium text-ink ltr" dir="ltr">{user.email}</span>
          </p>
        )}
        <OtpInput value={code} onChange={setCode} autoFocus />
        <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={code.length !== 6} onClick={verify}>
          تأیید ایمیل
        </Button>
        <div className="text-center">
          <button type="button" onClick={resend} className="text-[12px] text-ink-soft underline-offset-4 hover:text-ink hover:underline">
            ارسال دوباره‌ی کد
          </button>
        </div>
        {devOtp && (
          <div className="rounded-xl border border-accent/30 bg-accent/[0.07] px-4 py-3 text-center">
            <p className="text-[10.5px] text-ink-faint">حالت توسعه — کد ارسال‌شده:</p>
            <p className="mt-1 text-[18px] font-bold tracking-[0.3em] text-accent ltr" dir="ltr">{devOtp}</p>
          </div>
        )}
        <p className="text-center text-[11px] leading-5 text-ink-faint">
          <MailCheck size={12} className="me-1 inline" />
          اگر ایمیل را نمی‌بینید، پوشه‌ی هرزنامه را بررسی کنید.
        </p>
      </div>
    </AuthShell>
  );
}

/* ─────────────────────────────────────────────────────────────
   Forgot / reset password
   ───────────────────────────────────────────────────────────── */

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="بازنشانی رمز عبور" subtitle="ایمیلی که با آن ثبت‌نام کرده‌اید را وارد کنید." footer={<><AuthLink to="/login">بازگشت به ورود</AuthLink></>}>
      {sent ? (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-4 text-[12.5px] leading-6 text-ink">
          <p className="font-semibold">اگر این ایمیل در سیستم ثبت شده باشد، پیوند بازنشانی ارسال شد.</p>
          <p className="mt-1 text-ink-faint">پوشه‌ی هرزنامه را هم بررسی کنید. پیوند تا ۶۰ دقیقه معتبر است.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
          <Field label="ایمیل" htmlFor="fp-email">
            <Input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="ltr text-start" required />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!email}>
            ارسال پیوند بازنشانی
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('تکرار رمز عبور یکسان نیست.');
      return;
    }
    if (passwordIssues(password).length > 0) {
      setError('رمز عبور شرایط لازم را ندارد.');
      return;
    }
    setBusy(true);
    try {
      const salt = generateSalt();
      const authKey = await deriveAuthKey(password, salt);
      await api.post('/api/auth/reset-password', { token, salt, authKey });
      toast.success('رمز عبور تغییر کرد. اکنون وارد شوید.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="رمز عبور جدید" subtitle="یک رمز عبور قوی انتخاب کنید." footer={<><AuthLink to="/login">بازگشت به ورود</AuthLink></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!token && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">
            پیوند بازنشانی معتبر نیست. لطفاً درخواست جدیدی بفرستید.
          </div>
        )}
        {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
        <Field label="رمز عبور جدید" htmlFor="np">
          <PasswordInput id="np" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordChecklist password={password} />
        </Field>
        <Field label="تکرار رمز عبور" htmlFor="npc">
          <PasswordInput id="npc" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!token || !password || !confirm}>
          ذخیره‌ی رمز جدید
        </Button>
      </form>
    </AuthShell>
  );
}

/* ─────────────────────────────────────────────────────────────
   Recovery key flow
   ───────────────────────────────────────────────────────────── */

export function RecoverPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<'verify' | 'reset'>('verify');
  const [identifier, setIdentifier] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [ticket, setTicket] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newRecoveryKey] = useState(() => generateRecoveryKey());
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const normalized = normalizeRecoveryKey(recoveryKey);
      if (!isValidRecoveryKeyShape(normalized)) throw new Error('شکل کلید بازیابی معتبر نیست.');
      const result = await api.post<{ ticket: string }>('/api/auth/recovery/verify', {
        identifier,
        recoveryKey: normalized,
      });
      setTicket(result.ticket);
      setStep('reset');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('تکرار رمز عبور یکسان نیست.');
      return;
    }
    if (passwordIssues(password).length > 0) {
      setError('رمز عبور شرایط لازم را ندارد.');
      return;
    }
    if (!ack) {
      setError('باید تأیید کنید که کلید بازیابی جدید را ذخیره کرده‌اید.');
      return;
    }
    setBusy(true);
    try {
      const salt = generateSalt();
      const authKey = await deriveAuthKey(password, salt);
      await api.post('/api/auth/recovery/complete', {
        ticket,
        salt,
        authKey,
        recoveryKey: newRecoveryKey,
        recoveryKeyAck: true,
      });
      toast.success('حساب شما بازیابی شد. کلید جدید را نگه دارید.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'reset') {
    return (
      <AuthShell title="رمز عبور جدید" subtitle="هویت شما تأیید شد. اکنون رمز جدید و کلید بازیابی جدید تنظیم کنید.">
        <form onSubmit={complete} className="space-y-4" noValidate>
          {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
          <Field label="رمز عبور جدید">
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
            <PasswordChecklist password={password} />
          </Field>
          <Field label="تکرار رمز عبور">
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
          <RecoveryKeyPanel value={newRecoveryKey} />
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-raised/40 p-3">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]" />
            <span className="text-[11.5px] leading-6 text-ink-soft">کلید بازیابی جدید را ذخیره کرده‌ام.</span>
          </label>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!password || !confirm || !ack}>
            ذخیره و ورود
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="بازیابی حساب"
      subtitle="نام کاربری و کلید بازیابی‌ای را که هنگام ثبت‌نام ذخیره کرده‌اید وارد کنید."
      footer={<><AuthLink to="/login">بازگشت به ورود</AuthLink></>}
    >
      <form onSubmit={verify} className="space-y-4" noValidate>
        {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
        <Field label="نام کاربری یا ایمیل">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} dir="auto" required />
        </Field>
        <Field label="کلید بازیابی" hint="کلید در زمان ثبت‌نام به شما نشان داده شد.">
          <Input
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            dir="ltr"
            className="ltr text-start font-mono text-[12px] tracking-wider"
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!identifier || !recoveryKey}>
          ادامه
        </Button>
      </form>
    </AuthShell>
  );
}

/* ─────────────────────────────────────────────────────────────
   First administrator bootstrap
   ───────────────────────────────────────────────────────────── */

export function SetupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, loading, refresh } = useAuth();
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryKey] = useState(() => generateRecoveryKey());
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: setup } = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<{ needsAdmin: boolean; bootstrapConfigured: boolean }>('/api/auth/setup-status'),
    staleTime: 0,
  });

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('تکرار رمز عبور یکسان نیست.');
      return;
    }
    if (passwordIssues(password).length > 0) {
      setError('رمز عبور شرایط لازم را ندارد.');
      return;
    }
    if (!ack) {
      setError('باید کلید بازیابی را ذخیره کنید.');
      return;
    }
    setBusy(true);
    try {
      const salt = generateSalt();
      const authKey = await deriveAuthKey(password, salt);
      await api.post('/api/auth/bootstrap-admin', {
        secret,
        username,
        email,
        salt,
        authKey,
        recoveryKey,
      });
      await refresh();
      toast.success('مدیر اول ساخته شد.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (setup && !setup.needsAdmin) {
    return (
      <AuthShell title="راه‌اندازی انجام شده" subtitle="مدیر اول از قبل ساخته شده است." footer={<><AuthLink to="/login">رفتن به صفحه‌ی ورود</AuthLink></>}>
        <div className="rounded-xl border border-line bg-raised/40 px-4 py-4 text-[12.5px] leading-6 text-ink-soft">
          اگر این حساب را شما نساخته‌اید، با مدیر تماس بگیرید.
        </div>
      </AuthShell>
    );
  }

  if (setup && !setup.bootstrapConfigured) {
    return (
      <AuthShell title="راه‌اندازی هنوز آماده نیست" subtitle="متغیر ADMIN_BOOTSTRAP_SECRET تنظیم نشده است.">
        <div className="rounded-xl border border-accent/30 bg-accent/[0.07] px-4 py-4 text-[12.5px] leading-7 text-ink-soft">
          برای ساخت نخستین مدیر، ابتدا باید <code className="ltr rounded bg-canvas px-1.5 py-0.5 text-[11px] text-accent" dir="ltr">ADMIN_BOOTSTRAP_SECRET</code> را در تنظیمات محیطی Worker قرار دهید و سپس این صفحه را دوباره باز کنید.
          <br />
          راهنمای گام‌به‌گام در فایل <code className="ltr rounded bg-canvas px-1.5 py-0.5 text-[11px] text-accent" dir="ltr">docs/SETUP_GUIDE.md</code> آمده است.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="راه‌اندازی نخستین مدیر"
      subtitle="این مرحله فقط یک بار انجام می‌شود. حساب شما مدیر برنامه خواهد بود."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
        <Field label="کلید راه‌اندازی" hint="مقدار ADMIN_BOOTSTRAP_SECRET که در تنظیمات Worker قرار داده‌اید.">
          <Input value={secret} onChange={(e) => setSecret(e.target.value)} dir="ltr" className="ltr text-start font-mono text-[12px]" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام کاربری">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} dir="auto" required />
          </Field>
          <Field label="ایمیل">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="ltr text-start" required />
          </Field>
        </div>
        <Field label="رمز عبور">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordChecklist password={password} />
        </Field>
        <Field label="تکرار رمز عبور">
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        <RecoveryKeyPanel value={recoveryKey} />
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-raised/40 p-3">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]" />
          <span className="text-[11.5px] leading-6 text-ink-soft">کلید بازیابی را ذخیره کرده‌ام.</span>
        </label>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!secret || !username || !email || !password || !confirm || !ack}>
          ساخت حساب مدیر
        </Button>
      </form>
    </AuthShell>
  );
}

/** Shown while the session is being restored. */
export function AuthLoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <Logo size={34} />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/3 animate-[shimmer_1.2s_infinite] rounded-full bg-accent" />
        </div>
        <p className="text-[11px] text-ink-faint">در حال آماده‌سازی…</p>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <Logo size={40} />
      <h1 className="text-[20px] font-bold text-ink">صفحه‌ای که دنبالش بودید پیدا نشد</h1>
      <p className="max-w-sm text-[12.5px] leading-6 text-ink-faint">
        شاید آدرس اشتباه است یا این مورد حذف شده است.
      </p>
      <Link to="/">
        <Button variant="primary" icon={<ArrowLeft size={15} />}>بازگشت به خانه</Button>
      </Link>
    </div>
  );
}

void uuid;
void ConfirmDialog;
