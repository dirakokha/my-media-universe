import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../layout/app-shell';
import { APP_NAME_FA } from '../../shared/constants';

const TILES = [
  'linear-gradient(160deg,#2b3a55 0%,#141a24 100%)',
  'linear-gradient(160deg,#4a2b3a 0%,#1a1216 100%)',
  'linear-gradient(160deg,#2f4436 0%,#101a14 100%)',
  'linear-gradient(160deg,#3a2f4a 0%,#151218 100%)',
  'linear-gradient(160deg,#443a2b 0%,#1a1712 100%)',
  'linear-gradient(160deg,#2b3f4a 0%,#10181c 100%)',
];

/** Two-panel auth layout: a quiet brand panel beside a narrow form. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <div className="relative hidden w-[46%] max-w-[620px] flex-col justify-between overflow-hidden border-e border-line bg-canvas p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            background:
              'radial-gradient(120% 90% at 10% 0%, rgb(var(--c-accent) / 0.14) 0%, transparent 55%)',
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[14px] font-bold text-ink">{APP_NAME_FA}</span>
        </div>

        <div className="relative">
          <h2 className="max-w-sm text-[26px] font-bold leading-[1.5] text-balance text-ink">
            هر چیزی که تماشا می‌کنید،
            <br />
            یک جای مشخص دارد.
          </h2>
          <p className="mt-3 max-w-sm text-[13px] leading-7 text-ink-soft">
            امتیازدهی، یادداشت‌نویسی و آمار تماشای شما — به فارسی، در هر دستگاهی.
          </p>
          <div className="mt-8 grid grid-cols-6 gap-2.5">
            {TILES.map((bg, i) => (
              <div
                key={i}
                className="aspect-[2/3] rounded-lg border border-line/60 opacity-70"
                style={{ background: bg, transform: `translateY(${(i % 3) * 6}px)` }}
              />
            ))}
          </div>
        </div>

        <p className="relative text-[10px] leading-5 text-ink-faint">
          اطلاعات فیلم و سریال از TMDB تأمین می‌شود. این محصول وابسته به TMDB نیست و توسط آن تأیید نشده است.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-5 py-8 sm:px-10 lg:px-16">
        <div className="mb-6 flex items-center justify-between lg:hidden">
          <Link to="/login" className="flex items-center gap-2">
            <Logo size={26} />
            <span className="text-[13px] font-bold text-ink">{APP_NAME_FA}</span>
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-6">
          <h1 className="text-[22px] font-bold leading-9 text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[12.5px] leading-6 text-ink-faint">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-center text-[12px] text-ink-faint">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-accent underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
