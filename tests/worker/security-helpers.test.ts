import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { constantTimeEqual, encryptSecret, decryptSecret, hashToken, normalizeEmail, normalizeUsername, sha256Hex, generateRecoveryKey } from '../../worker/lib/crypto';
import { assertSameOrigin, ApiError, CONTENT_SECURITY_POLICY, handleError, securityHeaders } from '../../worker/lib/http';
import type { AppEnv } from '../../worker/env';

describe('constantTimeEqual', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('is not a prefix match', () => {
    const a = 'a'.repeat(64);
    const b = 'a'.repeat(63) + 'b';
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe('token hashing', () => {
  it('is deterministic and produces a hex digest', async () => {
    const a = await hashToken('session-token');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await hashToken('session-token'));
    expect(a).not.toBe(await hashToken('session-tokeN'));
  });

  it('sha256Hex matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('normalisation', () => {
  it('normalises emails case-insensitively', () => {
    expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
  });

  it('normalises Persian digits and Arabic Yeh/Kaf in usernames', () => {
    expect(normalizeUsername('۱۲۳')).toBe('123');
    expect(normalizeUsername('يوسف')).toBe('یوسف');
    expect(normalizeUsername('كیان')).toBe('کیان');
    expect(normalizeUsername('  Ali ')).toBe('ali'); // case-insensitive identity, display keeps casing
  });
});

describe('encrypted secrets at rest', () => {
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');

  it('round-trips and produces a different ciphertext each time', async () => {
    const a = await encryptSecret('refresh-token', { ENCRYPTION_KEY: key, ENV: 'production' });
    const b = await encryptSecret('refresh-token', { ENCRYPTION_KEY: key, ENV: 'production' });
    expect(a).not.toBe(b); // random IV
    expect(a).not.toContain('refresh-token');
    expect(await decryptSecret(a, { ENCRYPTION_KEY: key, ENV: 'production' })).toBe('refresh-token');
  });

  it('refuses to run without a key in production', async () => {
    await expect(encryptSecret('x', { ENV: 'production' })).rejects.toThrow();
  });
});

describe('CSRF same-origin check', () => {
  function app(extraEnv: Partial<AppEnv['Bindings']> = {}) {
    const hono = new Hono<AppEnv>();
    hono.use('*', async (c, next) => {
      try {
        assertSameOrigin(c);
        await next();
      } catch (err) {
        return handleError(err);
      }
    });
    hono.post('/write', (c) => c.json({ ok: true }));
    hono.get('/read', (c) => c.json({ ok: true }));
    const env = { ...base, ...extraEnv };
    return {
      request: (path: string, init?: RequestInit) => hono.request(path, init, env),
    };
  }

  const base: AppEnv['Bindings'] = { DB: {} as AppEnv['Bindings']['DB'], ASSETS: {} as AppEnv['Bindings']['ASSETS'] };

  it('ignores safe methods', async () => {
    const res = await app(base).request('/read');
    expect(res.status).toBe(200);
  });

  it('accepts a matching Origin', async () => {
    const res = await app(base).request('/write', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
    });
    expect(res.status).toBe(200);
  });

  it('accepts the configured APP_BASE_URL origin', async () => {
    const res = await app({ ...base, APP_BASE_URL: 'https://media.example.com/' }).request('/write', {
      method: 'POST',
      headers: { origin: 'https://media.example.com' },
    });
    expect(res.status).toBe(200);
  });

  it('accepts x-forwarded-host behind Cloudflare', async () => {
    const res = await app(base).request('/write', {
      method: 'POST',
      headers: { origin: 'https://media.example.com', 'x-forwarded-host': 'media.example.com', 'x-forwarded-proto': 'https' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a foreign or missing Origin with 403', async () => {
    const evil = await app(base).request('/write', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: { code: string } }).error.code).toBe('csrf_origin_mismatch');

    const missing = await app(base).request('/write', { method: 'POST' });
    expect(missing.status).toBe(403);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('csrf_missing_origin');

    const malformed = await app(base).request('/write', { method: 'POST', headers: { origin: 'not a url' } });
    expect(malformed.status).toBe(403);
  });
});

describe('server recovery key shape', () => {
  it('matches the client generator output', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){7}$/);
  });
});

describe('ApiError', () => {
  it('carries a machine-readable code', () => {
    const err = new ApiError(409, 'already_in_library', 'duplicate', { id: 'x' });
    expect(err.status).toBe(409);
    expect(err.code).toBe('already_in_library');
    expect(err.fields).toEqual({ id: 'x' });
  });
});

describe('security headers', () => {
  it('ships a strict CSP that forbids framing, objects and third-party scripts', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).toContain('https://image.tmdb.org');
  });

  it('adds HSTS only in production and never on local development', () => {
    expect(securityHeaders({ ENV: 'development' })['strict-transport-security']).toBeUndefined();
    expect(securityHeaders({ ENV: 'production' })['strict-transport-security']).toContain('max-age=');
    expect(securityHeaders()['x-frame-options']).toBe('DENY');
  });
});
