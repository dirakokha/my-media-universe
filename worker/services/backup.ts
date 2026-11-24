import { z } from 'zod';
import type { Env } from '../env';
import { ApiError } from '../lib/http';
import { SCHEMA_VERSION } from '../../src/shared/constants';
import type { BackupSummary } from '../../src/shared/types';

/**
 * Backup / export document.
 * One schema-versioned JSON format is used for Google Drive backups and for the
 * portable export/import feature, so a file is never tied to a single transport.
 */

export const mediaItemSchema = z
  .object({
    id: z.string().min(1),
    source: z.enum(['tmdb', 'manual']).default('manual'),
    tmdbId: z.number().int().nullable().optional(),
    kind: z.enum(['movie', 'series']),
    isAnime: z.boolean().optional(),
    title: z.string().min(1),
    originalTitle: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    overviewEn: z.string().nullable().optional(),
    posterPath: z.string().nullable().optional(),
    backdropPath: z.string().nullable().optional(),
    customPosterData: z.string().nullable().optional(),
    releaseDate: z.string().nullable().optional(),
    year: z.number().int().nullable().optional(),
    genres: z.array(z.object({ id: z.number().nullable(), name: z.string() }).passthrough()).optional(),
    runtimeMinutes: z.number().int().nullable().optional(),
    country: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    director: z.string().nullable().optional(),
    cast: z.array(z.object({ id: z.number().nullable(), name: z.string() }).passthrough()).optional(),
    status: z.enum(['plan', 'watching', 'completed', 'onhold', 'dropped']).optional(),
    ratingMethod: z.enum(['direct', 'criteria']).optional(),
    ratingDirect: z.number().nullable().optional(),
    criteria: z.record(z.number()).optional(),
    ratingFinal: z.number().nullable().optional(),
    finalSeriesRating: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    quotes: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    isSpoiler: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    watchDate: z.string().nullable().optional(),
    favorite: z.boolean().optional(),
    addedAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })
  .passthrough();

export const episodeSchema = z
  .object({
    id: z.string().min(1),
    mediaItemId: z.string().min(1),
    tmdbEpisodeId: z.number().int().nullable().optional(),
    seasonNumber: z.number().int(),
    episodeNumber: z.number().int(),
    name: z.string().min(1),
    originalName: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    stillPath: z.string().nullable().optional(),
    airDate: z.string().nullable().optional(),
    runtimeMinutes: z.number().int().nullable().optional(),
    watched: z.boolean().optional(),
    ratingMethod: z.enum(['direct', 'criteria']).optional(),
    ratingDirect: z.number().nullable().optional(),
    criteria: z.record(z.number()).optional(),
    ratingFinal: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    quotes: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    tags: z.array(z.string()).optional(),
    isSpoiler: z.boolean().optional(),
    watchDate: z.string().nullable().optional(),
    updatedAt: z.number().optional(),
  })
  .passthrough();

export const backupDocumentSchema = z.object({
  schemaVersion: z.number().int().min(1),
  app: z.string().optional(),
  exportedAt: z.string().optional(),
  user: z.object({ username: z.string().optional(), email: z.string().optional() }).optional(),
  preferences: z
    .object({
      theme: z.enum(['dark', 'light']).optional(),
      language: z.enum(['fa', 'en']).optional(),
      autoBackup: z.boolean().optional(),
    })
    .optional(),
  mediaItems: z.array(mediaItemSchema).max(50_000).default([]),
  seasons: z
    .array(
      z
        .object({
          id: z.string(),
          mediaItemId: z.string(),
          tmdbSeasonId: z.number().int().nullable().optional(),
          seasonNumber: z.number().int(),
          name: z.string().nullable().optional(),
          overview: z.string().nullable().optional(),
          posterPath: z.string().nullable().optional(),
          airDate: z.string().nullable().optional(),
          episodeCount: z.number().int().optional(),
        })
        .passthrough(),
    )
    .max(50_000)
    .default([]),
  episodes: z.array(episodeSchema).max(200_000).default([]),
  watchEvents: z
    .array(
      z
        .object({
          id: z.string(),
          mediaItemId: z.string(),
          episodeId: z.string().nullable().optional(),
          watchedAt: z.string(),
          rating: z.number().nullable().optional(),
          ratingMethod: z.enum(['direct', 'criteria']).nullable().optional(),
          criteria: z.record(z.number()).optional(),
          notes: z.string().nullable().optional(),
          quotes: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
          isSpoiler: z.boolean().optional(),
          createdAt: z.number().optional(),
        })
        .passthrough(),
    )
    .max(200_000)
    .default([]),
  categories: z
    .array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          color: z.string().nullable().optional(),
          icon: z.string().nullable().optional(),
          sortOrder: z.number().optional(),
        })
        .passthrough(),
    )
    .max(5000)
    .default([]),
  categoryItems: z
    .array(z.object({ categoryId: z.string(), mediaItemId: z.string() }).passthrough())
    .max(100_000)
    .default([]),
  lists: z
    .array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable().optional(),
          sortMode: z.enum(['manual', 'rating', 'date', 'title']).optional(),
          isWatchlist: z.boolean().optional(),
        })
        .passthrough(),
    )
    .max(5000)
    .default([]),
  listItems: z
    .array(z.object({ listId: z.string(), mediaItemId: z.string(), position: z.number().optional() }).passthrough())
    .max(100_000)
    .default([]),
}).passthrough(); // unknown top-level keys from newer versions are preserved, not rejected

export type BackupDocument = z.infer<typeof backupDocumentSchema>;

export type { BackupSummary };

export function validateBackupDocument(raw: unknown): { document: BackupDocument; summary: BackupSummary } {
  const parsed = backupDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_backup', 'ساختار فایل پشتیبان معتبر نیست یا نسخه‌ی آن پشتیبانی نمی‌شود.');
  }
  const doc = parsed.data;
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new ApiError(
      400,
      'backup_too_new',
      `این فایل پشتیبان از نسخه‌ی جدیدتر برنامه ساخته شده است (${doc.schemaVersion}).`,
    );
  }

  const mediaTypes = { movie: 0, series: 0, anime: 0 };
  for (const item of doc.mediaItems) {
    if (item.isAnime) mediaTypes.anime += 1;
    else if (item.kind === 'movie') mediaTypes.movie += 1;
    else mediaTypes.series += 1;
  }

  return {
    document: doc,
    summary: {
      schemaVersion: doc.schemaVersion,
      exportedAt: doc.exportedAt ?? null,
      counts: {
        mediaItems: doc.mediaItems.length,
        episodes: doc.episodes.length,
        seasons: doc.seasons.length,
        watchEvents: doc.watchEvents.length,
        categories: doc.categories.length,
        lists: doc.lists.length,
      },
      mediaTypes,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────

export async function buildBackupDocument(env: Env, userId: string): Promise<BackupDocument> {
  const [user, items, seasons, episodes, events, categories, categoryItems, lists, listItems] = await Promise.all([
    env.DB.prepare('SELECT username, email, preferences FROM users WHERE id = ?').bind(userId).first<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM media_items WHERE user_id = ? AND removed_at IS NULL').bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM seasons WHERE user_id = ?').bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM episodes WHERE user_id = ?').bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM watch_events WHERE user_id = ?').bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM categories WHERE user_id = ?').bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT ci.category_id, ci.media_item_id FROM category_items ci
         JOIN categories c ON c.id = ci.category_id WHERE c.user_id = ?`,
    ).bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM lists WHERE user_id = ?').bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT li.list_id, li.media_item_id, li.position FROM list_items li
         JOIN lists l ON l.id = li.list_id WHERE l.user_id = ?`,
    ).bind(userId).all<Record<string, unknown>>(),
  ]);

  const parse = (v: unknown, fallback: unknown) => {
    if (typeof v !== 'string' || v.length === 0) return fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  };
  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

  let preferences: Record<string, unknown> = {};
  try {
    preferences = parse(user?.preferences, {}) as Record<string, unknown>;
  } catch {
    preferences = {};
  }

  const mediaItems = (items.results ?? []).map((r) => ({
    id: String(r.id),
    source: (r.source === 'tmdb' ? 'tmdb' : 'manual') as 'tmdb' | 'manual',
    tmdbId: r.tmdb_id === null ? null : Number(r.tmdb_id),
    kind: (r.kind === 'series' ? 'series' : 'movie') as 'movie' | 'series',
    isAnime: Number(r.is_anime) === 1,
    title: String(r.title),
    originalTitle: str(r.original_title),
    overview: str(r.overview),
    overviewEn: str(r.overview_en),
    posterPath: str(r.poster_path),
    backdropPath: str(r.backdrop_path),
    customPosterData: str(r.custom_poster_data),
    releaseDate: str(r.release_date),
    year: num(r.year),
    genres: parse(r.genres, []),
    runtimeMinutes: num(r.runtime_minutes),
    country: str(r.country),
    language: str(r.language),
    director: str(r.director),
    cast: parse(r.cast_list, []),
    status: r.status as 'plan' | 'watching' | 'completed' | 'onhold' | 'dropped',
    ratingMethod: r.rating_method as 'direct' | 'criteria',
    ratingDirect: num(r.rating_direct),
    criteria: parse(r.criteria, {}),
    ratingFinal: num(r.rating_final),
    finalSeriesRating: num(r.final_series_rating),
    notes: str(r.notes),
    quotes: parse(r.quotes, []),
    isSpoiler: Number(r.is_spoiler) === 1,
    tags: parse(r.tags, []),
    watchDate: str(r.watch_date),
    favorite: Number(r.favorite) === 1,
    addedAt: Number(r.added_at),
    updatedAt: Number(r.updated_at),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'my-media-universe',
    exportedAt: new Date().toISOString(),
    user: { username: String(user?.username ?? ''), email: String(user?.email ?? '') },
    preferences: preferences as BackupDocument['preferences'],
    mediaItems,
    seasons: (seasons.results ?? []).map((r) => ({
      id: String(r.id),
      mediaItemId: String(r.media_item_id),
      tmdbSeasonId: num(r.tmdb_season_id),
      seasonNumber: Number(r.season_number),
      name: str(r.name),
      overview: str(r.overview),
      posterPath: str(r.poster_path),
      airDate: str(r.air_date),
      episodeCount: Number(r.episode_count ?? 0),
    })),
    episodes: (episodes.results ?? []).map((r) => ({
      id: String(r.id),
      mediaItemId: String(r.media_item_id),
      tmdbEpisodeId: num(r.tmdb_episode_id),
      seasonNumber: Number(r.season_number),
      episodeNumber: Number(r.episode_number),
      name: String(r.name),
      originalName: str(r.original_name),
      overview: str(r.overview),
      stillPath: str(r.still_path),
      airDate: str(r.air_date),
      runtimeMinutes: num(r.runtime_minutes),
      watched: Number(r.watched) === 1,
      ratingMethod: r.rating_method as 'direct' | 'criteria',
      ratingDirect: num(r.rating_direct),
      criteria: parse(r.criteria, {}),
      ratingFinal: num(r.rating_final),
      notes: str(r.notes),
      quotes: parse(r.quotes, []),
      tags: parse(r.tags, []),
      isSpoiler: Number(r.is_spoiler) === 1,
      watchDate: str(r.watch_date),
      updatedAt: Number(r.updated_at),
    })),
    watchEvents: (events.results ?? []).map((r) => ({
      id: String(r.id),
      mediaItemId: String(r.media_item_id),
      episodeId: str(r.episode_id),
      watchedAt: String(r.watched_at),
      rating: num(r.rating),
      ratingMethod: (r.rating_method === 'criteria' ? 'criteria' : r.rating_method === 'direct' ? 'direct' : null),
      criteria: parse(r.criteria, {}),
      notes: str(r.notes),
      quotes: parse(r.quotes, []),
      isSpoiler: Number(r.is_spoiler ?? 0) === 1,
      createdAt: Number(r.created_at),
    })),
    categories: (categories.results ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color: str(r.color),
      icon: str(r.icon),
      sortOrder: Number(r.sort_order ?? 0),
    })),
    categoryItems: (categoryItems.results ?? []).map((r) => ({
      categoryId: String(r.category_id),
      mediaItemId: String(r.media_item_id),
    })),
    lists: (lists.results ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: str(r.description),
      sortMode: (['manual', 'rating', 'date', 'title'] as const).includes(r.sort_mode as never)
        ? (r.sort_mode as 'manual' | 'rating' | 'date' | 'title')
        : 'manual',
      isWatchlist: Number(r.is_watchlist) === 1,
    })),
    listItems: (listItems.results ?? []).map((r) => ({
      listId: String(r.list_id),
      mediaItemId: String(r.media_item_id),
      position: Number(r.position),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Restore
// ─────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function clearUserData(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM watch_events WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE user_id = ?)').bind(userId),
    env.DB.prepare('DELETE FROM lists WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM category_items WHERE category_id IN (SELECT id FROM categories WHERE user_id = ?)').bind(userId),
    env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM episodes WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM seasons WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM media_items WHERE user_id = ?').bind(userId),
  ]);
}

/**
 * Writes a validated document into the user's library.
 * `replace` wipes the current library first; `merge` only inserts rows that do not exist yet.
 * Orphans (rows pointing at media items that are absent) are dropped to protect integrity.
 */
export async function applyBackupDocument(
  env: Env,
  userId: string,
  doc: BackupDocument,
  mode: 'merge' | 'replace',
): Promise<{ inserted: number }> {
  if (mode === 'replace') await clearUserData(env, userId);

  const mediaIds = new Set(doc.mediaItems.map((i) => i.id));
  const categoryIds = new Set(doc.categories.map((c) => c.id));
  const listIds = new Set(doc.lists.map((l) => l.id));
  const now = Date.now();
  let inserted = 0;

  const conflict = mode === 'merge' ? 'DO NOTHING' : 'DO NOTHING';

  for (const group of chunk(doc.mediaItems, 100)) {
    const res = await env.DB.batch(
      group.map((m) =>
        env.DB.prepare(
          `INSERT INTO media_items (id, user_id, source, tmdb_id, kind, is_anime, title, original_title, overview,
              overview_en, poster_path, backdrop_path, custom_poster_data, release_date, year, genres,
              runtime_minutes, country, language, director, cast_list, status, rating_method, rating_direct, criteria,
              rating_final, final_series_rating, notes, quotes, is_spoiler, tags, watch_date, favorite,
              added_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) ${conflict}`,
        ).bind(
          m.id, userId, m.source, m.tmdbId ?? null, m.kind, m.isAnime ? 1 : 0, m.title, m.originalTitle ?? null,
          m.overview ?? null, m.overviewEn ?? null, m.posterPath ?? null, m.backdropPath ?? null,
          m.customPosterData ?? null, m.releaseDate ?? null, m.year ?? null, JSON.stringify(m.genres ?? []),
          m.runtimeMinutes ?? null, m.country ?? null, m.language ?? null, m.director ?? null,
          JSON.stringify(m.cast ?? []), m.status ?? 'plan', m.ratingMethod ?? 'direct', m.ratingDirect ?? null,
          JSON.stringify(m.criteria ?? {}), m.ratingFinal ?? null, m.finalSeriesRating ?? null, m.notes ?? null,
          JSON.stringify(m.quotes ?? []), m.isSpoiler ? 1 : 0, JSON.stringify(m.tags ?? []), m.watchDate ?? null,
          m.favorite ? 1 : 0, m.addedAt ?? now, m.updatedAt ?? now,
        ),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  for (const group of chunk(doc.seasons.filter((s) => mediaIds.has(s.mediaItemId)), 200)) {
    const res = await env.DB.batch(
      group.map((s) =>
        env.DB.prepare(
          `INSERT INTO seasons (id, user_id, media_item_id, tmdb_season_id, season_number, name, overview,
              poster_path, air_date, episode_count, added_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          s.id, userId, s.mediaItemId, s.tmdbSeasonId ?? null, s.seasonNumber, s.name ?? null, s.overview ?? null,
          s.posterPath ?? null, s.airDate ?? null, s.episodeCount ?? 0, now, now,
        ),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  for (const group of chunk(doc.episodes.filter((e) => mediaIds.has(e.mediaItemId)), 200)) {
    const res = await env.DB.batch(
      group.map((e) =>
        env.DB.prepare(
          `INSERT INTO episodes (id, user_id, media_item_id, tmdb_episode_id, season_number, episode_number, name,
              original_name, overview, still_path, air_date, runtime_minutes, watched, rating_method, rating_direct,
              criteria, rating_final, notes, quotes, tags, is_spoiler, watch_date, added_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          e.id, userId, e.mediaItemId, e.tmdbEpisodeId ?? null, e.seasonNumber, e.episodeNumber, e.name,
          e.originalName ?? null, e.overview ?? null, e.stillPath ?? null, e.airDate ?? null,
          e.runtimeMinutes ?? null, e.watched ? 1 : 0, e.ratingMethod ?? 'direct', e.ratingDirect ?? null,
          JSON.stringify(e.criteria ?? {}), e.ratingFinal ?? null, e.notes ?? null, JSON.stringify(e.quotes ?? []),
          JSON.stringify(e.tags ?? []), e.isSpoiler ? 1 : 0, e.watchDate ?? null, now, e.updatedAt ?? now,
        ),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  for (const group of chunk(doc.watchEvents.filter((w) => mediaIds.has(w.mediaItemId)), 200)) {
    const res = await env.DB.batch(
      group.map((w) =>
        env.DB.prepare(
          `INSERT INTO watch_events (id, user_id, media_item_id, episode_id, watched_at, rating, rating_method,
              criteria, notes, quotes, is_spoiler, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          w.id, userId, w.mediaItemId, w.episodeId ?? null, w.watchedAt, w.rating ?? null, w.ratingMethod ?? null,
          JSON.stringify(w.criteria ?? {}), w.notes ?? null, JSON.stringify(w.quotes ?? []), w.isSpoiler ? 1 : 0,
          w.createdAt ?? now,
        ),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  for (const group of chunk(doc.categories, 200)) {
    const res = await env.DB.batch(
      group.map((cat) =>
        env.DB.prepare(
          `INSERT INTO categories (id, user_id, name, color, icon, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        ).bind(cat.id, userId, cat.name, cat.color ?? null, cat.icon ?? null, cat.sortOrder ?? 0, now, now),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  const validCategoryItems = doc.categoryItems.filter((ci) => categoryIds.has(ci.categoryId) && mediaIds.has(ci.mediaItemId));
  for (const group of chunk(validCategoryItems, 200)) {
    const res = await env.DB.batch(
      group.map((ci) =>
        env.DB.prepare(
          'INSERT INTO category_items (category_id, media_item_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        ).bind(ci.categoryId, ci.mediaItemId, now),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  for (const group of chunk(doc.lists, 200)) {
    const res = await env.DB.batch(
      group.map((l) =>
        env.DB.prepare(
          `INSERT INTO lists (id, user_id, name, description, sort_mode, is_watchlist, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        ).bind(
          l.id, userId, l.name, l.description ?? null, l.sortMode ?? 'manual', l.isWatchlist ? 1 : 0, now, now,
        ),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  const validListItems = doc.listItems.filter((li) => listIds.has(li.listId) && mediaIds.has(li.mediaItemId));
  for (const group of chunk(validListItems, 200)) {
    const res = await env.DB.batch(
      group.map((li) =>
        env.DB.prepare(
          'INSERT INTO list_items (list_id, media_item_id, position, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        ).bind(li.listId, li.mediaItemId, li.position ?? 0, now),
      ),
    );
    inserted += res.reduce((sum, r) => sum + Number(r.meta.changes ?? 0), 0);
  }

  return { inserted };
}
