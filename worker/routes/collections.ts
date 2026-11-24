import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, json, readJson } from '../lib/http';
import { rowToCategory, rowToList, rowToMediaItem } from '../lib/mappers';
import { requireVerifiedUser } from '../auth/service';
import type { MediaItem } from '../../src/shared/types';

const collections = new Hono<AppEnv>();
collections.use('*', requireVerifiedUser);

// ─────────────────────────────────────────────────────────────
// Categories — a media item can belong to many categories
// ─────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
});

const categoryPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

collections.get('/categories', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT cat.*, (SELECT COUNT(*) FROM category_items ci WHERE ci.category_id = cat.id) AS item_count
       FROM categories cat WHERE cat.user_id = ? ORDER BY cat.sort_order, cat.created_at`,
  )
    .bind(c.get('userId'))
    .all<Record<string, unknown>>();
  return json({ categories: (rows.results ?? []).map(rowToCategory) });
});

collections.post('/categories', async (c) => {
  const body = await readJson(categorySchema, c);
  const userId = c.get('userId');
  const clash = await c.env.DB.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
    .bind(userId, body.name)
    .first();
  if (clash) throw new ApiError(409, 'duplicate_category', 'دسته‌ای با این نام از قبل وجود دارد.');

  const id = crypto.randomUUID();
  const now = Date.now();
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE user_id = ?')
    .bind(userId)
    .first<{ m: number }>();
  await c.env.DB.prepare(
    'INSERT INTO categories (id, user_id, name, color, icon, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, body.name, body.color ?? null, body.icon ?? null, Number(max?.m ?? 0) + 1, now, now)
    .run();
  const row = await c.env.DB.prepare(
    'SELECT cat.*, 0 AS item_count FROM categories cat WHERE cat.id = ?',
  ).bind(id).first();
  return json({ category: rowToCategory(row!) }, 201);
});

collections.patch('/categories/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await readJson(categoryPatchSchema, c);
  const existing = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  if (!existing) throw new ApiError(404, 'not_found', 'این دسته پیدا نشد.');

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) {
    const clash = await c.env.DB.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? AND id <> ?')
      .bind(userId, body.name, id)
      .first();
    if (clash) throw new ApiError(409, 'duplicate_category', 'دسته‌ای با این نام از قبل وجود دارد.');
    sets.push('name = ?');
    params.push(body.name);
  }
  if (body.color !== undefined) {
    sets.push('color = ?');
    params.push(body.color);
  }
  if (body.icon !== undefined) {
    sets.push('icon = ?');
    params.push(body.icon);
  }
  if (body.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    params.push(body.sortOrder);
  }
  if (sets.length === 0) throw new ApiError(400, 'no_changes', 'هیچ تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?');
  params.push(Date.now(), id, userId);
  await c.env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params)
    .run();
  const row = await c.env.DB.prepare(
    'SELECT cat.*, (SELECT COUNT(*) FROM category_items ci WHERE ci.category_id = cat.id) AS item_count FROM categories cat WHERE cat.id = ?',
  ).bind(id).first();
  return json({ category: rowToCategory(row!) });
});

collections.delete('/categories/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, 'not_found', 'این دسته پیدا نشد.');
  return json({ ok: true });
});

collections.post('/categories/:id/items', async (c) => {
  const userId = c.get('userId');
  const categoryId = c.req.param('id');
  const { mediaItemId } = await readJson(z.object({ mediaItemId: z.string().min(1) }), c);

  const [cat, item] = await Promise.all([
    c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(categoryId, userId).first(),
    c.env.DB.prepare('SELECT id FROM media_items WHERE id = ? AND user_id = ? AND removed_at IS NULL')
      .bind(mediaItemId, userId)
      .first(),
  ]);
  if (!cat) throw new ApiError(404, 'category_not_found', 'این دسته پیدا نشد.');
  if (!item) throw new ApiError(404, 'item_not_found', 'این اثر در کتابخانه شما پیدا نشد.');

  await c.env.DB.prepare(
    'INSERT INTO category_items (category_id, media_item_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  )
    .bind(categoryId, mediaItemId, Date.now())
    .run();
  return json({ ok: true }, 201);
});

collections.delete('/categories/:id/items/:mediaItemId', async (c) => {
  await c.env.DB.prepare('DELETE FROM category_items WHERE category_id = ? AND media_item_id = ?')
    .bind(c.req.param('id'), c.req.param('mediaItemId'))
    .run();
  return json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Personal lists — ordered collections, one item may live in many lists
// ─────────────────────────────────────────────────────────────

const listSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  sortMode: z.enum(['manual', 'rating', 'date', 'title']).optional(),
});

const listPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  sortMode: z.enum(['manual', 'rating', 'date', 'title']).optional(),
});

async function listRows(c: { env: AppEnv['Bindings']; get: (k: string) => string }) {
  const rows = await c.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id) AS item_count
       FROM lists l WHERE l.user_id = ? AND l.is_watchlist = 0 ORDER BY l.created_at DESC`,
  )
    .bind(c.get('userId'))
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToList);
}

async function getWatchlist(c: {
  env: AppEnv['Bindings'];
  get: (k: string) => string;
}): Promise<{ id: string }> {
  const userId = c.get('userId');
  const existing = await c.env.DB.prepare('SELECT id FROM lists WHERE user_id = ? AND is_watchlist = 1')
    .bind(userId)
    .first<{ id: string }>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO lists (id, user_id, name, description, sort_mode, is_watchlist, created_at, updated_at)
     VALUES (?, ?, 'فهرست تماشا', 'چیزهایی که می‌خواهم تماشا کنم', 'manual', 1, ?, ?)`,
  )
    .bind(id, userId, now, now)
    .run();
  return { id };
}

collections.get('/lists', async (c) => {
  const lists = await listRows(c);
  const watchlist = await getWatchlist(c);
  return json({ lists, watchlistId: watchlist.id });
});

collections.post('/lists', async (c) => {
  const userId = c.get('userId');
  const body = await readJson(listSchema, c);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO lists (id, user_id, name, description, sort_mode, is_watchlist, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(id, userId, body.name, body.description ?? null, body.sortMode ?? 'manual', now, now)
    .run();
  const row = await c.env.DB.prepare('SELECT l.*, 0 AS item_count FROM lists l WHERE l.id = ?').bind(id).first();
  return json({ list: rowToList(row!) }, 201);
});

collections.get('/lists/watchlist', async (c) => {
  const watchlist = await getWatchlist(c);
  return json({ id: watchlist.id });
});

collections.get('/lists/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const list = await c.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id) AS item_count
       FROM lists l WHERE l.id = ? AND l.user_id = ?`,
  )
    .bind(id, userId)
    .first<Record<string, unknown>>();
  if (!list) throw new ApiError(404, 'not_found', 'این فهرست پیدا نشد.');

  const meta = rowToList(list);
  const orderSql: Record<string, string> = {
    manual: 'li.position ASC',
    rating: 'm.rating_final DESC NULLS LAST, m.title COLLATE NOCASE ASC',
    date: 'li.added_at DESC',
    title: 'm.title COLLATE NOCASE ASC',
  };
  const rows = await c.env.DB.prepare(
    `SELECT m.*, li.position, li.added_at AS list_added_at,
            (SELECT COUNT(*) FROM watch_events w WHERE w.media_item_id = m.id) AS watch_count
       FROM list_items li
       JOIN media_items m ON m.id = li.media_item_id AND m.removed_at IS NULL
      WHERE li.list_id = ? AND m.user_id = ?
      ORDER BY ${orderSql[meta.sortMode] ?? orderSql.manual}`,
  )
    .bind(id, userId)
    .all<Record<string, unknown>>();

  return json({
    list: meta,
    items: (rows.results ?? []).map((r) => rowToMediaItem(r) as MediaItem),
  });
});

collections.patch('/lists/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await readJson(listPatchSchema, c);
  const existing = await c.env.DB.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ is_watchlist: number }>();
  if (!existing) throw new ApiError(404, 'not_found', 'این فهرست پیدا نشد.');

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    params.push(body.name);
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    params.push(body.description);
  }
  if (body.sortMode !== undefined) {
    sets.push('sort_mode = ?');
    params.push(body.sortMode);
  }
  if (sets.length === 0) throw new ApiError(400, 'no_changes', 'هیچ تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?');
  params.push(Date.now(), id, userId);
  await c.env.DB.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params)
    .run();
  const row = await c.env.DB.prepare(
    'SELECT l.*, (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id) AS item_count FROM lists l WHERE l.id = ?',
  ).bind(id).first();
  return json({ list: rowToList(row!) });
});

collections.delete('/lists/:id', async (c) => {
  const res = await c.env.DB.prepare(
    'DELETE FROM lists WHERE id = ? AND user_id = ? AND is_watchlist = 0',
  )
    .bind(c.req.param('id'), c.get('userId'))
    .run();
  if (res.meta.changes === 0) {
    throw new ApiError(400, 'cannot_delete', 'این فهرست قابل حذف نیست (فهرست تماشای پیش‌فرض یا وجود ندارد).');
  }
  return json({ ok: true });
});

collections.post('/lists/:id/items', async (c) => {
  const userId = c.get('userId');
  const listId = c.req.param('id');
  const { mediaItemId } = await readJson(z.object({ mediaItemId: z.string().min(1) }), c);

  const [list, item] = await Promise.all([
    c.env.DB.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(listId, userId).first(),
    c.env.DB.prepare('SELECT id FROM media_items WHERE id = ? AND user_id = ? AND removed_at IS NULL')
      .bind(mediaItemId, userId)
      .first(),
  ]);
  if (!list) throw new ApiError(404, 'list_not_found', 'این فهرست پیدا نشد.');
  if (!item) throw new ApiError(404, 'item_not_found', 'این اثر در کتابخانه شما پیدا نشد.');

  const maxPos = await c.env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM list_items WHERE list_id = ?')
    .bind(listId)
    .first<{ p: number }>();
  await c.env.DB.prepare(
    'INSERT INTO list_items (list_id, media_item_id, position, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
  )
    .bind(listId, mediaItemId, Number(maxPos?.p ?? 0) + 1, Date.now())
    .run();
  await c.env.DB.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(Date.now(), listId).run();
  return json({ ok: true }, 201);
});

collections.delete('/lists/:id/items/:mediaItemId', async (c) => {
  await c.env.DB.prepare('DELETE FROM list_items WHERE list_id = ? AND media_item_id = ?')
    .bind(c.req.param('id'), c.req.param('mediaItemId'))
    .run();
  await c.env.DB.prepare('UPDATE lists SET updated_at = ? WHERE id = ?')
    .bind(Date.now(), c.req.param('id'))
    .run();
  return json({ ok: true });
});

/** Reorders a list. Items missing from `orderedIds` keep their relative order at the end. */
collections.post('/lists/:id/reorder', async (c) => {
  const userId = c.get('userId');
  const listId = c.req.param('id');
  const { orderedIds } = await readJson(z.object({ orderedIds: z.array(z.string()).min(1).max(2000) }), c);
  const list = await c.env.DB.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first();
  if (!list) throw new ApiError(404, 'not_found', 'این فهرست پیدا نشد.');

  const existing = await c.env.DB.prepare('SELECT media_item_id FROM list_items WHERE list_id = ? ORDER BY position')
    .bind(listId)
    .all<{ media_item_id: string }>();
  const present = new Set((existing.results ?? []).map((r) => r.media_item_id));
  const known = orderedIds.filter((id) => present.has(id));
  const rest = [...present].filter((id) => !known.includes(id));

  const statements = [...known, ...rest].map((mediaItemId, index) =>
    c.env.DB.prepare('UPDATE list_items SET position = ? WHERE list_id = ? AND media_item_id = ?')
      .bind(index + 1, listId, mediaItemId),
  );
  if (statements.length > 0) await c.env.DB.batch(statements);
  return json({ ok: true });
});

export default collections;
