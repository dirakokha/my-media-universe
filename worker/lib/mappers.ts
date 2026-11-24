import type {
  Category,
  Episode,
  MediaItem,
  MediaList,
  Quote,
  Season,
  User,
  UserPreferences,
  WatchEvent,
} from '../../src/shared/types';

export interface DbRow {
  [key: string]: unknown;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function parseIntSafe(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function boolFromInt(raw: unknown): boolean {
  return Number(raw) === 1;
}

export function rowToMediaItem(row: DbRow): MediaItem {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    source: row.source === 'manual' ? 'manual' : 'tmdb',
    tmdbId: parseIntSafe(row.tmdb_id),
    kind: row.kind === 'series' ? 'series' : 'movie',
    isAnime: boolFromInt(row.is_anime),
    title: String(row.title ?? ''),
    originalTitle: (row.original_title as string | null) ?? null,
    overview: (row.overview as string | null) ?? null,
    overviewEn: (row.overview_en as string | null) ?? null,
    posterPath: (row.poster_path as string | null) ?? null,
    backdropPath: (row.backdrop_path as string | null) ?? null,
    customPosterData: (row.custom_poster_data as string | null) ?? null,
    releaseDate: (row.release_date as string | null) ?? null,
    year: parseIntSafe(row.year),
    genres: parseJson(row.genres, []),
    runtimeMinutes: parseIntSafe(row.runtime_minutes),
    country: (row.country as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    director: (row.director as string | null) ?? null,
    cast: parseJson(row.cast_list, []),
    status: (row.status as MediaItem['status']) ?? 'plan',
    ratingMethod: row.rating_method === 'criteria' ? 'criteria' : 'direct',
    ratingDirect: row.rating_direct === null ? null : Number(row.rating_direct),
    criteria: parseJson<Record<string, number>>(row.criteria, {}),
    ratingFinal: row.rating_final === null ? null : Number(row.rating_final),
    finalSeriesRating: row.final_series_rating === null ? null : Number(row.final_series_rating),
    notes: (row.notes as string | null) ?? null,
    quotes: parseJson<Quote[]>(row.quotes, []),
    isSpoiler: boolFromInt(row.is_spoiler),
    tags: parseJson<string[]>(row.tags, []),
    watchDate: (row.watch_date as string | null) ?? null,
    favorite: boolFromInt(row.favorite),
    addedAt: Number(row.added_at),
    updatedAt: Number(row.updated_at),
    watchCount: parseIntSafe(row.watch_count) ?? undefined,
  };
}

export function rowToEpisode(row: DbRow): Episode {
  return {
    id: String(row.id),
    mediaItemId: String(row.media_item_id),
    tmdbEpisodeId: parseIntSafe(row.tmdb_episode_id),
    seasonNumber: Number(row.season_number),
    episodeNumber: Number(row.episode_number),
    name: String(row.name ?? ''),
    originalName: (row.original_name as string | null) ?? null,
    overview: (row.overview as string | null) ?? null,
    stillPath: (row.still_path as string | null) ?? null,
    airDate: (row.air_date as string | null) ?? null,
    runtimeMinutes: parseIntSafe(row.runtime_minutes),
    watched: boolFromInt(row.watched),
    ratingMethod: row.rating_method === 'criteria' ? 'criteria' : 'direct',
    ratingDirect: row.rating_direct === null ? null : Number(row.rating_direct),
    criteria: parseJson<Record<string, number>>(row.criteria, {}),
    ratingFinal: row.rating_final === null ? null : Number(row.rating_final),
    notes: (row.notes as string | null) ?? null,
    quotes: parseJson<Quote[]>(row.quotes, []),
    tags: parseJson<string[]>(row.tags, []),
    isSpoiler: boolFromInt(row.is_spoiler),
    watchDate: (row.watch_date as string | null) ?? null,
    updatedAt: Number(row.updated_at),
  };
}

export function rowToSeason(row: DbRow): Season {
  return {
    id: String(row.id),
    mediaItemId: String(row.media_item_id),
    tmdbSeasonId: parseIntSafe(row.tmdb_season_id),
    seasonNumber: Number(row.season_number),
    name: (row.name as string | null) ?? null,
    overview: (row.overview as string | null) ?? null,
    posterPath: (row.poster_path as string | null) ?? null,
    airDate: (row.air_date as string | null) ?? null,
    episodeCount: Number(row.episode_count ?? 0),
  };
}

export function rowToWatchEvent(row: DbRow): WatchEvent {
  return {
    id: String(row.id),
    mediaItemId: String(row.media_item_id),
    episodeId: (row.episode_id as string | null) ?? null,
    watchedAt: String(row.watched_at),
    rating: row.rating === null ? null : Number(row.rating),
    ratingMethod: (row.rating_method as WatchEvent['ratingMethod']) ?? null,
    criteria: parseJson<Record<string, number>>(row.criteria, {}),
    notes: (row.notes as string | null) ?? null,
    quotes: parseJson<Quote[]>(row.quotes, []),
    isSpoiler: Number(row.is_spoiler ?? 0) === 1,
    createdAt: Number(row.created_at),
    episodeLabel: (row.episode_label as string | null) ?? undefined,
  };
}

export function rowToCategory(row: DbRow): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    color: (row.color as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    itemCount: Number(row.item_count ?? 0),
    createdAt: Number(row.created_at),
  };
}

export function rowToList(row: DbRow): MediaList {
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    sortMode: (row.sort_mode as MediaList['sortMode']) ?? 'manual',
    isWatchlist: boolFromInt(row.is_watchlist),
    itemCount: Number(row.item_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const DEFAULT_PREFERENCES: UserPreferences = { theme: 'dark', language: 'fa', autoBackup: false };

export function rowToUser(row: DbRow): User {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    emailVerified: row.email_verified_at !== null && row.email_verified_at !== undefined,
    role: row.role === 'admin' ? 'admin' : 'member',
    preferences: { ...DEFAULT_PREFERENCES, ...parseJson<Partial<UserPreferences>>(row.preferences, {}) },
    createdAt: Number(row.created_at),
  };
}
