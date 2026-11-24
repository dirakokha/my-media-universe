import type { MediaItem } from '../shared/types';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/';

type Size = 'w92' | 'w154' | 'w185' | 'w300' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original';

/** TMDB image URL, or a data URL for manually added items. */
export function posterUrl(
  path: string | null | undefined,
  size: Size = 'w342',
  custom?: string | null,
): string | null {
  if (custom) return custom;
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}${size}${path}`;
}

export function backdropUrl(path: string | null | undefined, size: Size = 'w1280'): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}${size}${path}`;
}

export function stillUrl(path: string | null | undefined, size: Size = 'w300'): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}${size}${path}`;
}

export function profileUrl(path: string | null | undefined, size: Size = 'w185'): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}${size}${path}`;
}

/** Chooses the best available poster for a library item. */
export function itemPoster(item: Pick<MediaItem, 'posterPath' | 'customPosterData'>, size: Size = 'w342'): string | null {
  return posterUrl(item.posterPath, size, item.customPosterData);
}

/** Deterministic tinted placeholder so empty poster slots still look intentional. */
export function placeholderTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  // Saturation and lightness come from theme tokens so the placeholder is a soft
  // tint in light mode instead of a black slab.
  return `linear-gradient(150deg, hsl(${hue} var(--ph-sat) var(--ph-l1)), hsl(${(hue + 40) % 360} var(--ph-sat) var(--ph-l2)))`;
}
