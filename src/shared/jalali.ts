/**
 * Jalali (Persian calendar) conversion and formatting.
 * Self-contained port of the well-known jalaali algorithm — no dependency, works offline in a PWA.
 */

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
] as const;

export const JALALI_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'] as const;

/** Indexed by JS Date.getDay() (0 = Sunday). */
export const PERSIAN_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'] as const;

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// The jalaali algorithm relies on truncating (toward zero) division and a
// remainder that keeps the sign of the dividend — Math.floor gives wrong
// results for the negative intermediate values it produces.
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  let leap = 0;
  let n = 0;
  let i = 0;

  if (jy < jp || jy >= BREAKS[bl - 1]) {
    throw new Error(`Invalid Jalaali year ${jy}`);
  }

  for (i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div((153 * mod(gm + 9, 12) + 2), 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): JalaliDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let jd = 0;
  let jm = 0;
  let k = jdn - jdn1f;

  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function isLeapJalali(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

/** Gregorian year/month/day → Jalali. */
export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  return d2j(g2d(gy, gm, gd));
}

/** Jalali year/month/day → Gregorian. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

/** Parse a YYYY-MM-DD string into a Jalali date. Returns null for invalid input. */
export function toJalali(isoDate: string | null | undefined): JalaliDate | null {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const gy = Number(m[1]);
  const gm = Number(m[2]);
  const gd = Number(m[3]);
  if (gm < 1 || gm > 12 || gd < 1 || gd > 31) return null;
  return gregorianToJalali(gy, gm, gd);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "۱۴۰۵/۰۸/۰۳" */
export function formatJalaliNumeric(isoDate: string | null | undefined): string {
  const j = toJalali(isoDate);
  if (!j) return '—';
  return toPersianDigits(`${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`);
}

/** "۳ آبان ۱۴۰۵" */
export function formatJalaliLong(isoDate: string | null | undefined, withWeekday = false): string {
  const j = toJalali(isoDate);
  if (!j) return '—';
  const base = `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`;
  if (!withWeekday) return base;
  const g = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '');
  if (!g) return base;
  const weekday = PERSIAN_WEEKDAYS[new Date(Number(g[1]), Number(g[2]) - 1, Number(g[3])).getDay()];
  return `${weekday}، ${base}`;
}

/** "آبان ۱۴۰۵" — used for chart axis labels and month pickers. */
export function formatJalaliMonth(key: string): string {
  const [jy, jm] = key.split('-').map(Number);
  if (!jy || !jm) return key;
  return `${JALALI_MONTHS[jm - 1] ?? ''} ${toPersianDigits(jy)}`;
}

/** "۱۴۰۵" */
export function formatJalaliYear(isoDate: string | null | undefined): string {
  const j = toJalali(isoDate);
  return j ? toPersianDigits(j.jy) : '—';
}

/** Jalali month key "1405-08" for an ISO date. */
export function jalaliMonthKey(isoDate: string | null | undefined): string | null {
  const j = toJalali(isoDate);
  if (!j) return null;
  return `${j.jy}-${pad2(j.jm)}`;
}

export function jalaliYearOf(isoDate: string | null | undefined): number | null {
  return toJalali(isoDate)?.jy ?? null;
}

/** Current Jalali year. */
export function currentJalaliYear(): number {
  const d = new Date();
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()).jy;
}

/** Start and end ISO dates of a Jalali month. */
export function jalaliMonthRange(jy: number, jm: number): { from: string; to: string } {
  const fromG = jalaliToGregorian(jy, jm, 1);
  const daysInMonth = jm <= 6 ? 31 : jm <= 11 ? 30 : isLeapJalali(jy) ? 30 : 29;
  const toG = jalaliToGregorian(jy, jm, daysInMonth);
  return {
    from: `${fromG.gy}-${pad2(fromG.gm)}-${pad2(fromG.gd)}`,
    to: `${toG.gy}-${pad2(toG.gm)}-${pad2(toG.gd)}`,
  };
}

/** Start and end ISO dates of a Jalali year. */
export function jalaliYearRange(jy: number): { from: string; to: string } {
  const fromG = jalaliToGregorian(jy, 1, 1);
  const toG = jalaliToGregorian(jy, 12, isLeapJalali(jy) ? 30 : 29);
  return {
    from: `${fromG.gy}-${pad2(fromG.gm)}-${pad2(fromG.gd)}`,
    to: `${toG.gy}-${pad2(toG.gm)}-${pad2(toG.gd)}`,
  };
}

/** The last N Jalali month keys ending at the current month, oldest first. */
export function recentJalaliMonths(count: number): string[] {
  const now = new Date();
  let { jy, jm } = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.unshift(`${jy}-${pad2(jm)}`);
    jm -= 1;
    if (jm === 0) {
      jm = 12;
      jy -= 1;
    }
  }
  return out;
}
