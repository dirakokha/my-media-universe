/**
 * Rating engine — pure functions shared by the client, the Worker and the tests.
 *
 * Rules (product spec §8–9):
 *  - direct score: a single personal 0–10 value in 0.5 steps
 *  - criteria score: the average of ONLY the criteria that actually have a value.
 *    Skipped criteria are never treated as zero.
 *  - season score: average of its rated episodes
 *  - series score: average of every rated episode across every season
 */

export type RatingMethod = 'direct' | 'criteria';
export type Criteria = Record<string, number>;

export const MIN_RATING = 0;
export const MAX_RATING = 10;
export const RATING_STEP = 0.5;

export interface CriterionDef {
  key: string;
  label: string;
  short: string;
  order: number;
}

/** Default five criteria. Additional criteria can be added without schema changes. */
export const CRITERIA: readonly CriterionDef[] = [
  { key: 'story', label: 'داستان و فیلمنامه', short: 'داستان', order: 1 },
  { key: 'characters', label: 'شخصیت‌پردازی و بازیگری', short: 'شخصیت‌ها', order: 2 },
  { key: 'direction', label: 'کارگردانی و جلوه‌های بصری', short: 'کارگردانی', order: 3 },
  { key: 'sound', label: 'موسیقی و طراحی صدا', short: 'صدا', order: 4 },
  { key: 'impact', label: 'تأثیرگذاری و درگیرکنندگی', short: 'تأثیر', order: 5 },
] as const;

export const CRITERIA_KEYS = CRITERIA.map((c) => c.key);

/** Round to 2 decimals, avoiding float artefacts such as 8.299999999. */
export function roundRating(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Snap any value to the 0.5 grid and clamp to 0–10. */
export function snapRating(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, value));
  return Math.round(clamped / RATING_STEP) * RATING_STEP;
}

export function isValidRating(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  );
}

/** Keep only finite numeric criteria values inside 0–10, snapped to 0.5. */
export function normalizeCriteria(input: unknown): Criteria {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Criteria = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidRating(raw)) continue;
    out[key] = snapRating(raw);
  }
  return out;
}

/** Average of the numbers that actually exist. Returns null when there is nothing to average. */
export function averageOf(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return roundRating(nums.reduce((sum, n) => sum + n, 0) / nums.length);
}

/**
 * Resolve the score for a media item or episode according to its rating method.
 * A direct rating wins when the method is `direct`; otherwise the criteria average is used.
 * Returns null when the user has not rated anything yet.
 */
export function computeFinalRating(
  method: RatingMethod | null | undefined,
  direct: number | null | undefined,
  criteria: Criteria | null | undefined,
): number | null {
  if (method === 'criteria') {
    const values = Object.values(criteria ?? {});
    const hasDirect = typeof direct === 'number';
    if (values.length === 0) return hasDirect ? snapRating(direct as number) : null;
    return averageOf(values);
  }
  if (typeof direct === 'number' && Number.isFinite(direct)) return snapRating(direct);
  const values = Object.values(criteria ?? {});
  return averageOf(values);
}

export function hasAnyRating(
  method: RatingMethod | null | undefined,
  direct: number | null | undefined,
  criteria: Criteria | null | undefined,
): boolean {
  return computeFinalRating(method, direct, criteria) !== null;
}

export interface RatedThing {
  ratingFinal: number | null | undefined;
}

/** Season score: average of rated episodes only. */
export function computeSeasonScore(episodes: RatedThing[]): number | null {
  return averageOf(episodes.map((e) => e.ratingFinal));
}

/** Series score: average of every rated episode across every season. */
export function computeSeriesScore(episodes: RatedThing[]): { score: number | null; rated: number } {
  const rated = episodes.filter((e) => typeof e.ratingFinal === 'number');
  return { score: averageOf(rated.map((e) => e.ratingFinal)), rated: rated.length };
}

/** Renders 8.5 → "۸٫۵" */
export function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const hasFraction = Math.abs(value - Math.round(value)) > 0.001;
  const fixed = hasFraction ? value.toFixed(1) : value.toFixed(0);
  return toPersianDigits(fixed.replace('.', '٫'));
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

export function fromPersianDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

/** Formats minutes as a Persian human string, e.g. "۱۲ ساعت و ۳۰ دقیقه". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '۰ دقیقه';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${toPersianDigits(m)} دقیقه`;
  if (m === 0) return `${toPersianDigits(h)} ساعت`;
  return `${toPersianDigits(h)} ساعت و ${toPersianDigits(m)} دقیقه`;
}
