import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../lib/http';
import { clientIp, checkRateLimit } from '../lib/rate-limit';
import { hashToken, randomToken, sha256Hex } from '../lib/crypto';

export const SESSION_COOKIE = 'mmu_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface AuthContext {
  userId: string;
  role: 'admin' | 'member';
  sessionId: string;
  emailVerified: boolean;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
  last_seen_at: number;
  role: string;
  email_verified_at: number | null;
  disabled_at: number | null;
}

export async function createSession(
  env: Env,
  userId: string,
  req: Request,
): Promise<{ token: string; expiresAt: number; secure: boolean }> {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      tokenHash,
      req.headers.get('user-agent')?.slice(0, 300) ?? null,
      clientIp(req.headers),
      now,
      now,
      expiresAt,
    )
    .run();
  return { token, expiresAt, secure: env.ENV === 'production' };
}

/**
 * Builds the Set-Cookie header value for a session.
 *
 * NOTE: we deliberately build the header ourselves instead of using Hono's
 * `setCookie()`. Per the Fetch spec, `Headers` objects attached to a `Response`
 * have guard "response", and appending `Set-Cookie` to such an object is a
 * silent no-op. Constructing a fresh Headers object (guard "none") and passing
 * it into `new Response()` is spec-safe and works identically in workerd and Node.
 */
export function sessionCookieValue(token: string, expiresAt: number, secure: boolean): string {
  const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  const attrs = [
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attrs.push('Secure');
  return `${SESSION_COOKIE}=${token}; ${attrs.join('; ')}`;
}

export function clearSessionCookieValue(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

/** Attaches session cookies to an already-built Response. */
export function attachSessionCookie(res: Response, cookie: string): Response {
  const headers = new Headers(res.headers);
  headers.append('set-cookie', cookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function authenticate(c: Context<AppEnv>): Promise<AuthContext | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, s.last_seen_at,
            u.role, u.email_verified_at, u.disabled_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row) return null;
  const now = Date.now();
  if (row.revoked_at || row.expires_at < now || row.disabled_at) return null;

  // Sliding expiry, throttled to at most one write per six hours per session.
  if (now - row.last_seen_at > REFRESH_INTERVAL_MS) {
    c.env.DB.prepare(
      'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?',
    )
      .bind(now, now + SESSION_TTL_MS, row.session_id)
      .run()
      .catch(() => undefined);
  }

  return {
    userId: String(row.user_id),
    role: row.role === 'admin' ? 'admin' : 'member',
    sessionId: String(row.session_id),
    emailVerified: row.email_verified_at !== null,
  };
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (!auth) throw new ApiError(401, 'unauthenticated', 'برای ادامه باید وارد حساب کاربری خود شوید.');
  c.set('userId', auth.userId);
  c.set('userRole', auth.role);
  c.set('sessionId', auth.sessionId);
  await next();
});

export const requireVerifiedUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (!auth) throw new ApiError(401, 'unauthenticated', 'برای ادامه باید وارد حساب کاربری خود شوید.');
  if (!auth.emailVerified) {
    throw new ApiError(403, 'email_not_verified', 'ابتدا باید نشانی ایمیل خود را تأیید کنید.');
  }
  c.set('userId', auth.userId);
  c.set('userRole', auth.role);
  c.set('sessionId', auth.sessionId);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (!auth) throw new ApiError(401, 'unauthenticated', 'برای ادامه باید وارد حساب کاربری خود شوید.');
  if (auth.role !== 'admin') throw new ApiError(403, 'forbidden', 'این بخش فقط برای مدیر در دسترس است.');
  c.set('userId', auth.userId);
  c.set('userRole', auth.role);
  c.set('sessionId', auth.sessionId);
  await next();
});

/** Enforce a per-IP limit on sensitive auth endpoints. */
export async function enforceLimit(
  c: Context<AppEnv>,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const key = `${bucket}:${clientIp(c.req.raw.headers)}`;
  const result = await checkRateLimit(c.env, key, limit, windowSeconds);
  if (!result.ok) {
    throw new ApiError(
      429,
      'rate_limited',
      `تلاش‌های شما بیش از حد مجاز است. لطفاً ${Math.ceil(result.retryAfter / 60)} دقیقه دیگر دوباره امتحان کنید.`,
    );
  }
}

export async function revokeAllSessions(env: Env, userId: string, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await env.DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?',
    )
      .bind(Date.now(), userId, exceptSessionId)
      .run();
  } else {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(Date.now(), userId)
      .run();
  }
}

/** Hash of a client-derived auth key (the Worker never sees the raw password). */
export async function hashAuthKey(authKey: string): Promise<string> {
  return sha256Hex(authKey.trim());
}
