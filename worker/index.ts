import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Env } from './env';
import { assertSameOrigin, handleError, securityHeaders } from './lib/http';
import authRoutes from './auth/routes';
import adminRoutes from './routes/admin';
import libraryRoutes from './routes/library';
import collectionsRoutes from './routes/collections';
import statsRoutes from './routes/stats';
import tmdbRoutes from './routes/tmdb';
import backupRoutes from './routes/backup';
import accountRoutes from './routes/account';
import { authenticate } from './auth/service';
import { buildBackupDocument } from './services/backup';
import { ensureFolder, getConnection, uploadBackup } from './services/drive';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(securityHeaders(c.env))) c.header(key, value);
});

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
  assertSameOrigin(c);
  await next();
});

app.onError((err, c) => handleError(err, c.env.ENV !== 'production'));

// ─────────────────────────────────────────────────────────────
// Idempotency for the offline write queue.
// Queued mutations are replayed with a stable Idempotency-Key; replaying an
// already-applied operation returns the original response instead of duplicating it.
// ─────────────────────────────────────────────────────────────
const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const key = c.req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128) return next();

  const auth = await authenticate(c);
  if (!auth) return next();

  const existing = await c.env.DB.prepare(
    'SELECT status_code, response FROM sync_ops WHERE user_id = ? AND op_id = ?',
  )
    .bind(auth.userId, key)
    .first<{ status_code: number; response: string | null }>();

  if (existing) {
    return new Response(existing.response ?? '{"ok":true}', {
      status: Number(existing.status_code),
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'idempotent-replay': 'true',
      },
    });
  }

  await next();

  const res = c.res;
  if (res.status < 500) {
    try {
      const text = await res.clone().text();
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO sync_ops (user_id, op_id, method, path, status_code, response, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(auth.userId, key, method, c.req.path, res.status, text.slice(0, 60_000), Date.now())
        .run();
      // Opportunistic cleanup so the table does not grow forever.
      if (Math.random() < 0.01) {
        c.env.DB.prepare('DELETE FROM sync_ops WHERE created_at < ?')
          .bind(Date.now() - 7 * 86_400_000)
          .run()
          .catch(() => undefined);
      }
    } catch {
      /* bookkeeping must never break the request */
    }
  }
});

app.use('/api/*', idempotency);

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/library', libraryRoutes);
app.route('/api/collections', collectionsRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/tmdb', tmdbRoutes);
app.route('/api/backup', backupRoutes);
app.route('/api/account', accountRoutes);

app.get('/api/health', (c) =>
  c.json({ ok: true, service: c.env.APP_NAME ?? 'My Media Universe', time: new Date().toISOString() }),
);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return new Response(
      JSON.stringify({ error: { code: 'not_found', message: 'این مسیر در API وجود ندارد.' } }),
      { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
  return c.text('Not found', 404);
});

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  /**
   * Daily cron: creates an automatic Google Drive backup for every user who opted in.
   * Cron triggers are included in Cloudflare's free plan.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runAutomaticBackups(env));
  },
} satisfies ExportedHandler<Env>;

async function runAutomaticBackups(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT u.id FROM users u
       JOIN google_connections g ON g.user_id = u.id
      WHERE u.disabled_at IS NULL AND u.preferences LIKE '%"autoBackup":true%'`,
  ).all<{ id: string }>();

  for (const row of rows.results ?? []) {
    try {
      const conn = await getConnection(env, row.id);
      if (!conn) continue;
      const doc = await buildBackupDocument(env, row.id);
      const folderId = await ensureFolder(env, row.id);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `mmu-auto-${stamp}.json`;
      const uploaded = await uploadBackup(env, row.id, name, JSON.stringify(doc), folderId);
      await env.DB.prepare(
        `INSERT INTO backups (id, user_id, drive_file_id, name, size_bytes, schema_version, item_count, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', ?)`,
      )
        .bind(
          crypto.randomUUID(), row.id, uploaded.fileId, name, uploaded.sizeBytes,
          doc.schemaVersion, doc.mediaItems.length, Date.now(),
        )
        .run();

      const all = await env.DB.prepare(
        'SELECT id, drive_file_id FROM backups WHERE user_id = ? ORDER BY created_at DESC',
      )
        .bind(row.id)
        .all<{ id: string; drive_file_id: string }>();
      for (const stale of (all.results ?? []).slice(25)) {
        await env.DB.prepare('DELETE FROM backups WHERE id = ?').bind(stale.id).run();
      }
    } catch (err) {
      console.error('Automatic backup failed', row.id, err);
    }
  }
}
