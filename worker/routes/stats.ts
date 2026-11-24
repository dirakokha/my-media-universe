import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { json } from '../lib/http';
import { requireVerifiedUser } from '../auth/service';
import type { StatsOverview, StatsPayload, WatchStatus } from '../../src/shared/types';
import { averageOf, roundRating } from '../../src/shared/ratings';
import { WATCH_STATUSES } from '../../src/shared/constants';
import {
  currentJalaliYear,
  gregorianToJalali,
  jalaliMonthKey,
  jalaliMonthRange,
  jalaliYearOf,
  jalaliYearRange,
  recentJalaliMonths,
} from '../../src/shared/jalali';

const stats = new Hono<AppEnv>();
stats.use('*', requireVerifiedUser);

interface ItemRow {
  id: string;
  kind: 'movie' | 'series';
  is_anime: number;
  status: string;
  title: string;
  rating_final: number | null;
  final_series_rating: number | null;
  runtime_minutes: number | null;
  genres: string;
  director: string | null;
  cast_list: string;
  poster_path: string | null;
}

interface EventRow {
  watched_at: string;
  media_item_id: string;
  episode_id: string | null;
  runtime_minutes: number | null;
}

interface EpisodeRow {
  media_item_id: string;
  rating_final: number;
  season_number: number;
  episode_number: number;
  runtime_minutes: number | null;
}

function parseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

stats.get('/', async (c) => {
  const userId = c.get('userId');
  const rangeParam = c.req.query('range') ?? 'all';
  const fromQ = c.req.query('from');
  const toQ = c.req.query('to');

  let from: string | null = null;
  let to: string | null = null;
  let label = 'همه‌ی زمان‌ها';

  if (rangeParam === 'year') {
    const jy = currentJalaliYear();
    ({ from, to } = jalaliYearRange(jy));
    label = `سال ${jy}`;
  } else if (rangeParam === 'month') {
    const now = new Date();
    const j = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    ({ from, to } = jalaliMonthRange(j.jy, j.jm));
    label = 'این ماه';
  } else if (rangeParam === 'custom' && fromQ && toQ) {
    from = fromQ;
    to = toQ;
    label = 'بازه‌ی دلخواه';
  }

  const dateClause = from && to ? 'AND watched_at BETWEEN ? AND ?' : '';
  const dateParams = from && to ? [from, to] : [];

  const [itemRows, eventRows, episodeRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, kind, is_anime, status, title, rating_final, final_series_rating, runtime_minutes,
              genres, director, cast_list, poster_path
         FROM media_items WHERE user_id = ? AND removed_at IS NULL`,
    )
      .bind(userId)
      .all<ItemRow>(),
    c.env.DB.prepare(
      `SELECT w.watched_at, w.media_item_id, w.episode_id,
              COALESCE(e.runtime_minutes, m.runtime_minutes) AS runtime_minutes
         FROM watch_events w
         JOIN media_items m ON m.id = w.media_item_id AND m.removed_at IS NULL
         LEFT JOIN episodes e ON e.id = w.episode_id
        WHERE w.user_id = ? ${dateClause}
        ORDER BY w.watched_at ASC`,
    )
      .bind(userId, ...dateParams)
      .all<EventRow>(),
    c.env.DB.prepare(
      `SELECT e.media_item_id, e.rating_final, e.season_number, e.episode_number, e.runtime_minutes
         FROM episodes e
         JOIN media_items m ON m.id = e.media_item_id AND m.removed_at IS NULL
        WHERE e.user_id = ? AND e.rating_final IS NOT NULL`,
    )
      .bind(userId)
      .all<EpisodeRow>(),
  ]);

  const items = itemRows.results ?? [];
  const events = eventRows.results ?? [];
  const ratedEpisodes = episodeRows.results ?? [];

  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemsWithEvents = new Set(events.map((e) => e.media_item_id));

  // ── Overview ────────────────────────────────────────────────
  const totalWatchTimeMinutes = events.reduce((sum, e) => {
    const runtime = Number(e.runtime_minutes);
    return Number.isFinite(runtime) && runtime > 0 ? sum + runtime : sum;
  }, 0);

  const ratedItems = items.filter((i) => i.rating_final !== null);
  const averageRating = averageOf(ratedItems.map((i) => i.rating_final));

  const isMovie = (i: ItemRow) => i.kind === 'movie' && i.is_anime !== 1;
  const isSeries = (i: ItemRow) => i.kind === 'series' && i.is_anime !== 1;
  const isAnime = (i: ItemRow) => i.is_anime === 1;

  const overview: StatsOverview = {
    moviesWatched: items.filter((i) => isMovie(i) && itemsWithEvents.has(i.id)).length,
    seriesWatched: items.filter((i) => isSeries(i) && itemsWithEvents.has(i.id)).length,
    animeWatched: items.filter((i) => isAnime(i) && itemsWithEvents.has(i.id)).length,
    totalWatchTimeMinutes: roundRating(totalWatchTimeMinutes),
    averageRating,
    completedSeries: items.filter((i) => isSeries(i) && i.status === 'completed').length,
    ratedEpisodes: ratedEpisodes.length,
    totalItems: items.length,
    totalWatchEvents: events.length,
  };

  // ── Extremes ────────────────────────────────────────────────
  const extremes = (order: 'desc' | 'asc') =>
    ratedItems
      .filter((i) => i.rating_final !== null)
      .sort((a, b) => (order === 'desc' ? b.rating_final! - a.rating_final! : a.rating_final! - b.rating_final!))
      .slice(0, 6)
      .map((i) => ({
        id: i.id,
        title: i.title,
        rating: i.rating_final!,
        posterPath: i.poster_path,
        kind: i.kind,
      }));

  // ── Genres ──────────────────────────────────────────────────
  const genreCounts = new Map<string, number>();
  for (const i of items) {
    const genres = parseArray<{ name: string }>(i.genres);
    for (const g of genres) {
      if (!g?.name) continue;
      genreCounts.set(g.name, (genreCounts.get(g.name) ?? 0) + 1);
    }
  }
  const genreDistribution = [...genreCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // ── Monthly / yearly activity (Jalali) ──────────────────────
  const monthCounts = new Map<string, { count: number; minutes: number }>();
  const yearCounts = new Map<number, { count: number; minutes: number }>();
  for (const e of events) {
    const key = jalaliMonthKey(e.watched_at);
    const jy = jalaliYearOf(e.watched_at);
    const runtime = Number(e.runtime_minutes) > 0 ? Number(e.runtime_minutes) : 0;
    if (key) {
      const cur = monthCounts.get(key) ?? { count: 0, minutes: 0 };
      cur.count += 1;
      cur.minutes += runtime;
      monthCounts.set(key, cur);
    }
    if (jy) {
      const cur = yearCounts.get(jy) ?? { count: 0, minutes: 0 };
      cur.count += 1;
      cur.minutes += runtime;
      yearCounts.set(jy, cur);
    }
  }

  const monthKeys = recentJalaliMonths(12);
  const monthlyActivity = monthKeys.map((key) => ({
    key,
    label: key,
    count: monthCounts.get(key)?.count ?? 0,
    minutes: monthCounts.get(key)?.minutes ?? 0,
  }));
  const yearlyActivity = [...yearCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({ year, count: v.count, minutes: v.minutes }));
  const mostActiveMonths = [...monthCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([key, v]) => ({ key, label: key, count: v.count }));

  // ── Rating distribution (10 one-point buckets) ──────────────
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${i}–${i + 1}`,
    count: 0,
  }));
  for (const i of ratedItems) {
    const idx = Math.min(9, Math.floor(i.rating_final!));
    buckets[idx].count += 1;
  }
  const ratingDistribution = buckets;

  // ── Directors & actors ──────────────────────────────────────
  const directorMap = new Map<string, { count: number; ratings: number[] }>();
  const actorMap = new Map<string, { count: number; ratings: number[] }>();
  for (const i of items) {
    if (i.director) {
      for (const name of i.director.split('،').map((s) => s.trim()).filter(Boolean)) {
        const cur = directorMap.get(name) ?? { count: 0, ratings: [] };
        cur.count += 1;
        if (i.rating_final !== null) cur.ratings.push(i.rating_final);
        directorMap.set(name, cur);
      }
    }
    for (const person of parseArray<{ name: string }>(i.cast_list)) {
      if (!person?.name) continue;
      const cur = actorMap.get(person.name) ?? { count: 0, ratings: [] };
      cur.count += 1;
      if (i.rating_final !== null) cur.ratings.push(i.rating_final);
      actorMap.set(person.name, cur);
    }
  }
  const toStats = (map: Map<string, { count: number; ratings: number[] }>, limit: number) =>
    [...map.entries()]
      .map(([name, v]) => ({ name, count: v.count, average: averageOf(v.ratings) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

  // ── Status breakdown ────────────────────────────────────────
  const statusBreakdown = WATCH_STATUSES.map((status) => ({
    status: status as WatchStatus,
    count: items.filter((i) => i.status === status).length,
  }));

  const payload: StatsPayload = {
    range: { from, to, label },
    overview,
    highestRated: extremes('desc'),
    lowestRated: extremes('asc'),
    genreDistribution,
    monthlyActivity,
    yearlyActivity,
    ratingDistribution,
    mostActiveMonths,
    directorStats: toStats(directorMap, 10),
    actorStats: toStats(actorMap, 10),
    statusBreakdown,
  };
  void itemById;
  return json(payload);
});

export default stats;
