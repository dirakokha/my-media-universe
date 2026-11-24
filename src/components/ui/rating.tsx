import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { snapRating, toPersianDigits } from '../../shared/ratings';
import { CRITERIA } from '../../shared/ratings';

/** Read-only star row with a numeric value. */
export function Stars({
  value,
  size = 12,
  showValue = true,
  className = '',
}: {
  value: number | null | undefined;
  size?: number;
  showValue?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] text-ink-faint ${className}`}>
        <Star size={size} className="opacity-40" />
        <span>بدون امتیاز</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="relative inline-flex" aria-hidden>
        <span className="flex gap-[1px]">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={size} className="text-line-strong" fill="currentColor" strokeWidth={0} />
          ))}
        </span>
        <span className="absolute inset-0 flex gap-[1px] overflow-hidden" style={{ width: `${(value / 10) * 100}%` }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={size} className="shrink-0 text-accent" fill="currentColor" strokeWidth={0} />
          ))}
        </span>
      </span>
      {showValue && (
        <span className="text-[11.5px] font-semibold text-accent tabular">{toPersianDigits(value.toFixed(1))}</span>
      )}
    </span>
  );
}

/**
 * Half-point rating slider. Renders its own filled track so the control looks
 * consistent in both themes and on touch screens.
 */
export function RatingSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const percent = (value / 10) * 100;
  return (
    <div className="space-y-2">
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(snapRating(Number(event.target.value)))}
        className="rating-range"
        style={{
          // The document is RTL, so the range fills from the right (min) toward the left.
          background: `linear-gradient(to left, rgb(var(--c-accent)) 0%, rgb(var(--c-accent)) ${percent}%, rgb(var(--c-line-strong)) ${percent}%, rgb(var(--c-line-strong)) 100%)`,
        }}
        aria-label="امتیاز"
        aria-valuetext={`${toPersianDigits(value)} از ۱۰`}
      />
      <div className="flex items-center justify-between text-[10.5px] text-ink-faint">
        <span>۰</span>
        <span>۵</span>
        <span>۱۰</span>
      </div>
    </div>
  );
}

/** A compact numeric stepper used for criterion rows. */
export function HalfPointStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const dec = () => onChange(snapRating(Math.max(0, value - 0.5)));
  const inc = () => onChange(snapRating(Math.min(10, value + 0.5)));
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={dec}
        disabled={value <= 0}
        aria-label="کم کردن"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-raised text-ink-soft transition-colors hover:bg-overlay disabled:opacity-30"
      >
        −
      </button>
      <span className="w-9 text-center text-[13px] font-semibold text-ink tabular">
        {toPersianDigits(value.toFixed(1))}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={value >= 10}
        aria-label="زیاد کردن"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-raised text-ink-soft transition-colors hover:bg-overlay disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

export const RATING_CRITERIA = CRITERIA;

/** Editing form for the five criteria. Unrated criteria stay null and never count as zero. */
export function CriteriaEditor({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  return (
    <div className="space-y-3">
      {CRITERIA.map((criterion) => {
        const current = value[criterion.key];
        const set = (next: number | null) => {
          const copy = { ...value };
          if (next === null) delete copy[criterion.key];
          else copy[criterion.key] = snapRating(next);
          onChange(copy);
        };
        return (
          <div key={criterion.key} className="rounded-xl border border-line bg-raised/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-medium text-ink">{criterion.label}</span>
              {current !== undefined ? (
                <button
                  type="button"
                  onClick={() => set(null)}
                  className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
                >
                  پاک کردن
                </button>
              ) : (
                <span className="text-[11px] text-ink-faint">امتیاز نداده‌ام</span>
              )}
            </div>
            <RatingSlider value={current ?? 0} onChange={(next) => set(next === 0 ? null : next)} />
          </div>
        );
      })}
    </div>
  );
}

/** A number that animates when it changes, used for the score readout. */
export function AnimatedNumber({ value }: { value: number | null }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    setDisplay(value);
  }, [value]);
  if (display === null || display === undefined) {
    return <span className="text-[28px] font-semibold text-ink-faint">—</span>;
  }
  return (
    <span className="text-[32px] font-semibold leading-none text-accent tabular transition-all duration-200">
      {toPersianDigits(display.toFixed(1))}
    </span>
  );
}
