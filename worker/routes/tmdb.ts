import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, json } from '../lib/http';
import { requireVerifiedUser } from '../auth/service';
import {
  TMDB_IMAGE_BASE,
  getGenres,
  getMovieDetailMapped,
  getSeasonDetailMapped,
  getSeriesDetailMapped,
  searchTmdb,
  toSearchResult,
} from '../services/tmdb';
import type { TmdbRaw } from '../services/tmdb';
import type { TmdbSearchResult } from '../../src/shared/types';

const tmdb = new Hono<AppEnv>();
tmdb.use('*', requireVerifiedUser);

/** The library index lets search results show "already in your library". */
async function libraryIndex(env: AppEnv['Bindings'], userId: string) {
  const rows = await env.DB.prepare(
    'SELECT id, tmdb_id, kind, status FROM media_items WHERE user_id = ? AND removed_at IS NULL AND tmdb_id IS NOT NULL',
  )
    .bind(userId)
    .all<{ id: string; tmdb_id: number; kind: string; status: string }>();
  const map = new Map<string, { id: string; status: string }>();
  for (const r of rows.results ?? []) map.set(`${r.kind}:${r.tmdb_id}`, { id: r.id, status: r.status });
  return map;
}

async function genreMap(env: AppEnv['Bindings']): Promise<Map<number, string>> {
  try {
    const { movie, tv } = await getGenres(env);
    const map = new Map<number, string>();
    for (const g of movie) if (g.id !== null) map.set(g.id, g.name);
    for (const g of tv) if (g.id !== null) map.set(g.id, g.name);
    return map;
  } catch {
    return new Map();
  }
}

tmdb.get('/config', () => {
  return json({
    imageBase: TMDB_IMAGE_BASE,
    posterSizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'],
    backdropSizes: ['w300', 'w780', 'w1280', 'original'],
    stillSizes: ['w185', 'w300', 'original'],
    attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
  });
});

tmdb.get('/genres', async (c) => json(await getGenres(c.env)));

tmdb.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const type = (c.req.query('type') ?? 'all') as 'movie' | 'tv' | 'all';
  const page = Math.max(1, Math.min(500, Number(c.req.query('page') ?? 1)));
  if (!q.trim()) return json({ results: [], page, totalPages: 0, totalResults: 0 });
  if (q.trim().length < 2) {
    throw new ApiError(400, 'query_too_short', 'برای جستجو حداقل دو نویسه وارد کنید.');
  }
  const [result, index, genres] = await Promise.all([
    searchTmdb(c.env, q, type, page),
    libraryIndex(c.env, c.get('userId')),
    genreMap(c.env),
  ]);
  const results: TmdbSearchResult[] = result.results.map((r) => toSearchResult(r, genres, index));
  return json({ results, page, totalPages: result.totalPages, totalResults: result.totalResults });
});

tmdb.get('/movie/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'invalid_id', 'شناسه فیلم معتبر نیست.');
  const [index, detail] = await Promise.all([libraryIndex(c.env, c.get('userId')), getMovieDetailMapped(c.env, id, new Map())]);
  return json({ ...detail, inLibrary: index.has(`movie:${id}`), libraryId: index.get(`movie:${id}`)?.id ?? null });
});

tmdb.get('/tv/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'invalid_id', 'شناسه سریال معتبر نیست.');
  const [index, detail] = await Promise.all([libraryIndex(c.env, c.get('userId')), getSeriesDetailMapped(c.env, id, new Map())]);
  return json({ ...detail, inLibrary: index.has(`series:${id}`), libraryId: index.get(`series:${id}`)?.id ?? null });
});

tmdb.get('/tv/:id/season/:season', async (c) => {
  const id = Number(c.req.param('id'));
  const season = Number(c.req.param('season'));
  if (!Number.isInteger(id) || !Number.isInteger(season)) {
    throw new ApiError(400, 'invalid_id', 'شناسه فصل معتبر نیست.');
  }
  return json(await getSeasonDetailMapped(c.env, id, season));
});

// ─────────────────────────────────────────────────────────────
// Browse pages: trending / popular / discover
// ─────────────────────────────────────────────────────────────

async function mapResults(
  env: AppEnv['Bindings'],
  userId: string,
  raw: TmdbRaw[],
  mediaType: 'movie' | 'tv',
): Promise<TmdbSearchResult[]> {
  const [index, genres] = await Promise.all([libraryIndex(env, userId), genreMap(env)]);
  return raw.map((r) => toSearchResult({ ...r, media_type: mediaType }, genres, index));
}

tmdb.get('/trending', async (c) => {
  const mediaType = c.req.query('type') === 'tv' ? 'tv' : 'movie';
  const window = c.req.query('window') === 'day' ? 'day' : 'week';
  const { tmdbLocalized } = await import('../services/tmdb');
  const raw = (await tmdbLocalized(c.env, `/trending/${mediaType}/${window}`, {})) as TmdbRaw;
  return json({ results: await mapResults(c.env, c.get('userId'), raw.results ?? [], mediaType) });
});

tmdb.get('/popular', async (c) => {
  const mediaType = c.req.query('type') === 'tv' ? 'tv' : 'movie';
  const page = Math.max(1, Math.min(500, Number(c.req.query('page') ?? 1)));
  const { tmdbLocalized } = await import('../services/tmdb');
  const raw = (await tmdbLocalized(c.env, `/${mediaType}/popular`, { page: String(page) })) as TmdbRaw;
  const results = await mapResults(c.env, c.get('userId'), raw.results ?? [], mediaType);
  return json({ results, page, totalPages: Number(raw.total_pages ?? 1), totalResults: Number(raw.total_results ?? 0) });
});

tmdb.get('/discover', async (c) => {
  const mediaType = c.req.query('type') === 'tv' ? 'tv' : 'movie';
  const page = Math.max(1, Math.min(500, Number(c.req.query('page') ?? 1)));
  const genre = c.req.query('genre');
  const year = c.req.query('year');
  const anime = c.req.query('anime') === '1';

  const params: Record<string, string> = {
    page: String(page),
    sort_by: c.req.query('sort') === 'rating' ? 'vote_average.desc' : 'popularity.desc',
    'vote_count.gte': '50',
  };
  if (genre) params.with_genres = genre;
  if (year) params.year = year;
  if (anime) {
    params.with_genres = '16';
    params.with_keywords = '210024';
  }

  const { tmdbLocalized } = await import('../services/tmdb');
  const raw = (await tmdbLocalized(c.env, `/discover/${mediaType}`, params)) as TmdbRaw;
  const results = await mapResults(c.env, c.get('userId'), raw.results ?? [], mediaType);
  return json({
    results: anime ? results.map((r) => ({ ...r, isAnime: true })) : results,
    page,
    totalPages: Number(raw.total_pages ?? 1),
    totalResults: Number(raw.total_results ?? 0),
  });
});

export default tmdb;
