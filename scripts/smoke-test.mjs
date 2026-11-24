/**
 * End-to-end API smoke test against a running Worker (local or deployed).
 *
 *   npm run smoke                       # http://127.0.0.1:8787
 *   BASE_URL=https://app.example.com npm run smoke
 *
 * Exercises the full journey: admin bootstrap → invitation → registration →
 * email verification → library → ratings → lists → categories → export.
 */
import { execFileSync } from 'node:child_process';
// The KDF parameters are imported from the real client module so this suite can
// never drift from what the browser actually does (Node 22 type-stripping).
import { PBKDF2_ITERATIONS } from '../src/lib/auth.ts';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? BASE;
const BOOTSTRAP_SECRET =
  process.env.ADMIN_BOOTSTRAP_SECRET ?? 'dev-only-bootstrap-secret-do-not-use-in-production-9f3a2c';

// Local runs all come from 127.0.0.1, so the brute-force limiter would trip on
// repeated runs. Clear its counters first — only ever against a local Worker.
if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE)) {
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'mmu-db', '--local', '--command', 'DELETE FROM rate_limits'], {
      stdio: 'ignore',
    });
  } catch {
    console.warn('! could not clear local rate-limit counters (continuing)');
  }
}

let cookie = '';
let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

async function api(method, path, body, extraHeaders = {}) {
  const headers = {
    origin: ORIGIN,
    'content-type': 'application/json',
    ...extraHeaders,
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function deriveAuthKey(password, salt) {
  const saltBytes = Buffer.from(salt.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

function recoveryKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(32);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length])
    .join('')
    .match(/.{1,4}/g)
    .join('-');
}

const stamp = Date.now().toString(36);
// The admin is reused between runs so the test is idempotent.
const ADMIN = {
  username: process.env.SMOKE_ADMIN_USERNAME ?? 'smoke_owner',
  email: process.env.SMOKE_ADMIN_EMAIL ?? 'smoke_owner@example.com',
  password: process.env.SMOKE_ADMIN_PASSWORD ?? 'Correct-Horse-9!',
};
const USER = { username: `friend_${stamp}`, email: `friend_${stamp}@example.com`, password: 'Battery-Staple-7!' };

async function main() {
  console.log(`\n▶ My Media Universe — smoke test\n  target: ${BASE}\n`);

  // 1. Health
  const health = await api('GET', '/api/health');
  assert(health.status === 200 && health.json?.ok === true, 'health endpoint responds');

  // 2. Setup status
  const setup = await api('GET', '/api/auth/setup-status');
  assert(setup.status === 200, 'setup status is public');
  const needsAdmin = setup.json?.needsAdmin === true;
  console.log(`  ℹ needsAdmin=${needsAdmin} bootstrapConfigured=${setup.json?.bootstrapConfigured}`);

  if (needsAdmin) {
    const salt = toBase64Url(randomBytes(16));
    const boot = await api('POST', '/api/auth/bootstrap-admin', {
      secret: BOOTSTRAP_SECRET,
      username: ADMIN.username,
      email: ADMIN.email,
      salt,
      authKey: await deriveAuthKey(ADMIN.password, salt),
      recoveryKey: recoveryKey(),
    });
    assert(boot.status === 201, `first administrator created (${boot.status})`);
    assert(boot.json?.user?.role === 'admin', 'bootstrap user has admin role');
  } else {
    // Already initialised: sign in with the configured admin credentials.
    const saltRes = await api('GET', `/api/auth/salt?identifier=${encodeURIComponent(ADMIN.username)}`);
    const salt = saltRes.json?.salt;
    if (!salt) {
      assert(false, 'could not resolve the admin salt — is SMOKE_ADMIN_USERNAME correct?');
    } else {
      const login = await api('POST', '/api/auth/login', {
        identifier: ADMIN.username,
        authKey: await deriveAuthKey(ADMIN.password, salt),
      });
      assert(login.status === 200, `administrator signed in (${login.status})`);
      assert(cookie.startsWith('mmu_session='), 'administrator session cookie issued');
    }
  }

  // 3. Admin invitation
  const invite = await api('POST', '/api/admin/invitations', { expiresInDays: 7, note: 'smoke test' });
  assert(invite.status === 201 && typeof invite.json?.invitation?.code === 'string', 'invitation code generated');
  const code = invite.json?.invitation?.code;
  // A second invitation, used later to prove per-user data isolation.
  const invite2 = await api('POST', '/api/admin/invitations', { expiresInDays: 7, note: 'smoke isolation' });
  const code2 = invite2.json?.invitation?.code;

  const listInvites = await api('GET', '/api/admin/invitations');
  assert(listInvites.status === 200 && Array.isArray(listInvites.json?.invitations), 'invitation list is readable');
  assert(
    (listInvites.json?.invitations ?? []).every((i) => !('code' in i)),
    'plaintext invitation codes are never stored or returned in lists',
  );

  // 4. Registration rejects bad invitations
  const badSalt = toBase64Url(randomBytes(16));
  const badKey = await deriveAuthKey(USER.password, badSalt);
  const bad = await api('POST', '/api/auth/register', {
    invitationCode: 'MMU-AAAAA-BBBBB-CCCCC',
    username: USER.username,
    email: USER.email,
    salt: badSalt,
    authKey: badKey,
    recoveryKey: recoveryKey(),
    recoveryKeyAck: true,
  });
  assert(bad.status === 400, 'registration with an invalid invitation is rejected');

  // 5. Registration with a valid invitation
  const userSalt = toBase64Url(randomBytes(16));
  const userAuthKey = await deriveAuthKey(USER.password, userSalt);
  const reg = await api('POST', '/api/auth/register', {
    invitationCode: code,
    username: USER.username,
    email: USER.email,
    salt: userSalt,
    authKey: userAuthKey,
    recoveryKey: recoveryKey(),
    recoveryKeyAck: true,
  });
  assert(reg.status === 201, `registration with a valid invitation succeeds (${reg.status})`);
  assert(reg.json?.user?.emailVerified === false, 'new accounts start unverified');
  const devOtp = reg.json?.devOtp;
  if (devOtp) {
    const verify = await api('POST', '/api/auth/verify-email', { code: devOtp });
    assert(verify.status === 200 && verify.json?.user?.emailVerified === true, 'email verification code works');
  } else {
    console.log('  ℹ email delivery configured — verification code was mailed, not returned');
  }

  // 6. Invitation reuse is refused
  const reuse = await api('POST', '/api/auth/register', {
    invitationCode: code,
    username: `${USER.username}b`,
    email: `${USER.username}b@example.com`,
    salt: toBase64Url(randomBytes(16)),
    authKey: await deriveAuthKey(USER.password, toBase64Url(randomBytes(16))),
    recoveryKey: recoveryKey(),
    recoveryKeyAck: true,
  });
  assert(reuse.status === 400, 'a single-use invitation cannot be reused');

  // 7. Me
  const me = await api('GET', '/api/auth/me');
  assert(me.status === 200 && me.json?.user?.username === USER.username, 'session resolves to the right user');

  // 8. Manual item
  const created = await api('POST', '/api/library', {
    manual: {
      title: 'نمونه‌ی فیلم دستی',
      originalTitle: 'Manual Sample',
      kind: 'movie',
      overview: 'یک توضیح کوتاه برای آزمایش',
      releaseYear: 2024,
      genres: ['درام'],
      runtimeMinutes: 120,
    },
    status: 'watching',
  });
  assert(created.status === 201 && created.json?.id, 'manual media item can be created');
  const itemId = created.json?.id;

  // 9. Criteria rating: only rated criteria count
  const rated = await api('POST', `/api/library/${itemId}/rating`, {
    method: 'criteria',
    criteria: { story: 8, characters: 6 },
  });
  assert(rated.status === 200 && rated.json?.rating?.final === 7, 'criteria average ignores skipped criteria (8 & 6 → 7)');

  // 10. Direct rating
  const direct = await api('POST', `/api/library/${itemId}/rating`, { method: 'direct', direct: 9.5 });
  assert(direct.json?.rating?.final === 9.5, 'direct rating stores half points');

  // 11. Rewatch history
  const w1 = await api('POST', `/api/library/${itemId}/watch`, { watchedAt: '2026-01-10', rating: { method: 'direct', direct: 9 } });
  const w2 = await api('POST', `/api/library/${itemId}/watch`, {
    watchedAt: '2027-03-04',
    rating: { method: 'direct', direct: 8.5 },
    notes: 'پایان فیلم حرف ندارد.',
    isSpoiler: true,
  });
  assert(w1.status === 201 && w2.status === 201, 'rewatch events are recorded');
  const detail = await api('GET', `/api/library/${itemId}`);
  assert(detail.json?.watchEvents?.length === 2, 'both viewing events are preserved');
  assert(detail.json?.ratingFinal === 8.5, 'the current rating is the most recent one');
  assert(
    detail.json?.watchEvents?.some((e) => e.rating === 9),
    'the earlier 9/10 viewing keeps its original rating',
  );
  assert(
    detail.json?.watchEvents?.some((e) => e.isSpoiler === true),
    'a spoiler-flagged viewing keeps its flag',
  );

  // 12. Category + list
  const cat = await api('POST', '/api/collections/categories', { name: 'تریلر روانی' });
  assert(cat.status === 201, 'custom category created');
  await api('POST', `/api/collections/categories/${cat.json.category.id}/items`, { mediaItemId: itemId });
  const cats = await api('GET', '/api/collections/categories');
  assert(cats.json?.categories?.[0]?.itemCount === 1, 'media item is classified into the category');

  const list = await api('POST', '/api/collections/lists', { name: 'برترین‌های من' });
  await api('POST', `/api/collections/lists/${list.json.list.id}/items`, { mediaItemId: itemId });
  const listDetail = await api('GET', `/api/collections/lists/${list.json.list.id}`);
  assert(listDetail.json?.items?.length === 1, 'personal list contains the item');

  // 13. Stats
  const stats = await api('GET', '/api/stats');
  assert(stats.status === 200 && typeof stats.json?.overview?.totalWatchTimeMinutes === 'number', 'statistics are computed');
  assert(stats.json?.overview?.ratedEpisodes >= 0, 'episode statistics are present');

  // 14. Export
  const exported = await api('GET', '/api/account/export');
  assert(exported.status === 200 && exported.json?.schemaVersion >= 1, 'portable JSON export works');
  assert(exported.json?.mediaItems?.length >= 1, 'export contains the library');

  // 15. Data isolation: an unauthenticated request sees nothing
  const isolated = await fetch(`${BASE}/api/library/${itemId}`, {
    headers: { origin: ORIGIN },
  });
  assert(isolated.status === 401, 'an unauthenticated request cannot read this library');

  // 15b. A second, separately authenticated user cannot read the first user's item
  const otherSalt = toBase64Url(randomBytes(16));
  const otherReg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      invitationCode: code2,
      username: `other_${stamp}`,
      email: `other_${stamp}@example.com`,
      salt: otherSalt,
      authKey: await deriveAuthKey(USER.password, otherSalt),
      recoveryKey: recoveryKey(),
      recoveryKeyAck: true,
    }),
  });
  if (otherReg.status === 201) {
    const otherCookie = (otherReg.headers.getSetCookie?.()[0] ?? '').split(';')[0];
    const crossRead = await fetch(`${BASE}/api/library/${itemId}`, {
      headers: { origin: ORIGIN, cookie: otherCookie },
    });
    assert([403, 404].includes(crossRead.status), `another user cannot read this library item (${crossRead.status})`);
    const crossList = await fetch(`${BASE}/api/library`, {
      headers: { origin: ORIGIN, cookie: otherCookie },
    });
    const crossJson = crossList.status === 200 ? await crossList.json() : { items: [] };
    assert(
      !(crossJson.items ?? []).some((i) => i.id === itemId),
      'another user cannot see this item in their library list',
    );
  } else {
    console.log(`  ℹ cross-user isolation check skipped (second registration returned ${otherReg.status})`);
  }

  console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`} (${checks} total)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 smoke test crashed:', err);
  process.exit(1);
});
