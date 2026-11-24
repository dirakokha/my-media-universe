import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, json, readJson } from '../lib/http';
import { rowToEpisode, rowToMediaItem, rowToSeason, rowToWatchEvent } from '../lib/mappers';
import { requireVerifiedUser } from '../auth/service';
import { computeFinalRating, computeSeasonScore, computeSeriesScore, normalizeCriteria, snapRating, isValidRating } from '../../src/shared/ratings';
import { WATCH_STATUSES } from '../../src/shared/constants';
import type { MediaDetail, Paginated, Quote } from '../../src/shared/types';
import {
  MAX_SEASONS_PER_SYNC,
  getMovieDetailMapped,
  getSeasonDetailMapped,
  getSeriesDetailMapped,
} from '../services/tmdb';

const library = new Hono<AppEnv>();
library.use('*', requireVerifiedUser);

library.get('/meta/genres', async (c) => {
  const { getGenres } = await import('../services/tmdb');
  return json(await getGenres(c.env));
});

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

const ratingSchema = z.object({
  method: z.enum(['direct', 'criteria']).default('direct'),
  direct: z.number().min(0).max(10).multipleOf(0.5).nullable().optional(),
  criteria: z.record(z.number().min(0).max(10).multipleOf(0.5)).optional(),
});

const quotesSchema = z
  .array(z.object({ id: z.string().min(1).max(64), text: z.string().trim().min(1).max(1000) }))
  .max(40);

const watchSchema = z.object({
  watchedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rating: ratingSchema.optional(),
  notes: z.string().trim().max(10000).optional(),
  quotes: quotesSchema.optional(),
  isSpoiler: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

const addTmdbSchema = z.object({
  tmdb: z.object({ kind: z.enum(['movie', 'tv']), tmdbId: z.number().int().positive() }),
  status: z.enum(WATCH_STATUSES).optional(),
  isAnime: z.boolean().optional(),
});

const addManualSchema = z.object({
  manual: z.object({
    title: z.string().trim().min(1).max(200),
    originalTitle: z.string().trim().max(200).optional(),
    kind: z.enum(['movie', 'series']),
    isAnime: z.boolean().optional(),
    overview: z.string().trim().max(5000).optional(),
    releaseYear: z.number().int().min(1800).max(2200).optional(),
    posterData: z.string().max(400_000).optional(),
    genres: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
    runtimeMinutes: z.number().int().min(1).max(1000).optional(),
  }),
  status: z.enum(WATCH_STATUSES).optional(),
});

const patchItemSchema = z.object({
  status: z.enum(WATCH_STATUSES).optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  quotes: quotesSchema.nullable().optional(),
  isSpoiler: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  watchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  favorite: z.boolean().optional(),
  // editable only for manual items
  title: z.string().trim().min(1).max(200).optional(),
  originalTitle: z.string().trim().max(200).nullable().optional(),
  overview: z.string().trim().max(5000).nullable().optional(),
  year: z.number().int().min(1800).max(2200).nullable().optional(),
  runtimeMinutes: z.number().int().min(1).max(1000).nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  posterData: z.string().max(400_000).nullable().optional(),
  isAnime: z.boolean().optional(),
});

const patchEpisodeSchema = z.object({
  watched: z.boolean().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  quotes: quotesSchema.nullable().optional(),
  isSpoiler: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  watchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function getItem(env: AppEnv['Bindings'], userId: string, id: string) {
  const row = await env.DB.prepare('SELECT * FROM media_items WHERE id = ? AND user_id = ? AND removed_at IS NULL')
    .bind(id, userId)
    .first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'not_found', 'این اثر در کتابخانه شما پیدا نشد.');
  return row;
}

async function getEpisode(env: AppEnv['Bindings'], userId: string, mediaItemId: string, episodeId: string) {
  const row = await env.DB.prepare(
    'SELECT * FROM episodes WHERE id = ? AND user_id = ? AND media_item_id = ?',
  )
    .bind(episodeId, userId, mediaItemId)
    .first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'not_found', 'این قسمت پیدا نشد.');
  return row;
}

function resolveRating(input: z.infer<typeof ratingSchema>) {
  const method = input.method;
  const direct = typeof input.direct === 'number' && isValidRating(input.direct) ? snapRating(input.direct) : null;
  const criteria = normalizeCriteria(input.criteria);
  const final = computeFinalRating(method, direct, criteria);
  return { method, direct, criteria, final };
}

async function updateItemRating(
  env: AppEnv['Bindings'],
  userId: string,
  itemId: string,
  input: z.infer<typeof ratingSchema>,
) {
  const r = resolveRating(input);
  await env.DB.prepare(
    `UPDATE media_items SET rating_method = ?, rating_direct = ?, criteria = ?, rating_final = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  )
    .bind(r.method, r.direct, JSON.stringify(r.criteria), r.final, Date.now(), itemId, userId)
    .run();
  return r;
}

async function updateEpisodeRating(
  env: AppEnv['Bindings'],
  userId: string,
  episodeId: string,
  input: z.infer<typeof ratingSchema>,
) {
  const r = resolveRating(input);
  await env.DB.prepare(
    `UPDATE episodes SET rating_method = ?, rating_direct = ?, criteria = ?, rating_final = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  )
    .bind(r.method, r.direct, JSON.stringify(r.criteria), r.final, Date.now(), episodeId, userId)
    .run();
  return r;
}

async function libraryIndex(env: AppEnv['Bindings'], userId: string): Promise<Map<string, { id: string; status: string }>> {
  const rows = await env.DB.prepare(
    'SELECT id, tmdb_id, kind, status FROM media_items WHERE user_id = ? AND removed_at IS NULL AND tmdb_id IS NOT NULL',
  )
    .bind(userId)
    .all<{ id: string; tmdb_id: number; kind: string; status: string }>();
  const map = new Map<string, { id: string; status: string }>();
  for (const r of rows.results ?? []) map.set(`${r.kind}:${r.tmdb_id}`, { id: r.id, status: r.status });
  return map;
}

// ─────────────────────────────────────────────────────────────
// GET /api/library — filtered, paginated
// ─────────────────────────────────────────────────────────────

library.get('/', async (c) => {
  const userId = c.get('userId');
  const q = c.req.query('q')?.trim() ?? '';
  const kind = c.req.query('kind') ?? '';
  const status = c.req.query('status') ?? '';
  const categoryId = c.req.query('categoryId') ?? '';
  const sort = c.req.query('sort') ?? 'recent';
  const favorite = c.req.query('favorite') === '1';
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 40)));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0));

  const where: string[] = ['m.user_id = ?', 'm.removed_at IS NULL'];
  const params: unknown[] = [userId];

  if (kind === 'anime') where.push('m.is_anime = 1');
  else if (kind === 'movie') where.push("m.kind = 'movie' AND m.is_anime = 0");
  else if (kind === 'series') where.push("m.kind = 'series' AND m.is_anime = 0");

  if (WATCH_STATUSES.includes(status as (typeof WATCH_STATUSES)[number])) {
    where.push('m.status = ?');
    params.push(status);
  }
  if (favorite) where.push('m.favorite = 1');
  if (categoryId) {
    where.push('m.id IN (SELECT ci.media_item_id FROM category_items ci JOIN categories cat ON cat.id = ci.category_id WHERE cat.user_id = ? AND cat.id = ?)');
    params.push(userId, categoryId);
  }
  if (q) {
    where.push('(m.title LIKE ? OR m.original_title LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const orderSql: Record<string, string> = {
    recent: 'm.updated_at DESC',
    rating: 'm.rating_final DESC NULLS LAST',
    title: 'm.title COLLATE NOCASE ASC',
    year: 'm.year DESC NULLS LAST',
  };
  const order = orderSql[sort] ?? orderSql.recent;

  const whereSql = where.join(' AND ');
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media_items m WHERE ${whereSql}`)
    .bind(...params)
    .first<{ n: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM watch_events w WHERE w.media_item_id = m.id) AS watch_count
       FROM media_items m
      WHERE ${whereSql}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<Record<string, unknown>>();

  const items = (rows.results ?? []).map(rowToMediaItem);
  const result: Paginated<typeof items[number]> = {
    items,
    total: Number(totalRow?.n ?? 0),
    offset,
    limit,
    hasMore: offset + items.length < Number(totalRow?.n ?? 0),
  };
  return json(result);
});

// ─────────────────────────────────────────────────────────────
// POST /api/library — add from TMDB or manually
// ─────────────────────────────────────────────────────────────

library.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = addTmdbSchema.safeParse(body);
  const manualParsed = addManualSchema.safeParse(body);

  if (!parsed.success && !manualParsed.success) {
    throw new ApiError(400, 'validation_error', 'برای افزودن اثر، اطلاعات TMDB یا فیلدهای دستی را بفرستید.');
  }

  if (parsed.success) {
    const { kind, tmdbId } = parsed.data.tmdb;
    const existing = await c.env.DB.prepare(
      'SELECT id FROM media_items WHERE user_id = ? AND tmdb_id = ? AND kind = ? AND removed_at IS NULL',
    )
      .bind(userId, tmdbId, kind)
      .first();
    if (existing) {
      throw new ApiError(409, 'already_in_library', 'این اثر قبلاً به کتابخانه شما اضافه شده است.', {
        id: String(existing.id),
      });
    }

    const index = await libraryIndex(c.env, userId);
    const detail =
      kind === 'movie'
        ? await getMovieDetailMapped(c.env, tmdbId, index)
        : await getSeriesDetailMapped(c.env, tmdbId, index);
    const itemId = crypto.randomUUID();
    const now = Date.now();
    const isAnime = parsed.data.isAnime ?? detail.isAnime;

    await c.env.DB.prepare(
      `INSERT INTO media_items (id, user_id, source, tmdb_id, kind, is_anime, title, original_title, overview,
          overview_en, poster_path, backdrop_path, release_date, year, genres, runtime_minutes, country, language,
          director, cast_list, status, rating_method, criteria, notes, quotes, tags, added_at, updated_at)
       VALUES (?, ?, 'tmdb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct', '{}', NULL, '[]', '[]', ?, ?)`,
    )
      .bind(
        itemId, userId, tmdbId, detail.kind, isAnime ? 1 : 0, detail.title, detail.originalTitle,
        detail.overview, detail.overviewEn, detail.posterPath, detail.backdropPath, detail.releaseDate,
        detail.year, JSON.stringify(detail.genres), detail.runtimeMinutes, detail.country, detail.language,
        detail.director, JSON.stringify(detail.cast), parsed.data.status ?? 'plan', now, now,
      )
      .run();

    if (detail.kind === 'series' && 'seasons' in detail) {
      await syncSeriesStructure(c.env, userId, itemId, tmdbId, detail.seasons);
    }
    return json(await buildDetail(c, userId, itemId), 201);
  }

  // Manual item
  if (!manualParsed.success) {
    throw new ApiError(400, 'validation_error', 'اطلاعات اثر دستی معتبر نیست.');
  }
  const m = manualParsed.data.manual;
  const itemId = crypto.randomUUID();
  const now = Date.now();
  const releaseDate = m.releaseYear ? `${m.releaseYear}-01-01` : null;
  await c.env.DB.prepare(
    `INSERT INTO media_items (id, user_id, source, kind, is_anime, title, original_title, overview, poster_path,
        custom_poster_data, release_date, year, genres, runtime_minutes, status, rating_method, criteria, notes,
        quotes, tags, added_at, updated_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'direct', '{}', NULL, '[]', '[]', ?, ?)`,
  )
    .bind(
      itemId, userId, m.kind, m.isAnime ? 1 : 0, m.title, m.originalTitle ?? null, m.overview ?? null,
      m.posterData ?? null, releaseDate, m.releaseYear ?? null,
      JSON.stringify((m.genres ?? []).map((name) => ({ id: null, name }))),
      m.runtimeMinutes ?? null, manualParsed.data.status ?? 'plan', now, now,
    )
    .run();

  return json(await buildDetail(c, userId, itemId), 201);
});

/** Pull season + episode structure from TMDB and upsert without touching user data. */
async function syncSeriesStructure(
  env: AppEnv['Bindings'],
  userId: string,
  mediaItemId: string,
  tmdbId: number,
  seasons: Array<{ seasonNumber: number; name: string; overview: string | null; posterPath: string | null; airDate: string | null; episodeCount: number }>,
): Promise<void> {
  const now = Date.now();
  const limited = seasons.filter((s) => s.seasonNumber >= 0).slice(0, MAX_SEASONS_PER_SYNC);

  for (const s of limited) {
    const seasonName = s.name || `فصل ${s.seasonNumber}`;
    let episodes: Awaited<ReturnType<typeof getSeasonDetailMapped>>['episodes'] = [];

    try {
      episodes = (await getSeasonDetailMapped(env, tmdbId, s.seasonNumber)).episodes;
    } catch (err) {
      console.error('Season sync failed', tmdbId, s.seasonNumber, err);
      await env.DB.prepare(
        `INSERT INTO seasons (id, user_id, media_item_id, tmdb_season_id, season_number, name, overview,
            poster_path, air_date, episode_count, added_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, media_item_id, season_number) DO UPDATE SET
           episode_count = excluded.episode_count, updated_at = excluded.updated_at`,
      )
        .bind(crypto.randomUUID(), userId, mediaItemId, s.seasonNumber, seasonName, s.overview,
          s.posterPath, s.airDate, s.episodeCount, now, now)
        .run();
      continue;
    }

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO seasons (id, user_id, media_item_id, tmdb_season_id, season_number, name, overview,
            poster_path, air_date, episode_count, added_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, media_item_id, season_number) DO UPDATE SET
           name = excluded.name, overview = excluded.overview, poster_path = excluded.poster_path,
           air_date = excluded.air_date, episode_count = excluded.episode_count, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), userId, mediaItemId, s.seasonNumber, seasonName, s.overview,
        s.posterPath, s.airDate, episodes.length || s.episodeCount, now, now),
    ];

    for (const e of episodes) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO episodes (id, user_id, media_item_id, tmdb_episode_id, season_number, episode_number, name,
              original_name, overview, still_path, air_date, runtime_minutes, watched, rating_method, rating_direct,
              criteria, rating_final, notes, quotes, tags, is_spoiler, watch_date, added_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'direct', NULL, '{}', NULL, NULL, '[]', '[]', 0, NULL, ?, ?)
           ON CONFLICT(user_id, media_item_id, season_number, episode_number) DO UPDATE SET
             name = excluded.name, original_name = excluded.original_name, overview = excluded.overview,
             still_path = excluded.still_path, air_date = excluded.air_date,
             runtime_minutes = excluded.runtime_minutes, tmdb_episode_id = excluded.tmdb_episode_id,
             updated_at = excluded.updated_at`,
        ).bind(crypto.randomUUID(), userId, mediaItemId, e.tmdbEpisodeId, s.seasonNumber, e.episodeNumber,
          e.name, e.originalName, e.overview, e.stillPath, e.airDate, e.runtimeMinutes, now, now),
      );
    }

    await env.DB.batch(statements);
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/library/:id
// ─────────────────────────────────────────────────────────────

async function buildDetail(c: Context<AppEnv>, userId: string, itemId: string): Promise<MediaDetail> {
  const env = c.env;
  const row = await env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM watch_events w WHERE w.media_item_id = m.id) AS watch_count
       FROM media_items m WHERE m.id = ? AND m.user_id = ? AND m.removed_at IS NULL`,
  )
    .bind(itemId, userId)
    .first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'not_found', 'این اثر در کتابخانه شما پیدا نشد.');
  const item = rowToMediaItem(row);

  const seasonRows = await env.DB.prepare(
    'SELECT * FROM seasons WHERE media_item_id = ? AND user_id = ? ORDER BY season_number',
  )
    .bind(itemId, userId)
    .all<Record<string, unknown>>();

  const episodeRows = await env.DB.prepare(
    'SELECT * FROM episodes WHERE media_item_id = ? AND user_id = ? ORDER BY season_number, episode_number',
  )
    .bind(itemId, userId)
    .all<Record<string, unknown>>();

  const episodes = (episodeRows.results ?? []).map(rowToEpisode);
  const seasons = (seasonRows.results ?? []).map(rowToSeason).map((s) => {
    const seasonEpisodes = episodes.filter((e) => e.seasonNumber === s.seasonNumber);
    return {
      ...s,
      episodes: seasonEpisodes,
      score: computeSeasonScore(seasonEpisodes),
      ratedCount: seasonEpisodes.filter((e) => e.ratingFinal !== null).length,
    };
  });

  const watchRows = await env.DB.prepare(
    `SELECT w.*, CASE WHEN w.episode_id IS NULL THEN NULL
             ELSE 'فصل ' || e.season_number || ' · قسمت ' || e.episode_number END AS episode_label
       FROM watch_events w LEFT JOIN episodes e ON e.id = w.episode_id
      WHERE w.media_item_id = ? AND w.user_id = ?
      ORDER BY w.watched_at DESC, w.created_at DESC`,
  )
    .bind(itemId, userId)
    .all<Record<string, unknown>>();

  const categoryRows = await env.DB.prepare(
    `SELECT cat.id, cat.name, cat.color FROM categories cat
       JOIN category_items ci ON ci.category_id = cat.id
      WHERE ci.media_item_id = ? AND cat.user_id = ? ORDER BY cat.sort_order`,
  )
    .bind(itemId, userId)
    .all<{ id: string; name: string; color: string | null }>();

  const listRows = await env.DB.prepare(
    `SELECT l.id, l.name FROM lists l
       JOIN list_items li ON li.list_id = l.id
      WHERE li.media_item_id = ? AND l.user_id = ? ORDER BY l.name`,
  )
    .bind(itemId, userId)
    .all<{ id: string; name: string }>();

  const { score, rated } = computeSeriesScore(episodes);

  return {
    ...item,
    seasons,
    computedScore: score,
    ratedEpisodeCount: rated,
    totalEpisodeCount: episodes.length,
    watchEvents: (watchRows.results ?? []).map(rowToWatchEvent),
    categories: categoryRows.results ?? [],
    lists: listRows.results ?? [],
  };
}

library.get('/:id', async (c) => {
  return json(await buildDetail(c, c.get('userId'), c.req.param('id')));
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/library/:id
// ─────────────────────────────────────────────────────────────

library.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await getItem(c.env, userId, id);
  const body = await readJson(patchItemSchema, c);

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (body.status !== undefined) push('status', body.status);
  if (body.notes !== undefined) push('notes', body.notes);
  if (body.quotes !== undefined) push('quotes', JSON.stringify(body.quotes));
  if (body.isSpoiler !== undefined) push('is_spoiler', body.isSpoiler ? 1 : 0);
  if (body.tags !== undefined) push('tags', JSON.stringify(body.tags));
  if (body.watchDate !== undefined) push('watch_date', body.watchDate);
  if (body.favorite !== undefined) push('favorite', body.favorite ? 1 : 0);

  if (row.source === 'manual') {
    if (body.title !== undefined) push('title', body.title);
    if (body.originalTitle !== undefined) push('original_title', body.originalTitle);
    if (body.overview !== undefined) push('overview', body.overview);
    if (body.year !== undefined) {
      push('year', body.year);
      push('release_date', body.year ? `${body.year}-01-01` : null);
    }
    if (body.runtimeMinutes !== undefined) push('runtime_minutes', body.runtimeMinutes);
    if (body.genres !== undefined) {
      push('genres', JSON.stringify(body.genres.map((name) => ({ id: null, name }))));
    }
    if (body.posterData !== undefined) push('custom_poster_data', body.posterData);
  }
  if (body.isAnime !== undefined) push('is_anime', body.isAnime ? 1 : 0);

  if (sets.length === 0) throw new ApiError(400, 'no_changes', 'هیچ تغییری برای ذخیره وجود ندارد.');

  push('updated_at', Date.now());
  await c.env.DB.prepare(`UPDATE media_items SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params, id, userId)
    .run();

  return json(await buildDetail(c, userId, id));
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/library/:id (soft delete, keeps history recoverable)
// ─────────────────────────────────────────────────────────────

library.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await getItem(c.env, userId, id);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE media_items SET removed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, now, id, userId),
    c.env.DB.prepare('DELETE FROM list_items WHERE media_item_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM category_items WHERE media_item_id = ?').bind(id),
  ]);
  return json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Ratings
// ─────────────────────────────────────────────────────────────

library.post('/:id/rating', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await getItem(c.env, userId, id);
  const body = await readJson(ratingSchema, c);
  const r = await updateItemRating(c.env, userId, id, body);
  return json({ rating: r });
});

library.delete('/:id/rating', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await getItem(c.env, userId, id);
  await c.env.DB.prepare(
    `UPDATE media_items SET rating_method = 'direct', rating_direct = NULL, criteria = '{}',
       rating_final = NULL, updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(Date.now(), id, userId)
    .run();
  return json({ ok: true });
});

library.post('/:id/final-rating', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await getItem(c.env, userId, id);
  if (row.kind !== 'series') {
    throw new ApiError(400, 'not_a_series', 'امتیاز نهایی مستقل فقط برای سریال‌ها تعریف شده است.');
  }
  const body = await readJson(z.object({ rating: z.number().min(0).max(10).multipleOf(0.5).nullable() }), c);
  const value = body.rating === null ? null : snapRating(body.rating);
  await c.env.DB.prepare('UPDATE media_items SET final_series_rating = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(value, Date.now(), id, userId)
    .run();
  return json({ finalSeriesRating: value });
});

// ─────────────────────────────────────────────────────────────
// Watch events (rewatches)
// ─────────────────────────────────────────────────────────────

library.post('/:id/watch', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await getItem(c.env, userId, id);
  const body = await readJson(watchSchema, c);

  let rating: { rating: number | null; method: string | null; criteria: Record<string, number> } = {
    rating: row.rating_final === null ? null : Number(row.rating_final),
    method: String(row.rating_method),
    criteria: safeParse(row.criteria),
  };

  if (body.rating) {
    const r = await updateItemRating(c.env, userId, id, body.rating);
    rating = { rating: r.final, method: r.method, criteria: r.criteria };
  }

  const now = Date.now();
  const eventId = crypto.randomUUID();
  const quotes = body.quotes ?? safeParse<Quote[]>(row.quotes, []);
  const notes = body.notes ?? (row.notes as string | null) ?? null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO watch_events (id, user_id, media_item_id, episode_id, watched_at, rating, rating_method,
          criteria, notes, quotes, is_spoiler, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      eventId, userId, id, body.watchedAt, rating.rating, rating.method, JSON.stringify(rating.criteria),
      notes, JSON.stringify(quotes), body.isSpoiler ? 1 : 0, now,
    ),
    c.env.DB.prepare(
      `UPDATE media_items SET watch_date = ?, notes = ?, quotes = ?, is_spoiler = ?, tags = ?,
          status = CASE WHEN status IN ('plan', 'watching') THEN 'completed' ELSE status END,
          updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(
      body.watchedAt, notes, JSON.stringify(quotes), body.isSpoiler !== undefined ? (body.isSpoiler ? 1 : 0) : Number(row.is_spoiler),
      JSON.stringify(body.tags ?? safeParse<string[]>(row.tags, [])), now, id, userId,
    ),
  ]);

  return json(await buildDetail(c, userId, id), 201);
});

library.delete('/:id/watch/:eventId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await getItem(c.env, userId, id);
  await c.env.DB.prepare('DELETE FROM watch_events WHERE id = ? AND user_id = ? AND media_item_id = ?')
    .bind(c.req.param('eventId'), userId, id)
    .run();
  return json(await buildDetail(c, userId, id));
});

// ─────────────────────────────────────────────────────────────
// Episodes
// ─────────────────────────────────────────────────────────────

library.post('/:id/episodes/:episodeId/rating', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const episodeId = c.req.param('episodeId');
  await getItem(c.env, userId, id);
  await getEpisode(c.env, userId, id, episodeId);
  const body = await readJson(ratingSchema, c);
  const r = await updateEpisodeRating(c.env, userId, episodeId, body);
  const now = Date.now();
  if (r.final !== null) {
    await c.env.DB.prepare('UPDATE episodes SET watched = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, episodeId, userId)
      .run();
  }
  return json({ rating: r, episode: rowToEpisode((await c.env.DB.prepare('SELECT * FROM episodes WHERE id = ?').bind(episodeId).first<Record<string, unknown>>())!) });
});

library.post('/:id/episodes/:episodeId/watch', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const episodeId = c.req.param('episodeId');
  await getItem(c.env, userId, id);
  const epRow = await getEpisode(c.env, userId, id, episodeId);
  const body = await readJson(watchSchema, c);

  let rating = {
    rating: epRow.rating_final === null ? null : Number(epRow.rating_final),
    method: String(epRow.rating_method),
    criteria: safeParse<Record<string, number>>(epRow.criteria, {}),
  };
  if (body.rating) {
    const r = await updateEpisodeRating(c.env, userId, episodeId, body.rating);
    rating = { rating: r.final, method: r.method, criteria: r.criteria };
  }

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO watch_events (id, user_id, media_item_id, episode_id, watched_at, rating, rating_method,
          criteria, notes, quotes, is_spoiler, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), userId, id, episodeId, body.watchedAt, rating.rating, rating.method,
      JSON.stringify(rating.criteria), body.notes ?? null, JSON.stringify(body.quotes ?? safeParse<Quote[]>(epRow.quotes, [])),
      body.isSpoiler ? 1 : 0, now,
    ),
    c.env.DB.prepare(
      `UPDATE episodes SET watched = 1, watch_date = ?, notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ? AND user_id = ?`,
    ).bind(body.watchedAt, body.notes ?? null, now, episodeId, userId),
  ]);

  return json(await buildDetail(c, userId, id), 201);
});

library.patch('/:id/episodes/:episodeId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const episodeId = c.req.param('episodeId');
  await getItem(c.env, userId, id);
  await getEpisode(c.env, userId, id, episodeId);
  const body = await readJson(patchEpisodeSchema, c);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.watched !== undefined) {
    sets.push('watched = ?');
    params.push(body.watched ? 1 : 0);
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?');
    params.push(body.notes);
  }
  if (body.quotes !== undefined) {
    sets.push('quotes = ?');
    params.push(JSON.stringify(body.quotes));
  }
  if (body.isSpoiler !== undefined) {
    sets.push('is_spoiler = ?');
    params.push(body.isSpoiler ? 1 : 0);
  }
  if (body.tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(body.tags));
  }
  if (body.watchDate !== undefined) {
    sets.push('watch_date = ?');
    params.push(body.watchDate);
  }
  if (sets.length === 0) throw new ApiError(400, 'no_changes', 'هیچ تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?');
  params.push(Date.now(), episodeId, userId);

  await c.env.DB.prepare(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params)
    .run();
  return json(await buildDetail(c, userId, id));
});

// ─────────────────────────────────────────────────────────────
// Refresh structure from TMDB
// ─────────────────────────────────────────────────────────────

library.post('/:id/refresh', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await getItem(c.env, userId, id);
  if (row.source !== 'tmdb' || row.kind !== 'series' || !row.tmdb_id) {
    throw new ApiError(400, 'not_refreshable', 'فقط ساختار سریال‌های واردشده از TMDB قابل به‌روزرسانی است.');
  }
  const index = await libraryIndex(c.env, userId);
  const detail = await getSeriesDetailMapped(c.env, Number(row.tmdb_id), index);
  await syncSeriesStructure(c.env, userId, id, Number(row.tmdb_id), detail.seasons);
  await c.env.DB.prepare('UPDATE media_items SET updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(Date.now(), id, userId)
    .run();
  return json(await buildDetail(c, userId, id));
});

// ─────────────────────────────────────────────────────────────
// TMDB browse helpers
// ─────────────────────────────────────────────────────────────

function safeParse<T>(raw: unknown, fallback?: T): T {
  if (fallback !== undefined && (raw === null || raw === undefined)) return fallback;
  try {
    return JSON.parse(String(raw ?? '{}')) as T;
  } catch {
    return (fallback ?? {}) as T;
  }
}

export default library;
