import { describe, expect, it } from 'vitest';
import {
  currentJalaliYear,
  formatJalaliLong,
  formatJalaliNumeric,
  gregorianToJalali,
  isLeapJalali,
  jalaliMonthKey,
  jalaliMonthRange,
  jalaliToGregorian,
  jalaliYearRange,
  toJalali,
} from '../../src/shared/jalali';

describe('Gregorian → Jalali conversion (known dates)', () => {
  // Reference: the widely used jalaali-js tables.
  const cases: [string, number, number, number][] = [
    ['2026-03-21', 1405, 1, 1], // Nowruz 1405
    ['2026-11-24', 1405, 9, 3],
    ['2025-03-20', 1403, 12, 30], // leap year, Esfand has 30 days
    ['2025-03-21', 1404, 1, 1],
    ['2024-03-20', 1403, 1, 1],
    ['2023-03-21', 1402, 1, 1],
    ['2000-01-01', 1378, 10, 11],
    ['1979-02-11', 1357, 11, 22], // 22 Bahman 1357
    ['2026-12-31', 1405, 10, 10],
  ];

  it.each(cases)('%s → %i/%i/%i', (iso, jy, jm, jd) => {
    expect(gregorianToJalali(...(iso.split('-').map(Number) as [number, number, number]))).toEqual({ jy, jm, jd });
    expect(toJalali(iso)).toEqual({ jy, jm, jd });
  });

  it('round-trips Jalali → Gregorian', () => {
    for (const [iso, jy, jm, jd] of cases) {
      const g = jalaliToGregorian(jy, jm, jd);
      const back = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
      expect(back).toBe(iso);
    }
  });

  it('round-trips across a whole year for every day', () => {
    for (let day = 0; day < 366; day += 1) {
      const d = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      const j = toJalali(iso)!;
      const g = jalaliToGregorian(j.jy, j.jm, j.jd);
      expect(`${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`).toBe(iso);
    }
  });
});

describe('leap years and month lengths', () => {
  it('identifies known leap years', () => {
    expect(isLeapJalali(1403)).toBe(true);
    expect(isLeapJalali(1404)).toBe(false);
    expect(isLeapJalali(1408)).toBe(true);
    expect(isLeapJalali(1399)).toBe(true);
  });

  it('Esfand 30 exists only in leap years', () => {
    expect(jalaliToGregorian(1403, 12, 30)).toEqual({ gy: 2025, gm: 3, gd: 20 });
    // 1404 is not a leap year: Esfand 30 maps into the next year's Farvardin in the algorithm,
    // which callers must avoid by clamping to the month length.
    const d = jalaliToGregorian(1404, 12, 29);
    expect(`${d.gy}-${String(d.gm).padStart(2, '0')}-${String(d.gd).padStart(2, '0')}`).toBe('2026-03-20');
  });
});

describe('ranges and keys', () => {
  it('builds a Jalali year range covering Nowruz to Nowruz', () => {
    const { from, to } = jalaliYearRange(1405);
    expect(toJalali(from)).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(toJalali(to)).toEqual({ jy: 1405, jm: 12, jd: 29 });
  });

  it('builds a month range', () => {
    const { from, to } = jalaliMonthRange(1405, 8);
    expect(toJalali(from)).toEqual({ jy: 1405, jm: 8, jd: 1 });
    expect(toJalali(to)).toEqual({ jy: 1405, jm: 8, jd: 30 });
  });

  it('derives a month key', () => {
    expect(jalaliMonthKey('2026-11-24')).toBe('1405-09');
    expect(jalaliMonthKey(null)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats numeric and long forms in Persian digits', () => {
    expect(formatJalaliNumeric('2026-11-24')).toBe('۱۴۰۵/۰۹/۰۳');
    expect(formatJalaliLong('2026-11-24')).toBe('۳ آذر ۱۴۰۵');
    expect(formatJalaliLong('2026-11-24', true)).toBe('سه‌شنبه، ۳ آذر ۱۴۰۵');
    expect(formatJalaliNumeric(null)).toBe('—');
  });

  it('reports the current Jalali year from the system clock', () => {
    expect(currentJalaliYear()).toBeGreaterThanOrEqual(1404);
  });
});
