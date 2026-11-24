import type { Env } from '../env';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

/**
 * Fixed-window counter stored in D1.
 * One write per check — only used on security-sensitive endpoints (auth, invitations)
 * so the free tier's 100k rows/day allowance is never at risk.
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start
                    THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count, window_start`,
  )
    .bind(key, windowStart)
    .first<{ count: number; window_start: number }>();

  const count = row?.count ?? 1;
  const retryAfter = windowSeconds - (now - windowStart);

  // Opportunistic cleanup of stale windows (roughly 1 in 64 calls).
  if (Math.random() < 0.015) {
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(now - 86400)
      .run()
      .catch(() => undefined);
  }

  return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfter };
}

export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf;
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
