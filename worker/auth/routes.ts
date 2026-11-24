import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, json, readJson } from '../lib/http';
import { sendEmail, escapeHtml } from '../lib/mailer';
import { rowToUser } from '../lib/mappers';
import { DEFAULT_PREFERENCES } from '../lib/constants';
import {
  attachSessionCookie,
  authenticate,
  clearSessionCookieValue,
  createSession,
  enforceLimit,
  requireUser,
  requireVerifiedUser,
  revokeAllSessions,
  sessionCookieValue,
} from './service';
import { constantTimeEqual, hashToken, normalizeEmail, normalizeUsername, randomToken, sha256Hex } from '../lib/crypto';

const auth = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,32}$/u;
const SALT_RE = /^[A-Za-z0-9_-]{20,32}$/;
const AUTH_KEY_RE = /^[A-Za-z0-9_-]{40,64}$/;
const RECOVERY_KEY_RE = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){7}$/;

const registerSchema = z.object({
  invitationCode: z.string().trim().min(8).max(160),
  username: z
    .string()
    .trim()
    .regex(USERNAME_RE, 'نام کاربری فقط می‌تواند شامل حروف، عدد، نقطه، خط تیره و زیرخط باشد (۳ تا ۳۲ نویسه).'),
  email: z.string().trim().email('نشانی ایمیل معتبر نیست').max(254),
  salt: z.string().regex(SALT_RE),
  authKey: z.string().regex(AUTH_KEY_RE),
  recoveryKey: z.string().trim().regex(RECOVERY_KEY_RE),
  recoveryKeyAck: z.literal(true, {
    errorMap: () => ({ message: 'باید تأیید کنید که کلید بازیابی را در جای امنی ذخیره کرده‌اید.' }),
  }),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  authKey: z.string().regex(AUTH_KEY_RE),
});

const otpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'کد تأیید باید ۶ رقم باشد'),
});

const forgotSchema = z.object({ email: z.string().trim().email('نشانی ایمیل معتبر نیست') });

const resetSchema = z.object({
  token: z.string().trim().min(20).max(200),
  salt: z.string().regex(SALT_RE),
  authKey: z.string().regex(AUTH_KEY_RE),
});

const recoveryVerifySchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  recoveryKey: z.string().trim().regex(RECOVERY_KEY_RE),
});

const recoveryCompleteSchema = z.object({
  ticket: z.string().trim().min(20).max(200),
  salt: z.string().regex(SALT_RE),
  authKey: z.string().regex(AUTH_KEY_RE),
  recoveryKey: z.string().trim().regex(RECOVERY_KEY_RE),
  recoveryKeyAck: z.literal(true),
});

const regenerateSchema = z.object({
  authKey: z.string().regex(AUTH_KEY_RE),
  recoveryKey: z.string().trim().regex(RECOVERY_KEY_RE),
});

const changePasswordSchema = z.object({
  currentAuthKey: z.string().regex(AUTH_KEY_RE),
  salt: z.string().regex(SALT_RE),
  authKey: z.string().regex(AUTH_KEY_RE),
});

const changeEmailSchema = z.object({
  email: z.string().trim().email('نشانی ایمیل معتبر نیست'),
  authKey: z.string().regex(AUTH_KEY_RE),
});

const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  language: z.enum(['fa', 'en']).optional(),
  autoBackup: z.boolean().optional(),
});

const bootstrapSchema = z.object({
  secret: z.string().min(8).max(500),
  username: z.string().trim().regex(USERNAME_RE, 'نام کاربری باید ۳ تا ۳۲ نویسه باشد.'),
  email: z.string().trim().email('نشانی ایمیل معتبر نیست'),
  salt: z.string().regex(SALT_RE),
  authKey: z.string().regex(AUTH_KEY_RE),
  recoveryKey: z.string().trim().regex(RECOVERY_KEY_RE),
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeIdentifier(input: string): string {
  return normalizeUsername(input).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function parseQuery<T extends z.ZodTypeAny>(schema: T, c: Context<AppEnv>): z.infer<T> {
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(c.req.query())) raw[k] = v;
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(400, 'validation_error', 'پارامترهای درخواست معتبر نیست');
  return result.data;
}

async function findUserByIdentifier(env: AppEnv['Bindings'], identifier: string) {
  return env.DB.prepare('SELECT * FROM users WHERE username_normalized = ? OR email_normalized = ? LIMIT 1')
    .bind(normalizeIdentifier(identifier), normalizeEmail(identifier))
    .first<Record<string, unknown>>();
}

function randomOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

async function issueToken(
  env: AppEnv['Bindings'],
  userId: string,
  purpose: 'verify_email' | 'reset_password' | 'recovery_session',
  ttlMs: number,
  code?: string,
): Promise<string> {
  const value = code ?? randomToken(32);
  const tokenHash = await hashToken(value);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), userId, purpose, tokenHash, now + ttlMs, now)
    .run();
  return value;
}

/** Creates a session and wraps the JSON body with the session cookie. */
async function sessionResponse(
  c: Context<AppEnv>,
  userId: string,
  body: unknown,
  status: 200 | 201 = 200,
): Promise<Response> {
  const session = await createSession(c.env, userId, c.req.raw);
  return attachSessionCookie(
    json(body, status),
    sessionCookieValue(session.token, session.expiresAt, session.secure),
  );
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return value.trim() === '' || /change_me|your_|example|placeholder/i.test(value);
}

function appOrigin(c: Context<AppEnv>): string {
  return (c.env.APP_BASE_URL ?? new URL(c.req.url).origin).replace(/\/$/, '');
}

async function sendVerificationMail(env: AppEnv['Bindings'], to: string, code: string) {
  return sendEmail(env, {
    to,
    subject: 'کد تأیید ایمیل — دنیای رسانه‌ای من',
    text: `کد تأیید ایمیل شما: ${code}\nاین کد تا ۱۵ دقیقه معتبر است.`,
    html: `<div dir="rtl" style="font-family:Tahoma,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 8px">دنیای رسانه‌ای من</h2>
      <p>برای تأیید نشانی ایمیل خود، این کد را در برنامه وارد کنید:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:bold;direction:ltr;text-align:center;padding:16px;background:#f4f4f5;border-radius:8px">${escapeHtml(code)}</p>
      <p style="color:#666;font-size:13px">این کد تا ۱۵ دقیقه معتبر است. اگر شما این درخواست را نداده‌اید، این پیام را نادیده بگیرید.</p>
    </div>`,
  });
}

// ─────────────────────────────────────────────────────────────
// First administrator bootstrap
// ─────────────────────────────────────────────────────────────

auth.get('/setup-status', async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL",
  ).first<{ n: number }>();
  return json({
    needsAdmin: Number(row?.n ?? 0) === 0,
    bootstrapConfigured: Boolean(c.env.ADMIN_BOOTSTRAP_SECRET && !isPlaceholder(c.env.ADMIN_BOOTSTRAP_SECRET)),
  });
});

auth.post('/bootstrap-admin', async (c) => {
  await enforceLimit(c, 'bootstrap', 5, 3600);
  const body = await readJson(bootstrapSchema, c);
  const secret = c.env.ADMIN_BOOTSTRAP_SECRET;

  if (!secret || isPlaceholder(secret)) {
    throw new ApiError(
      403,
      'bootstrap_not_configured',
      'متغیر ADMIN_BOOTSTRAP_SECRET تنظیم نشده است. راهنمای راه‌اندازی را ببینید.',
    );
  }
  if (!constantTimeEqual(body.secret, secret)) {
    throw new ApiError(401, 'invalid_secret', 'کلید راه‌اندازی اشتباه است.');
  }

  const admins = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL",
  ).first<{ n: number }>();
  if (Number(admins?.n ?? 0) > 0) {
    throw new ApiError(403, 'already_initialized', 'مدیر اول از قبل ساخته شده است.');
  }

  const emailNorm = normalizeEmail(body.email);
  const usernameNorm = normalizeUsername(body.username);
  const clash = await c.env.DB.prepare(
    'SELECT id FROM users WHERE username_normalized = ? OR email_normalized = ?',
  )
    .bind(usernameNorm, emailNorm)
    .first();
  if (clash) throw new ApiError(409, 'account_exists', 'این نام کاربری یا ایمیل قبلاً استفاده شده است.');

  const userId = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = await sha256Hex(body.authKey.trim());
  const recoveryHash = await hashToken(body.recoveryKey);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, username, username_normalized, email, email_normalized, email_verified_at,
                          password_hash, password_salt, recovery_key_hash, recovery_key_updated_at,
                          role, preferences, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)`,
    ).bind(
      userId, body.username.trim(), usernameNorm, body.email.trim(), emailNorm, now,
      passwordHash, body.salt, recoveryHash, now, JSON.stringify(DEFAULT_PREFERENCES), now, now,
    ),
    c.env.DB.prepare(
      `INSERT INTO lists (id, user_id, name, description, sort_mode, is_watchlist, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', 1, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, 'فهرست تماشا', 'چیزهایی که می‌خواهم تماشا کنم', now, now),
  ]);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return sessionResponse(c, userId, { user: rowToUser(user!) }, 201);
});

// ─────────────────────────────────────────────────────────────
// Registration (invite-only)
// ─────────────────────────────────────────────────────────────

auth.get('/salt', async (c) => {
  const { identifier } = parseQuery(z.object({ identifier: z.string().trim().min(1).max(254) }), c);
  const user = await findUserByIdentifier(c.env, identifier);
  if (user) return json({ salt: String(user.password_salt) });
  // Deterministic decoy so existing and unknown accounts are indistinguishable.
  const decoy = (await sha256Hex(`mmu-decoy:${normalizeIdentifier(identifier)}:${c.env.ENCRYPTION_KEY ?? ''}`)).slice(0, 22);
  return json({ salt: decoy });
});

auth.post('/register', async (c) => {
  await enforceLimit(c, 'register', 6, 3600);
  const body = await readJson(registerSchema, c);
  const now = Date.now();

  const codeHash = await sha256Hex(`invite:${normalizeCode(body.invitationCode)}`);
  const invite = await c.env.DB.prepare('SELECT * FROM invitations WHERE code_hash = ?')
    .bind(codeHash)
    .first<Record<string, unknown>>();

  if (!invite) throw new ApiError(400, 'invitation_invalid', 'کد دعوت معتبر نیست.');
  if (invite.revoked_at) throw new ApiError(400, 'invitation_revoked', 'این کد دعوت باطل شده است.');
  if (invite.expires_at && Number(invite.expires_at) < now) {
    throw new ApiError(400, 'invitation_expired', 'این کد دعوت منقضی شده است.');
  }
  if (Number(invite.use_count) >= Number(invite.max_uses)) {
    throw new ApiError(400, 'invitation_used', 'این کد دعوت قبلاً استفاده شده است.');
  }
  if (invite.email_hint && normalizeEmail(String(invite.email_hint)) !== normalizeEmail(body.email)) {
    throw new ApiError(400, 'invitation_email_mismatch', 'این کد دعوت برای نشانی ایمیل دیگری صادر شده است.');
  }

  const usernameNorm = normalizeUsername(body.username);
  const emailNorm = normalizeEmail(body.email);
  const clash = await c.env.DB.prepare(
    'SELECT username_normalized, email_normalized FROM users WHERE username_normalized = ? OR email_normalized = ?',
  )
    .bind(usernameNorm, emailNorm)
    .first<{ username_normalized: string; email_normalized: string }>();
  if (clash) {
    const isUsername = clash.username_normalized === usernameNorm;
    throw new ApiError(
      409,
      'account_exists',
      isUsername ? 'این نام کاربری قبلاً انتخاب شده است.' : 'این نشانی ایمیل قبلاً ثبت شده است.',
      { [isUsername ? 'username' : 'email']: 'قبلاً استفاده شده است' },
    );
  }

  const userId = crypto.randomUUID();

  // Consume the invitation atomically — exactly one concurrent request can win.
  // `used_by` has a foreign key to users, so it is filled in after the user row exists.
  const consumed = await c.env.DB.prepare(
    `UPDATE invitations SET use_count = use_count + 1, used_at = ?
      WHERE id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND use_count < max_uses`,
  )
    .bind(now, String(invite.id), now)
    .run();
  if (consumed.meta.changes !== 1) {
    throw new ApiError(400, 'invitation_unavailable', 'این کد دعوت دیگر در دسترس نیست.');
  }

  const passwordHash = await sha256Hex(body.authKey.trim());
  const recoveryHash = await hashToken(body.recoveryKey);
  const otp = randomOtp();

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, username, username_normalized, email, email_normalized, password_hash,
                            password_salt, recovery_key_hash, recovery_key_updated_at, role, preferences,
                            invited_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'member', ?, ?, ?, ?)`,
      ).bind(
        userId, body.username.trim(), usernameNorm, body.email.trim(), emailNorm,
        passwordHash, body.salt, recoveryHash, now, JSON.stringify(DEFAULT_PREFERENCES),
        String(invite.id), now, now,
      ),
      c.env.DB.prepare(
        `INSERT INTO lists (id, user_id, name, description, sort_mode, is_watchlist, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', 1, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, 'فهرست تماشا', 'چیزهایی که می‌خواهم تماشا کنم', now, now),
      c.env.DB.prepare(
        `INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
         VALUES (?, ?, 'verify_email', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, await hashToken(otp), now + 15 * 60 * 1000, now),
    ]);
  } catch (err) {
    await c.env.DB.prepare(
      'UPDATE invitations SET use_count = MAX(0, use_count - 1), used_by = NULL, used_at = NULL WHERE id = ?',
    )
      .bind(String(invite.id))
      .run()
      .catch(() => undefined);
    console.error('Registration failed', err);
    throw new ApiError(500, 'registration_failed', 'ثبت‌نام کامل نشد. لطفاً دوباره تلاش کنید.');
  }

  // The user row now exists, so the invitation can safely point at it.
  await c.env.DB.prepare('UPDATE invitations SET used_by = ? WHERE id = ?')
    .bind(userId, String(invite.id))
    .run();

  const mail = await sendVerificationMail(c.env, body.email.trim(), otp);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return sessionResponse(
    c,
    userId,
    { user: rowToUser(user!), emailVerificationRequired: true, devOtp: mail.devMode ? otp : undefined },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// Sign in / out / session management
// ─────────────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  await enforceLimit(c, 'login', 12, 900);
  const body = await readJson(loginSchema, c);
  const user = await findUserByIdentifier(c.env, body.identifier);

  // Always compare against a hash so unknown accounts are not distinguishable by timing.
  const supplied = await sha256Hex(body.authKey.trim());
  const expected = user ? String(user.password_hash) : '0'.repeat(64);
  if (!user || !constantTimeEqual(supplied, expected) || user.disabled_at) {
    throw new ApiError(401, 'invalid_credentials', 'نام کاربری یا رمز عبور اشتباه است.');
  }

  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return sessionResponse(c, String(user.id), { user: rowToUser(fresh!) });
});

auth.post('/logout', async (c) => {
  const ctx = await authenticate(c);
  if (ctx) {
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
      .bind(Date.now(), ctx.sessionId)
      .run();
  }
  return attachSessionCookie(json({ ok: true }), clearSessionCookieValue());
});

auth.post('/logout-all', requireUser, async (c) => {
  await revokeAllSessions(c.env, c.get('userId'));
  return attachSessionCookie(json({ ok: true }), clearSessionCookieValue());
});

auth.get('/me', requireUser, async (c) => {
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  if (!user) throw new ApiError(401, 'unauthenticated', 'حساب کاربری یافت نشد.');
  return json({ user: rowToUser(user) });
});

auth.patch('/preferences', requireUser, async (c) => {
  const body = await readJson(preferencesSchema, c);
  const current = await c.env.DB.prepare('SELECT preferences FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ preferences: string }>();
  let prefs = { ...DEFAULT_PREFERENCES };
  try {
    prefs = { ...prefs, ...JSON.parse(current?.preferences ?? '{}') };
  } catch {
    /* keep defaults */
  }
  if (body.theme) prefs.theme = body.theme;
  if (body.language) prefs.language = body.language;
  if (typeof body.autoBackup === 'boolean') prefs.autoBackup = body.autoBackup;

  await c.env.DB.prepare('UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(prefs), Date.now(), c.get('userId'))
    .run();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  return json({ user: rowToUser(user!), preferences: prefs });
});

auth.get('/sessions', requireUser, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, user_agent, ip, created_at, last_seen_at, expires_at
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC`,
  )
    .bind(c.get('userId'))
    .all<Record<string, unknown>>();
  const current = c.get('sessionId');
  return json({
    sessions: (rows.results ?? []).map((r) => ({
      id: String(r.id),
      userAgent: (r.user_agent as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
      createdAt: Number(r.created_at),
      lastSeenAt: Number(r.last_seen_at),
      expiresAt: Number(r.expires_at),
      current: String(r.id) === current,
    })),
  });
});

auth.delete('/sessions/:id', requireUser, async (c) => {
  await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?')
    .bind(Date.now(), c.req.param('id'), c.get('userId'))
    .run();
  return json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Email verification
// ─────────────────────────────────────────────────────────────

auth.post('/verify-email', requireUser, async (c) => {
  const { code } = await readJson(otpSchema, c);
  const tokenHash = await hashToken(code);
  const row = await c.env.DB.prepare(
    `SELECT id, expires_at, used_at FROM email_tokens
      WHERE user_id = ? AND purpose = 'verify_email' AND token_hash = ?`,
  )
    .bind(c.get('userId'), tokenHash)
    .first<{ id: string; expires_at: number; used_at: number | null }>();

  if (!row || row.used_at || row.expires_at < Date.now()) {
    throw new ApiError(400, 'invalid_code', 'کد تأیید معتبر نیست یا منقضی شده است.');
  }
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, c.get('userId')),
    c.env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
  ]);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  return json({ user: rowToUser(user!) });
});

auth.post('/verify-email/resend', requireUser, async (c) => {
  await enforceLimit(c, 'resend', 4, 900);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  if (!user) throw new ApiError(404, 'not_found', 'حساب یافت نشد.');
  if (user.email_verified_at) throw new ApiError(400, 'already_verified', 'ایمیل شما قبلاً تأیید شده است.');
  const otp = randomOtp();
  await issueToken(c.env, c.get('userId'), 'verify_email', 15 * 60 * 1000, otp);
  const mail = await sendVerificationMail(c.env, String(user.email), otp);
  return json({ ok: true, devOtp: mail.devMode ? otp : undefined });
});

// ─────────────────────────────────────────────────────────────
// Password reset
// ─────────────────────────────────────────────────────────────

auth.post('/forgot-password', async (c) => {
  await enforceLimit(c, 'forgot', 5, 900);
  const { email } = await readJson(forgotSchema, c);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email_normalized = ?')
    .bind(normalizeEmail(email))
    .first<Record<string, unknown>>();

  // Always answer identically — never reveal whether an account exists.
  if (user && !user.disabled_at) {
    const token = await issueToken(c.env, String(user.id), 'reset_password', 60 * 60 * 1000);
    const link = `${appOrigin(c)}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail(c.env, {
      to: String(user.email),
      subject: 'بازنشانی رمز عبور — دنیای رسانه‌ای من',
      text: `برای تنظیم رمز عبور جدید روی این پیوند بزنید:\n${link}\nاین پیوند تا ۶۰ دقیقه معتبر است.`,
      html: `<div dir="rtl" style="font-family:Tahoma,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 8px">بازنشانی رمز عبور</h2>
        <p>برای انتخاب رمز عبور جدید روی دکمه زیر بزنید:</p>
        <p style="text-align:center;margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0b0c10;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">تنظیم رمز عبور جدید</a></p>
        <p style="color:#666;font-size:13px">این پیوند تا ۶۰ دقیقه معتبر است. اگر شما این درخواست را نداده‌اید، این پیام را نادیده بگیرید.</p>
      </div>`,
    });
  }
  return json({ ok: true, message: 'اگر این ایمیل در سیستم ثبت شده باشد، پیوند بازنشانی برایتان ارسال می‌شود.' });
});

auth.post('/reset-password', async (c) => {
  await enforceLimit(c, 'reset', 8, 900);
  const body = await readJson(resetSchema, c);
  const tokenHash = await hashToken(body.token);
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at FROM email_tokens
      WHERE purpose = 'reset_password' AND token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();

  if (!row || row.used_at || row.expires_at < Date.now()) {
    throw new ApiError(400, 'invalid_token', 'این پیوند معتبر نیست یا منقضی شده است.');
  }

  const passwordHash = await sha256Hex(body.authKey.trim());
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
      .bind(passwordHash, body.salt, now, row.user_id),
    c.env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, row.user_id),
  ]);
  return sessionResponse(c, row.user_id, { ok: true });
});

// ─────────────────────────────────────────────────────────────
// Recovery key — emergency access
// ─────────────────────────────────────────────────────────────

auth.post('/recovery/verify', async (c) => {
  await enforceLimit(c, 'recovery', 8, 900);
  const body = await readJson(recoveryVerifySchema, c);
  const user = await findUserByIdentifier(c.env, body.identifier);
  const supplied = await hashToken(body.recoveryKey);
  const expected = user?.recovery_key_hash ? String(user.recovery_key_hash) : '0'.repeat(64);
  if (!user || user.disabled_at || !constantTimeEqual(supplied, expected)) {
    throw new ApiError(401, 'invalid_recovery', 'نام کاربری یا کلید بازیابی اشتباه است.');
  }

  const ticket = await issueToken(c.env, String(user.id), 'recovery_session', 10 * 60 * 1000);
  return json({ ticket, username: String(user.username) });
});

auth.post('/recovery/complete', async (c) => {
  await enforceLimit(c, 'recovery-complete', 8, 900);
  const body = await readJson(recoveryCompleteSchema, c);
  const ticketHash = await hashToken(body.ticket);
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at FROM email_tokens
      WHERE purpose = 'recovery_session' AND token_hash = ?`,
  )
    .bind(ticketHash)
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();

  if (!row || row.used_at || row.expires_at < Date.now()) {
    throw new ApiError(400, 'invalid_ticket', 'این درخواست بازیابی معتبر نیست یا منقضی شده است.');
  }

  const passwordHash = await sha256Hex(body.authKey.trim());
  const recoveryHash = await hashToken(body.recoveryKey);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, recovery_key_hash = ?,
              recovery_key_updated_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(passwordHash, body.salt, recoveryHash, now, now, row.user_id),
    c.env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, row.user_id),
  ]);
  return sessionResponse(c, row.user_id, { ok: true });
});

auth.post('/recovery/regenerate', requireUser, async (c) => {
  const body = await readJson(regenerateSchema, c);
  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ password_hash: string }>();
  const supplied = await sha256Hex(body.authKey.trim());
  if (!user || !constantTimeEqual(supplied, user.password_hash)) {
    throw new ApiError(401, 'invalid_password', 'رمز عبور اشتباه است.');
  }
  const recoveryHash = await hashToken(body.recoveryKey);
  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE users SET recovery_key_hash = ?, recovery_key_updated_at = ?, updated_at = ? WHERE id = ?',
  ).bind(recoveryHash, now, now, c.get('userId')).run();
  return json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Password & email changes
// ─────────────────────────────────────────────────────────────

auth.post('/change-password', requireVerifiedUser, async (c) => {
  const body = await readJson(changePasswordSchema, c);
  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ password_hash: string }>();
  const supplied = await sha256Hex(body.currentAuthKey.trim());
  if (!user || !constantTimeEqual(supplied, user.password_hash)) {
    throw new ApiError(401, 'invalid_password', 'رمز عبور فعلی اشتباه است.');
  }
  const passwordHash = await sha256Hex(body.authKey.trim());
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
      .bind(passwordHash, body.salt, now, c.get('userId')),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL')
      .bind(now, c.get('userId'), c.get('sessionId')),
  ]);
  return json({ ok: true });
});

auth.post('/change-email', requireVerifiedUser, async (c) => {
  const body = await readJson(changeEmailSchema, c);
  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ password_hash: string }>();
  const supplied = await sha256Hex(body.authKey.trim());
  if (!user || !constantTimeEqual(supplied, user.password_hash)) {
    throw new ApiError(401, 'invalid_password', 'رمز عبور اشتباه است.');
  }
  const emailNorm = normalizeEmail(body.email);
  const clash = await c.env.DB.prepare('SELECT id FROM users WHERE email_normalized = ? AND id <> ?')
    .bind(emailNorm, c.get('userId'))
    .first();
  if (clash) throw new ApiError(409, 'email_taken', 'این نشانی ایمیل قبلاً توسط حساب دیگری استفاده شده است.');

  const otp = randomOtp();
  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE users SET email = ?, email_normalized = ?, email_verified_at = NULL, updated_at = ? WHERE id = ?',
  )
    .bind(body.email.trim(), emailNorm, now, c.get('userId'))
    .run();
  await issueToken(c.env, c.get('userId'), 'verify_email', 15 * 60 * 1000, otp);
  const mail = await sendVerificationMail(c.env, body.email.trim(), otp);
  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  return json({ user: rowToUser(fresh!), devOtp: mail.devMode ? otp : undefined });
});

export default auth;
