import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, json, readJson } from '../lib/http';
import { requireVerifiedUser } from '../auth/service';
import {
  createAuthorizationUrl,
  consumeOAuthState,
  deleteDriveFile,
  disconnect,
  downloadFile,
  ensureFolder,
  exchangeCode,
  getConnection,
  getGoogleEmail,
  saveConnection,
  uploadBackup,
} from '../services/drive';
import { applyBackupDocument, buildBackupDocument, validateBackupDocument } from '../services/backup';
import type { BackupFile, DriveStatus } from '../../src/shared/types';

const backup = new Hono<AppEnv>();
// The OAuth callback arrives as a top-level redirect from Google; the user is resolved
// from the (hashed, single-use) state token instead of the session, so it is exempt.
backup.use('*', async (c, next) => {
  if (c.req.path === '/api/backup/google/callback') return next();
  return requireVerifiedUser(c, next);
});

const MAX_BACKUPS = 25;

async function driveStatus(c: {
  env: AppEnv['Bindings'];
  get: (k: string) => string;
}): Promise<DriveStatus> {
  const conn = await getConnection(c.env, c.get('userId'));
  return {
    connected: Boolean(conn),
    googleEmail: conn?.google_email ?? null,
    connectedAt: conn?.created_at ?? null,
    autoBackup: false,
    configured: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    folderName: c.env.GOOGLE_DRIVE_FOLDER_NAME ?? 'My Media Universe',
  };
}

// ─────────────────────────────────────────────────────────────
// Google Drive connection
// ─────────────────────────────────────────────────────────────

backup.get('/google/status', async (c) => {
  const status = await driveStatus(c);
  const user = await c.env.DB.prepare('SELECT preferences FROM users WHERE id = ?').bind(c.get('userId')).first<{ preferences: string }>();
  try {
    const prefs = JSON.parse(user?.preferences ?? '{}');
    status.autoBackup = Boolean(prefs.autoBackup);
  } catch {
    status.autoBackup = false;
  }
  return json(status);
});

backup.post('/google/connect', async (c) => {
  const { url } = await createAuthorizationUrl(c.env, c.get('userId'), c.req.url);
  return json({ url });
});

backup.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const base = (c.env.APP_BASE_URL ?? new URL(c.req.url).origin).replace(/\/$/, '');

  if (error || !code || !state) {
    return c.redirect(`${base}/settings?google=error&reason=${encodeURIComponent(error ?? 'missing')}`);
  }
  const consumed = await consumeOAuthState(c.env, state);
  if (!consumed) {
    return c.redirect(`${base}/settings?google=error&reason=state`);
  }

  try {
    const tokens = await exchangeCode(c.env, code, consumed.verifier, c.req.url);
    const email = await getGoogleEmail(c.env, consumed.userId).catch(() => null);
    const folderId = await ensureFolder(c.env, consumed.userId).catch(() => null);
    await saveConnection(c.env, consumed.userId, tokens, email, folderId);
    return c.redirect(`${base}/settings?google=connected`);
  } catch (err) {
    console.error('Google OAuth callback failed', err);
    const reason = err instanceof ApiError ? err.code : 'unknown';
    return c.redirect(`${base}/settings?google=error&reason=${encodeURIComponent(reason)}`);
  }
});

backup.post('/google/disconnect', async (c) => {
  await disconnect(c.env, c.get('userId'));
  return json({ ok: true });
});

backup.post('/auto', async (c) => {
  const { enabled } = await readJson(z.object({ enabled: z.boolean() }), c);
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT preferences FROM users WHERE id = ?').bind(userId).first<{ preferences: string }>();
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(row?.preferences ?? '{}');
  } catch {
    prefs = {};
  }
  prefs.autoBackup = enabled;
  await c.env.DB.prepare('UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(prefs), Date.now(), userId)
    .run();
  return json({ ok: true, autoBackup: enabled });
});

// ─────────────────────────────────────────────────────────────
// Backup / restore
// ─────────────────────────────────────────────────────────────

backup.post('/create', async (c) => {
  const userId = c.get('userId');
  const conn = await getConnection(c.env, userId);
  if (!conn) throw new ApiError(400, 'google_not_connected', 'برای ساخت پشتیبان، ابتدا Google Drive را متصل کنید.');

  const doc = await buildBackupDocument(c.env, userId);
  const content = JSON.stringify(doc);
  const folderId = await ensureFolder(c.env, userId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `mmu-backup-${stamp}.json`;
  const uploaded = await uploadBackup(c.env, userId, name, content, folderId);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO backups (id, user_id, drive_file_id, name, size_bytes, schema_version, item_count, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
  )
    .bind(id, userId, uploaded.fileId, name, uploaded.sizeBytes, doc.schemaVersion, doc.mediaItems.length, Date.now())
    .run();

  // Keep only the newest MAX_BACKUPS backups.
  const all = await c.env.DB.prepare(
    'SELECT id, drive_file_id FROM backups WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(userId)
    .all<{ id: string; drive_file_id: string }>();
  const stale = (all.results ?? []).slice(MAX_BACKUPS);
  for (const s of stale) {
    await deleteDriveFile(c.env, userId, s.drive_file_id).catch(() => undefined);
    await c.env.DB.prepare('DELETE FROM backups WHERE id = ?').bind(s.id).run();
  }

  return json({ ok: true, backupId: id, sizeBytes: uploaded.sizeBytes, itemCount: doc.mediaItems.length }, 201);
});

backup.get('/list', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, drive_file_id, name, size_bytes, schema_version, item_count, kind, created_at
       FROM backups WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.get('userId'))
    .all<Record<string, unknown>>();
  const files: BackupFile[] = (rows.results ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    sizeBytes: Number(r.size_bytes),
    schemaVersion: Number(r.schema_version),
    itemCount: Number(r.item_count),
    kind: r.kind === 'auto' ? 'auto' : 'manual',
    createdAt: Number(r.created_at),
  }));
  return json({ backups: files });
});

backup.get('/:id/preview', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM backups WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'not_found', 'این پشتیبان پیدا نشد.');
  const content = await downloadFile(c.env, c.get('userId'), String(row.drive_file_id));
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ApiError(400, 'invalid_backup', 'محتوای فایل پشتیبان معتبر نیست.');
  }
  const { document, summary } = validateBackupDocument(parsed);
  return json({
    summary,
    sample: document.mediaItems.slice(0, 12).map((m) => ({ title: m.title, kind: m.kind, isAnime: m.isAnime })),
  });
});

backup.post('/:id/restore', async (c) => {
  const userId = c.get('userId');
  const { mode } = await readJson(z.object({ mode: z.enum(['merge', 'replace']), confirm: z.literal(true) }), c);
  const row = await c.env.DB.prepare('SELECT * FROM backups WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'not_found', 'این پشتیبان پیدا نشد.');

  const content = await downloadFile(c.env, userId, String(row.drive_file_id));
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ApiError(400, 'invalid_backup', 'محتوای فایل پشتیبان معتبر نیست.');
  }
  const { document } = validateBackupDocument(parsed);
  const result = await applyBackupDocument(c.env, userId, document, mode);
  return json({ ok: true, mode, inserted: result.inserted });
});

backup.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT drive_file_id FROM backups WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first<{ drive_file_id: string }>();
  if (!row) throw new ApiError(404, 'not_found', 'این پشتیبان پیدا نشد.');
  await deleteDriveFile(c.env, userId, row.drive_file_id).catch(() => undefined);
  await c.env.DB.prepare('DELETE FROM backups WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .run();
  return json({ ok: true });
});

/** Validates an uploaded JSON file so the user can preview it before restoring. */
backup.post('/validate', async (c) => {
  const { data } = await readJson(z.object({ data: z.unknown() }), c);
  const { summary } = validateBackupDocument(data);
  return json({ summary });
});

export default backup;
