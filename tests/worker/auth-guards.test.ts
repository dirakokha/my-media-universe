import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../../worker/env';
import { handleError } from '../../worker/lib/http';
import { requireAdmin, requireUser, requireVerifiedUser, SESSION_COOKIE } from '../../worker/auth/service';
import { hashToken } from '../../worker/lib/crypto';

/* Minimal D1 double: answers the single session lookup `authenticate()` performs. */
function fakeDb(sessionRow: Record<string, unknown> | null) {
  const stmt = {
    bind: () => ({
      first: async () => sessionRow,
      all: async () => ({ results: sessionRow ? [sessionRow] : [], success: true, meta: {} }),
      run: async () => ({ success: true, meta: { changes: sessionRow ? 1 : 0 } }),
    }),
    first: async () => sessionRow,
    all: async () => ({ results: [], success: true, meta: {} }),
    run: async () => ({ success: true, meta: { changes: 0 } }),
  };
  return { prepare: () => stmt, batch: async () => [] } as unknown as AppEnv['Bindings']['DB'];
}

function buildApp(guard: typeof requireUser, sessionRow: Record<string, unknown> | null) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    try {
      await guard(c, next);
    } catch (err) {
      return handleError(err);
    }
  });
  app.get('/protected', (c) => c.json({ userId: c.get('userId'), role: c.get('userRole') }));
  const env = { DB: fakeDb(sessionRow), ASSETS: {} as AppEnv['Bindings']['ASSETS'] };
  return (headers: Record<string, string> = {}) => app.request('/protected', { headers }, env);
}

const NOW = Date.now();

function row(over: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-1',
    user_id: 'user-1',
    expires_at: NOW + 86_400_000,
    revoked_at: null,
    last_seen_at: NOW,
    role: 'member',
    email_verified_at: NOW,
    disabled_at: null,
    ...over,
  };
}

describe('auth guards', () => {
  it('rejects requests without a session cookie with 401', async () => {
    for (const guard of [requireUser, requireVerifiedUser, requireAdmin]) {
      const res = await buildApp(guard, row())();
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthenticated');
    }
  });

  it('rejects an unknown or revoked session', async () => {
    const unknown = await buildApp(requireUser, null)();
    expect(unknown.status).toBe(401);
    const revoked = await buildApp(requireUser, row({ revoked_at: NOW }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(revoked.status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const res = await buildApp(requireUser, row({ expires_at: NOW - 1 }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(res.status).toBe(401);
  });

  it('rejects a disabled account even with a valid session', async () => {
    const res = await buildApp(requireUser, row({ disabled_at: NOW }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(res.status).toBe(401);
  });

  it('attaches the user id and role for a valid session', async () => {
    const res = await buildApp(requireUser, row({ role: 'admin' }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-1', role: 'admin' });
  });

  it('requireVerifiedUser returns 403 for unverified accounts', async () => {
    const res = await buildApp(requireVerifiedUser, row({ email_verified_at: null }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('email_not_verified');
  });

  it('requireAdmin returns 403 for members and 200 for admins', async () => {
    const member = await buildApp(requireAdmin, row({ role: 'member' }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(member.status).toBe(403);
    expect(((await member.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    const admin = await buildApp(requireAdmin, row({ role: 'admin' }))({ cookie: `${SESSION_COOKIE}=abc` });
    expect(admin.status).toBe(200);
  });

  it('hashes the session token before lookup so raw tokens are never stored', async () => {
    const hash = await hashToken('abc');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe('abc');
  });
});
