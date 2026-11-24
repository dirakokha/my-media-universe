import type { ListSortMode, MediaCollection, WatchStatus } from './types';

export const APP_NAME_FA = 'دنیای رسانه‌ای من';
export const APP_NAME_EN = 'My Media Universe';
export const SCHEMA_VERSION = 1;

export const WATCH_STATUSES = ['plan', 'watching', 'completed', 'onhold', 'dropped'] as const;
export type { WatchStatus };

export const STATUS_META: Record<
  WatchStatus,
  { label: string; short: string; color: string; hint: string }
> = {
  plan: { label: 'قصد تماشا دارم', short: 'قصد تماشا', color: '#8b93a7', hint: 'در فهرست تماشا' },
  watching: { label: 'در حال تماشا', short: 'در حال تماشا', color: '#4c9aff', hint: 'شروع کرده‌ام' },
  completed: { label: 'تماشا شده', short: 'تماشا شده', color: '#3ecf8e', hint: 'تمام شده' },
  onhold: { label: 'متوقف شده', short: 'متوقف', color: '#e0a63c', hint: 'فعلاً رها کرده‌ام' },
  dropped: { label: 'رها شده', short: 'رها شده', color: '#e0608a', hint: 'دیگر ادامه نمی‌دهم' },
};

export const COLLECTION_META: Record<MediaCollection, { label: string; singular: string; accent: string }> = {
  movie: { label: 'فیلم‌ها', singular: 'فیلم', accent: '#5aa9ff' },
  series: { label: 'سریال‌ها', singular: 'سریال', accent: '#b98cff' },
  anime: { label: 'انیمه‌ها', singular: 'انیمه', accent: '#ff7d9c' },
};

export const SORT_OPTIONS: { value: 'recent' | 'rating' | 'title' | 'year'; label: string }[] = [
  { value: 'recent', label: 'تازه‌ترین' },
  { value: 'rating', label: 'بالاترین امتیاز' },
  { value: 'title', label: 'عنوان' },
  { value: 'year', label: 'سال انتشار' },
];

export const LIST_SORT_OPTIONS: { value: ListSortMode; label: string }[] = [
  { value: 'manual', label: 'چیدمان دستی' },
  { value: 'rating', label: 'امتیاز' },
  { value: 'date', label: 'تاریخ افزودن' },
  { value: 'title', label: 'عنوان' },
];

export const GENRE_ANIMATION_ID = 16;
export const ANIME_ORIGIN_COUNTRIES = new Set(['JP', 'CN', 'KR', 'TW']);

/** Heuristic: TMDB has no "anime" type, so we infer it from genre + origin country. */
export function looksLikeAnime(input: {
  genres?: { id: number | null; name: string }[];
  originCountry?: string[] | string | null;
  originalLanguage?: string | null;
  numberOfSeasons?: number;
}): boolean {
  const genres = input.genres ?? [];
  const isAnimation = genres.some((g) => g.id === GENRE_ANIMATION_ID);
  if (!isAnimation) return false;
  const countries = Array.isArray(input.originCountry)
    ? input.originCountry
    : input.originCountry
      ? [input.originCountry]
      : [];
  const isAsianOrigin = countries.some((c) => c && ANIME_ORIGIN_COUNTRIES.has(c));
  const lang = input.originalLanguage?.toUpperCase();
  const isAsianLanguage = lang === 'JA' || lang === 'KO' || lang === 'ZH';
  return isAsianOrigin || isAsianLanguage;
}
