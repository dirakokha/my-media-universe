import type { ReactNode } from 'react';
import { Skeleton, Badge, Num } from './bits';

export { Skeleton, Badge, Num };

/** A titled settings panel. */
export function SectionCard({
  title,
  icon,
  description,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            {icon && <span className="text-ink-soft">{icon}</span>}
            {title}
          </h2>
          {description && <p className="mt-1 max-w-2xl text-[12px] leading-6 text-ink-faint">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
