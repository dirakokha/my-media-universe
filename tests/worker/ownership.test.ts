import { describe, expect, it } from 'vitest';
import app from '../../worker/index';
import type { AppEnv } from '../../worker/env';

/**
 * Records every SQL statement the Worker sends to D1 so the test can assert that
 * user-owned data is always read through a `user_id` predicate. This is the
 * regression guard for the "no client-supplied user IDs / server-side authz"
 * requirement: a route that forgets the predicate fails here immediately.
 */
function recordingDb(sessionUserId: string | null) {
  const statements: string[] = [];

  const sessionRow = {
    session_id: 'sess-1',
    user_id: sessionUserId ?? '',
    expires_at: Date.now() + 86_400_000,
    revoked_at: null,
    last_seen_at: Date.now(),
    role: 'member',
    email_verified_at: Date.now(),
    disabled_at: null,
  };

  function statement(sql: string, args: unknown[] = []) {
    return {
      sql,
      args,
      bind(...next: unknown[]) {
        return statement(sql, next);
      },
      async first() {
        if (/FROM sessions s/i.test(sql)) return sessionUserId ? sessionRow : null;
        if (/SELECT \* FROM users WHERE id = \?/i.test(sql)) {
          return sessionUserId
            ? {
                id: sessionUserId,
                username: 'owner',
                username_normalized: 'owner',
                email: 'owner@example.com',
                email_normalized: 'owner@example.com',
                role: 'member',
                email_verified_at: Date.now(),
                disabled_at: null,
                recovery_key_hash: null,
                recovery_key_updated_at: null,
                invited_by: null,
                preferences: JSON.stringify({ theme: 'dark' }),
                created_at: Date.now(),
                updated_at: Date.now(),
              }
            : null;
        }
        return null;
      },
      async all() {
        return { success: true, results: [], meta: {} };
      },
      async run() {
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  const db = {
    statements,
    prepare(sql: string) {
      statements.push(sql);
      return statement(sql);
    },
    async batch(stmts: Array<ReturnType<typeof statement>>) {
      for (const s of stmts) statements.push(s.sql);
      return [];
    },
  };

  return db as unknown as AppEnv['Bindings']['DB'] & { statements: string[] };
}

const BASE_ENV = {
  APP_NAME: 'My Media Universe',
  ENV: 'development',
  APP_BASE_URL: 'https://media.example.com',
  ENCRYPTION_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64'),
  ASSETS: {} as AppEnv['Bindings']['ASSETS'],
} satisfies Partial<AppEnv['Bindings']>;

function call(
  db: AppEnv['Bindings']['DB'],
  path: string,
  init: RequestInit & { session?: boolean } = {},
) {
  const env = { ...BASE_ENV, DB: db } as AppEnv['Bindings'];
  const { session, ...requestInit } = init;
  const request = new Request(`https://media.example.com${path}`, {
    ...requestInit,
    headers: {
      origin: 'https://media.example.com',
      ...(session ? { cookie: 'mmu_session=test-token' } : {}),
      ...(requestInit.headers ?? {}),
    },
  });
  return app.fetch(
    // The Workers `Request` type carries CF properties the Hono adapter does not need.
    request as never,
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

/** Tables whose rows belong to exactly one user. */
const OWNED_TABLES = [
  'media_items',
  'episodes',
  'seasons',
  'watch_events',
  'categories',
  'category_items',
  'lists',
  'list_items',
  'backups',
  'google_connections',
  'sync_ops',
];

describe('ownership / authorization', () => {
  it('rejects every protected route without a session', async () => {
    const db = recordingDb(null);
    const paths = [
      '/api/library?limit=1',
      '/api/collections/categories',
      '/api/collections/lists',
      '/api/stats',
      '/api/backup/list',
      '/api/account/export',
      '/api/admin/invitations',
    ];
    for (const path of paths) {
      const res = await call(db, path);
      expect(res.status, `${path} must require a session`).toBe(401);
    }
    const write = await call(db, '/api/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'light' }),
    });
    expect(write.status).toBe(401);
  });

  it('rejects a member trying to reach the admin area even with a valid session', async () => {
    const db = recordingDb('user-1');
    const res = await call(db, '/api/admin/invitations', { session: true });
    expect(res.status).toBe(403);
  });

  it('scopes every query against owned tables by user_id', async () => {
    const db = recordingDb('user-1');
    const paths = [
      '/api/library?limit=1',
      '/api/collections/categories',
      '/api/collections/lists',
      '/api/stats',
      '/api/backup/list',
      '/api/account/export',
    ];

    for (const path of paths) {
      db.statements.length = 0;
      const res = await call(db, path, { session: true });
      expect(res.status, `${path} should succeed`).toBeLessThan(400);

      for (const sql of db.statements) {
        const table = OWNED_TABLES.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(sql));
        if (!table) continue;
        // Reads must be filtered; writes are INSERTs that carry user_id as a bound value.
        const isInsert = /^\s*insert/i.test(sql);
        const scoped = /\buser_id\b/i.test(sql);
        expect(scoped || isInsert, `${path}: query on ${table} is not scoped by user_id → ${sql}`).toBe(true);
      }
    }
  });
});
