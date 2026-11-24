import type { Env } from '../env';
import { ApiError } from '../lib/http';
import { looksLikeAnime } from '../../src/shared/constants';
import type { CastRef, GenreRef, TmdbMovieDetail, TmdbSearchResult, TmdbSeasonDetail, TmdbSeriesDetail } from '../../src/shared/types';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SEARCH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SEASONS_PER_SYNC = 30;

interface CacheEntry {
  body: string;
  expires_at: number;
}

function cacheKey(path: string, params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return `${path}?${sorted}`;
}

async function readCache(env: Env, key: string): Promise<unknown | null> {
  const row = await env.DB.prepare('SELECT body, expires_at FROM tmdb_cache WHERE cache_key = ?')
    .bind(key)
    .first<CacheEntry>();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  try {
    return JSON.parse(row.body);
  } catch {
    return null;
  }
}

async function writeCache(env: Env, key: string, value: unknown, ttlMs: number): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO tmdb_cache (cache_key, body, fetched_at, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body,
       fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
  )
    .bind(key, JSON.stringify(value), now, now + ttlMs)
    .run()
    .catch(() => undefined);

  // Opportunistic eviction keeps the table from growing without bound.
  if (Math.random() < 0.01) {
    env.DB.prepare('DELETE FROM tmdb_cache WHERE expires_at < ?')
      .bind(now - 60_000)
      .run()
      .catch(() => undefined);
  }
}

async function tmdbFetch(env: Env, path: string, params: Record<string, string>): Promise<unknown> {
  if (!env.TMDB_API_KEY || /your_|change_me/.test(env.TMDB_API_KEY)) {
    throw new ApiError(
      503,
      'tmdb_not_configured',
      'اتصال به پایگاه اطلاعات فیلم و سریال هنوز پیکربندی نشده است. مدیر باید کلید TMDB را تنظیم کند.',
    );
  }
  const base = (env.TMDB_API_BASE_URL ?? 'https://api.themoviedb.org/3').replace(/\/$/, '');
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${env.TMDB_API_KEY}`,
        accept: 'application/json',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
  } catch (err) {
    console.error('TMDB network error', err);
    throw new ApiError(502, 'tmdb_unreachable', 'ارتباط با پایگاه اطلاعات فیلم برقرار نشد. لطفاً دوباره تلاش کنید.');
  }

  if (response.status === 429) {
    throw new ApiError(429, 'tmdb_rate_limited', 'سرور اطلاعات فیلم مشغول است. چند لحظه بعد دوباره تلاش کنید.');
  }
  if (response.status === 401) {
    throw new ApiError(503, 'tmdb_invalid_key', 'کلید پیکربندی‌شده‌ی TMDB معتبر نیست.');
  }
  if (!response.ok) {
    throw new ApiError(502, 'tmdb_error', `پاسخ نامعتبر از سرور اطلاعات فیلم (${response.status})`);
  }
  return response.json();
}

/** Loosely typed TMDB JSON: known fields are declared, everything else stays `unknown`. */
export interface TmdbRaw {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  overview_en?: string;
  tagline?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  runtime?: number | null;
  episode_run_time?: number[];
  origin_country?: string[];
  original_language?: string;
  genres?: { id?: number; name?: string }[];
  genre_ids?: number[];
  popularity?: number;
  vote_average?: number;
  media_type?: string;
  results?: TmdbRaw[];
  seasons?: TmdbRaw[];
  episodes?: TmdbRaw[];
  credits?: TmdbRaw;
  production_countries?: { iso_3166_1?: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  total_pages?: number;
  total_results?: number;
  [key: string]: unknown;
}

/**
 * Fetches Persian metadata and fills any blank fields from the English response,
 * so the UI is Persian whenever TMDB has a translation and English otherwise.
 */
export async function tmdbLocalized(
  env: Env,
  path: string,
  params: Record<string, string>,
  options: { ttl?: number; fallback?: boolean } = {},
): Promise<TmdbRaw> {
  const faParams = { ...params, language: 'fa-IR' };
  const key = cacheKey(path, faParams);
  const cached = await readCache(env, key);
  if (cached) return cached as TmdbRaw;

  const fa = (await tmdbFetch(env, path, faParams)) as TmdbRaw;

  let merged = fa;
  if (options.fallback !== false) {
    const needsFallback =
      !fa.overview ||
      String(fa.overview).trim() === '' ||
      !fa.title && !fa.name && !fa.title_original;
    if (needsFallback) {
      try {
        const en = (await tmdbFetch(env, path, { ...params, language: 'en-US' })) as TmdbRaw;
        merged = {
          ...fa,
          overview: fa.overview || en.overview || '',
          overview_en: en.overview || '',
          tagline: fa.tagline || en.tagline || '',
        };
      } catch {
        merged = { ...fa, overview_en: '' };
      }
    } else {
      merged = { ...fa };
    }
  }

  await writeCache(env, key, merged, options.ttl ?? DEFAULT_TTL_MS);
  return merged;
}

// ─────────────────────────────────────────────────────────────
// Normalisation helpers
// ─────────────────────────────────────────────────────────────

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickTitle(item: TmdbRaw): string {
  return String(item.title ?? item.name ?? item.original_title ?? item.original_name ?? 'بدون عنوان');
}

function pickOriginalTitle(item: TmdbRaw): string {
  return String(item.original_title ?? item.original_name ?? '');
}

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const m = /^(\d{4})/.exec(String(date));
  return m ? Number(m[1]) : null;
}

function normalizeGenres(input: unknown): GenreRef[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((g): g is { id?: number; name?: string } => Boolean(g && typeof g === 'object'))
    .map((g) => ({ id: typeof g.id === 'number' ? g.id : null, name: String(g.name ?? '') }))
    .filter((g) => g.name.length > 0);
}

function normalizeCast(credits: TmdbRaw | undefined, limit = 12): CastRef[] {
  const cast = credits?.cast;
  if (!Array.isArray(cast)) return [];
  return cast
    .slice(0, limit)
    .map((p: TmdbRaw) => ({
      id: typeof p.id === 'number' ? p.id : null,
      name: str(p.name, str(p.original_name)),
      character: strOrNull(p.character),
      profilePath: strOrNull(p.profile_path),
      order: typeof p.order === 'number' ? p.order : undefined,
    }))
    .filter((p) => p.name.length > 0);
}

function directorOf(credits: TmdbRaw | undefined): string | null {
  const crew = credits?.crew;
  if (!Array.isArray(crew)) return null;
  const directors = crew.filter((p: TmdbRaw) => p?.job === 'Director' && p?.name);
  if (directors.length === 0) return null;
  return directors
    .slice(0, 3)
    .map((d: TmdbRaw) => str(d.name))
    .join('، ');
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export async function searchTmdb(
  env: Env,
  query: string,
  kind: 'movie' | 'tv' | 'all',
  page = 1,
): Promise<{ results: TmdbRaw[]; totalPages: number; totalResults: number }> {
  const q = query.trim();
  if (!q) return { results: [], totalPages: 0, totalResults: 0 };
  const tasks: Array<Promise<TmdbRaw>> = [];
  if (kind === 'movie' || kind === 'all') {
    tasks.push(tmdbLocalized(env, '/search/movie', { query: q, page: String(page), include_adult: 'false' }, { ttl: SEARCH_TTL_MS }));
  }
  if (kind === 'tv' || kind === 'all') {
    tasks.push(tmdbLocalized(env, '/search/tv', { query: q, page: String(page), include_adult: 'false' }, { ttl: SEARCH_TTL_MS }));
  }
  const responses = await Promise.all(tasks);
  let results: TmdbRaw[] = [];
  let totalPages = 0;
  let totalResults = 0;
  for (const [i, res] of responses.entries()) {
    const mediaType = kind === 'all' ? (i === 0 ? 'movie' : 'tv') : kind;
    results = results.concat(
      (res.results ?? []).map((r: TmdbRaw) => ({
        ...r,
        media_type: mediaType,
      })),
    );
    totalPages = Math.max(totalPages, Number(res.total_pages ?? 0));
    totalResults += Number(res.total_results ?? 0);
  }
  results.sort((a, b) => Number(b.popularity ?? 0) - Number(a.popularity ?? 0));
  return { results, totalPages, totalResults };
}

export function toSearchResult(
  item: TmdbRaw,
  genreMap: Map<number, string>,
  libraryIndex: Map<string, { id: string; status: string }>,
): TmdbSearchResult {
  const mediaType = item.media_type === 'tv' ? 'tv' : 'movie';
  const key = `${mediaType === 'tv' ? 'series' : 'movie'}:${item.id}`;
  const existing = libraryIndex.get(key);
  const genreIds: number[] = Array.isArray(item.genre_ids)
    ? item.genre_ids.filter((n: unknown): n is number => typeof n === 'number')
    : Array.isArray(item.genres)
      ? item.genres.map((g: { id?: number }) => Number(g?.id)).filter((n: number) => Number.isFinite(n))
      : [];
  return {
    id: Number(item.id),
    mediaType,
    title: pickTitle(item),
    originalTitle: pickOriginalTitle(item),
    overview: item.overview ? String(item.overview) : null,
    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    releaseDate: item.release_date ?? item.first_air_date ?? null,
    year: yearOf(item.release_date ?? item.first_air_date),
    genres: genreIds.map((id) => ({ id, name: genreMap.get(id) ?? String(id) })),
    isAnime: looksLikeAnime({
      genres: genreIds.map((id) => ({ id, name: '' })),
      originCountry: item.origin_country,
      originalLanguage: item.original_language,
    }),
    inLibrary: Boolean(existing),
    libraryId: existing?.id ?? null,
    libraryStatus: (existing?.status as TmdbSearchResult['libraryStatus']) ?? null,
  };
}

export async function fetchMovie(env: Env, tmdbId: number): Promise<TmdbRaw> {
  return tmdbLocalized(env, `/movie/${tmdbId}`, {
    append_to_response: 'credits,alternative_titles,release_dates',
  });
}

export async function fetchSeries(env: Env, tmdbId: number): Promise<TmdbRaw> {
  return tmdbLocalized(env, `/tv/${tmdbId}`, {
    append_to_response: 'credits,alternative_titles,content_ratings',
  });
}

export async function fetchSeason(env: Env, tmdbId: number, seasonNumber: number): Promise<TmdbRaw> {
  return tmdbLocalized(env, `/tv/${tmdbId}/season/${seasonNumber}`, {});
}

export async function getMovieDetailMapped(
  env: Env,
  tmdbId: number,
  libraryIndex: Map<string, { id: string; status: string }>,
): Promise<TmdbMovieDetail> {
  const raw = await fetchMovie(env, tmdbId);
  const existing = libraryIndex.get(`movie:${tmdbId}`);
  const genres = normalizeGenres(raw.genres);
  const countries = (raw.production_countries ?? []) as { iso_3166_1?: string; name?: string }[];
  return {
    kind: 'movie',
    tmdbId,
    title: pickTitle(raw),
    originalTitle: pickOriginalTitle(raw),
    overview: raw.overview ? String(raw.overview) : null,
    overviewEn: (raw.overview_en as string) || null,
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    releaseDate: raw.release_date ?? null,
    year: yearOf(raw.release_date),
    genres,
    runtimeMinutes: typeof raw.runtime === 'number' ? raw.runtime : null,
    country: countries[0]?.iso_3166_1 ?? null,
    language: raw.original_language ?? null,
    director: directorOf(raw.credits),
    cast: normalizeCast(raw.credits),
    isAnime: looksLikeAnime({
      genres,
      originCountry: countries.map((c) => c.iso_3166_1).filter((v): v is string => Boolean(v)),
      originalLanguage: raw.original_language,
    }),
    inLibrary: Boolean(existing),
    libraryId: existing?.id ?? null,
  };
}

export async function getSeriesDetailMapped(
  env: Env,
  tmdbId: number,
  libraryIndex: Map<string, { id: string; status: string }>,
): Promise<TmdbSeriesDetail> {
  const raw = await fetchSeries(env, tmdbId);
  const existing = libraryIndex.get(`series:${tmdbId}`);
  const genres = normalizeGenres(raw.genres);
  const seasons = (raw.seasons ?? []) as TmdbRaw[];
  return {
    kind: 'series',
    tmdbId,
    title: pickTitle(raw),
    originalTitle: pickOriginalTitle(raw),
    overview: raw.overview ? String(raw.overview) : null,
    overviewEn: (raw.overview_en as string) || null,
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    releaseDate: raw.first_air_date ?? null,
    year: yearOf(raw.first_air_date),
    genres,
    runtimeMinutes: Array.isArray(raw.episode_run_time) && raw.episode_run_time.length > 0
      ? Number(raw.episode_run_time[0])
      : null,
    country: Array.isArray(raw.origin_country) ? raw.origin_country[0] ?? null : null,
    language: raw.original_language ?? null,
    director: directorOf(raw.credits),
    cast: normalizeCast(raw.credits),
    isAnime: looksLikeAnime({
      genres,
      originCountry: raw.origin_country,
      originalLanguage: raw.original_language,
    }),
    numberOfSeasons: Number(raw.number_of_seasons ?? seasons.length),
    numberOfEpisodes: Number(raw.number_of_episodes ?? 0),
    seasons: seasons.map((s) => ({
      seasonNumber: Number(s.season_number ?? 0),
      name: String(s.name ?? ''),
      overview: s.overview ? String(s.overview) : null,
      posterPath: strOrNull(s.poster_path),
      airDate: strOrNull(s.air_date),
      episodeCount: Number(s.episode_count ?? 0),
    })),
    inLibrary: Boolean(existing),
    libraryId: existing?.id ?? null,
  };
}

export async function getSeasonDetailMapped(
  env: Env,
  tmdbId: number,
  seasonNumber: number,
): Promise<TmdbSeasonDetail> {
  const raw = await fetchSeason(env, tmdbId, seasonNumber);
  return {
    seasonNumber,
    name: String(raw.name ?? `فصل ${seasonNumber}`),
    overview: raw.overview ? String(raw.overview) : null,
    posterPath: strOrNull(raw.poster_path),
    airDate: strOrNull(raw.air_date),
    episodes: (raw.episodes ?? []).map((e) => ({
      episodeNumber: Number(e.episode_number ?? 0),
      name: String(e.name ?? `قسمت ${e.episode_number}`),
      originalName: strOrNull(e.original_name),
      overview: strOrNull(e.overview),
      stillPath: strOrNull(e.still_path),
      airDate: strOrNull(e.air_date),
      runtimeMinutes: typeof e.runtime === 'number' ? e.runtime : null,
      tmdbEpisodeId: typeof e.id === 'number' ? e.id : null,
    })),
  };
}

export async function getGenres(env: Env): Promise<{ movie: GenreRef[]; tv: GenreRef[] }> {
  const [movie, tv] = await Promise.all([
    tmdbLocalized(env, '/genre/movie/list', {}, { fallback: false }),
    tmdbLocalized(env, '/genre/tv/list', {}, { fallback: false }),
  ]);
  return { movie: normalizeGenres(movie.genres), tv: normalizeGenres(tv.genres) };
}

export { MAX_SEASONS_PER_SYNC, directorOf, normalizeCast, normalizeGenres, pickTitle, yearOf };
