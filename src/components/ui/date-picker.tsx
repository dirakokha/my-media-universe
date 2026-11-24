import { useMemo } from 'react';
import { JALALI_MONTHS, currentJalaliYear, isLeapJalali, jalaliToGregorian, toJalali, todayIso, isoFromDate, toPersianDigits } from '../../shared/jalali';
import { Select } from './field';

export function daysInJalaliMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalali(jy) ? 30 : 29;
}

/** Converts a Jalali date to an ISO (Gregorian) string. */
export function jalaliToIso(jy: number, jm: number, jd: number): string {
  const g = jalaliToGregorian(jy, jm, jd);
  const d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
  return isoFromDate(d);
}

/**
 * Three-select Jalali (Persian) date picker. Works with touch, keyboard and
 * screen readers — far better for the audience than a Gregorian `<input type=date>`.
 */
export function JalaliDatePicker({
  value,
  onChange,
  label,
  optional,
  idPrefix,
  minYear,
  maxYear,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  label?: string;
  optional?: boolean;
  idPrefix: string;
  minYear?: number;
  maxYear?: number;
}) {
  const today = todayIso();
  const effective = value ?? today;
  const j = toJalali(effective) ?? toJalali(today)!;
  const thisYear = currentJalaliYear();
  const years = useMemo(() => {
    const from = minYear ?? thisYear - 40;
    const to = maxYear ?? thisYear + 1;
    const list: number[] = [];
    for (let y = to; y >= from; y -= 1) list.push(y);
    return list;
  }, [minYear, maxYear, thisYear]);
  const days = daysInJalaliMonth(j.jy, j.jm);

  const set = (patch: Partial<{ jy: number; jm: number; jd: number }>) => {
    const next = { jy: j.jy, jm: j.jm, jd: j.jd, ...patch };
    const maxDay = daysInJalaliMonth(next.jy, next.jm);
    next.jd = Math.min(next.jd, maxDay);
    onChange(jalaliToIso(next.jy, next.jm, next.jd));
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ink-soft">
            {label}
            {optional && <span className="ms-1.5 text-[11px] font-normal text-ink-faint">(اختیاری)</span>}
          </span>
          {optional && value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
            >
              پاک کردن
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Select
          aria-label="سال"
          value={String(j.jy)}
          onChange={(e) => set({ jy: Number(e.target.value) })}
        >
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {toPersianDigits(y)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="ماه"
          value={String(j.jm)}
          onChange={(e) => set({ jm: Number(e.target.value) })}
        >
          {JALALI_MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </Select>
        <Select
          aria-label="روز"
          value={String(j.jd)}
          onChange={(e) => set({ jd: Number(e.target.value) })}
        >
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={String(d)}>
              {toPersianDigits(d)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between text-[11px] text-ink-faint">
        <span id={`${idPrefix}-greg`} className="ltr" dir="ltr">
          {effective}
        </span>
        <button
          type="button"
          onClick={() => onChange(today)}
          className="text-accent underline-offset-2 hover:underline"
        >
          امروز
        </button>
      </div>
    </div>
  );
}
