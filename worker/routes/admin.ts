import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, json, readJson } from '../lib/http';
import { requireAdmin } from '../auth/service';
import { sha256Hex } from '../lib/crypto';

const admin = new Hono<AppEnv>();
admin.use('*', requireAdmin);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Invitation codes are high-entropy, grouped for readability and stored only as a hash. */
function generateInvitationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `MMU-${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}-${chars.slice(10, 15).join('')}`;
}

const createSchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).optional(),
  emailHint: z.string().trim().email('نشانی ایمیل معتبر نیست').optional(),
  maxUses: z.number().int().min(1).max(10).optional(),
  note: z.string().trim().max(200).optional(),
});

admin.get('/invitations', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.code_hint, i.email_hint, i.max_uses, i.use_count, i.note, i.expires_at, i.revoked_at,
            i.used_at, i.created_at, u.username AS used_by_username
       FROM invitations i LEFT JOIN users u ON u.id = i.used_by
      ORDER BY i.created_at DESC`,
  ).all<Record<string, unknown>>();

  return json({
    invitations: (rows.results ?? []).map((r) => ({
      id: String(r.id),
      codeHint: String(r.code_hint),
      emailHint: r.email_hint ?? null,
      maxUses: Number(r.max_uses),
      useCount: Number(r.use_count),
      note: r.note ?? null,
      expiresAt: r.expires_at === null ? null : Number(r.expires_at),
      revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
      usedAt: r.used_at === null ? null : Number(r.used_at),
      usedByUsername: r.used_by_username ?? null,
      createdAt: Number(r.created_at),
    })),
  });
});

admin.post('/invitations', async (c) => {
  const body = await readJson(createSchema, c);
  const code = generateInvitationCode();
  const codeHash = await sha256Hex(`invite:${code}`);
  const now = Date.now();
  const expiresAt = body.expiresInDays ? now + body.expiresInDays * 86_400_000 : null;

  await c.env.DB.prepare(
    `INSERT INTO invitations (id, code_hash, code_hint, created_by, email_hint, max_uses, use_count, note,
        expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(), codeHash, code.slice(0, 10), c.get('userId'), body.emailHint ?? null,
      body.maxUses ?? 1, body.note ?? null, expiresAt, now,
    )
    .run();

  // The plaintext code is returned exactly once — only its hash is stored.
  return json({ invitation: { code, expiresAt, maxUses: body.maxUses ?? 1 } }, 201);
});

admin.post('/invitations/:id/revoke', async (c) => {
  const res = await c.env.DB.prepare(
    'UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND use_count < max_uses',
  )
    .bind(Date.now(), c.req.param('id'))
    .run();
  if (res.meta.changes === 0) {
    throw new ApiError(400, 'cannot_revoke', 'این کد دعوت قابل باطل کردن نیست (قبلاً استفاده یا باطل شده است).');
  }
  return json({ ok: true });
});

admin.delete('/invitations/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM invitations WHERE id = ?').bind(c.req.param('id')).run();
  if (res.meta.changes === 0) throw new ApiError(404, 'not_found', 'این کد دعوت پیدا نشد.');
  return json({ ok: true });
});

admin.get('/overview', async (c) => {
  const [users, items, events, invites] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NULL').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM media_items WHERE removed_at IS NULL').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM watch_events').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM invitations WHERE revoked_at IS NULL AND use_count < max_uses').first<{ n: number }>(),
  ]);
  return json({
    users: Number(users?.n ?? 0),
    mediaItems: Number(items?.n ?? 0),
    watchEvents: Number(events?.n ?? 0),
    activeInvitations: Number(invites?.n ?? 0),
  });
});

export default admin;
