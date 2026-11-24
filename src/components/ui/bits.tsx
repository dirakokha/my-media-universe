import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react';
import { toPersianDigits } from '../../shared/jalali';

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin text-ink-faint ${className}`} />;
}

export function Badge({
  children,
  color,
  className = '',
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-line bg-raised/70 px-2 py-0.5 text-[11px] font-medium text-ink-soft ${className}`}
      style={color ? { borderColor: `${color}40`, color, background: `${color}14` } : undefined}
    >
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-faint">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line-strong',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'start-[22px]' : 'start-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          data-active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'}`}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-raised text-ink-faint">
        {icon ?? <Inbox size={24} strokeWidth={1.6} />}
      </div>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      {message && <p className="mt-1.5 max-w-sm text-[12.5px] leading-6 text-ink-faint">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/50 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-ink-faint">
        <WifiOff size={24} strokeWidth={1.6} />
      </div>
      <h3 className="text-[14px] font-semibold text-ink">به اینترنت متصل نیستید</h3>
      <p className="mt-1.5 max-w-sm text-[12.5px] leading-6 text-ink-faint">
        محتوایی که قبلاً بارگذاری شده در دسترس است. تغییرات شما ذخیره می‌شوند و بعد از اتصال ارسال می‌گردند.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-[10px] border border-line bg-raised px-4 py-2 text-[12.5px] font-medium text-ink hover:bg-overlay"
        >
          تلاش دوباره
        </button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface/50 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
        <AlertTriangle size={24} strokeWidth={1.6} />
      </div>
      <h3 className="text-[14px] font-semibold text-ink">مشکلی پیش آمد</h3>
      <p className="mt-1.5 max-w-sm text-[12.5px] leading-6 text-ink-faint">{message ?? 'لطفاً دوباره تلاش کنید.'}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-[10px] border border-line bg-raised px-4 py-2 text-[12.5px] font-medium text-ink hover:bg-overlay"
        >
          تلاش دوباره
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** A number rendered with Persian digits. */
export function Num({ children }: { children: number | string }) {
  return <span className="tabular">{toPersianDigits(children)}</span>;
}

/** A list that keeps rendering stable while items load. */
export function useDelayedFlag(delay = 220) {
  const [flag, setFlag] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    timer.current = window.setTimeout(() => setFlag(true), delay);
    return () => window.clearTimeout(timer.current);
  }, [delay]);
  return flag;
}

export function StatTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-xl border px-4 py-3.5',
        accent
          ? 'border-accent/25 bg-accent/[0.07]'
          : 'border-line bg-surface',
      ].join(' ')}
    >
      <p className="text-[11px] font-medium tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-[20px] font-semibold leading-7 text-ink tabular">{value}</p>
      {hint && <p className="mt-0.5 text-[10.5px] text-ink-faint">{hint}</p>}
    </div>
  );
}
