import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { json, readJson } from '../lib/http';
import { requireVerifiedUser } from '../auth/service';
import { applyBackupDocument, buildBackupDocument, validateBackupDocument } from '../services/backup';

const account = new Hono<AppEnv>();
account.use('*', requireVerifiedUser);

/** Full portable JSON export of the user's own data. */
account.get('/export', async (c) => {
  const doc = await buildBackupDocument(c.env, c.get('userId'));
  const body = JSON.stringify(doc, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="my-media-universe-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
});

account.post('/import', async (c) => {
  const userId = c.get('userId');
  const body = await readJson(
    z.object({
      data: z.unknown(),
      mode: z.enum(['merge', 'replace']),
      confirm: z.literal(true),
    }),
    c,
  );

  const { document } = validateBackupDocument(body.data);
  const result = await applyBackupDocument(c.env, userId, document, body.mode);
  return json({ ok: true, mode: body.mode, inserted: result.inserted });
});

/** Deletes every trace of the user's application data. */
account.delete('/', async (c) => {
  const userId = c.get('userId');
  await readJson(z.object({ confirm: z.literal(true) }), c);

  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM media_items WHERE user_id = ?) AS items,
       (SELECT COUNT(*) FROM google_connections WHERE user_id = ?) AS drive`,
  )
    .bind(userId, userId)
    .first<{ items: number; drive: number }>();

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM watch_events WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE user_id = ?)').bind(userId),
    c.env.DB.prepare('DELETE FROM lists WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM category_items WHERE category_id IN (SELECT id FROM categories WHERE user_id = ?)').bind(userId),
    c.env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM episodes WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM seasons WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM media_items WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM backups WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM google_connections WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM email_tokens WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM invitations WHERE created_by = ? AND used_by IS NULL').bind(userId),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);

  return json({
    ok: true,
    deletedItems: Number(counts?.items ?? 0),
    note:
      'حساب شما و داده‌های برنامه حذف شد. فایل‌های پشتیبان قبلی در Google Drive شما باقی می‌مانند و فقط خودتان می‌توانید آن‌ها را حذف کنید.',
  });
});

export default account;
