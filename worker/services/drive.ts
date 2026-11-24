import type { Env } from '../env';
import { ApiError } from '../lib/http';
import { base64UrlEncode, decryptSecret, encryptSecret, randomBytes, sha256Hex } from '../lib/crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

export function assertGoogleConfigured(env: Env): void {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ApiError(
      503,
      'google_not_configured',
      'اتصال به Google Drive هنوز پیکربندی نشده است. مدیر باید شناسه و کلید OAuth را تنظیم کند.',
    );
  }
}

function redirectUri(env: Env, requestUrl: string): string {
  const base = (env.APP_BASE_URL ?? new URL(requestUrl).origin).replace(/\/$/, '');
  return `${base}/api/backup/google/callback`;
}

export async function createAuthorizationUrl(
  env: Env,
  userId: string,
  requestUrl: string,
): Promise<{ url: string }> {
  assertGoogleConfigured(env);

  const state = base64UrlEncode(randomBytes(24));
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );

  await env.DB.prepare(
    'INSERT INTO oauth_states (state, user_id, code_verifier, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await sha256Hex(state), userId, verifier, Date.now() + 10 * 60 * 1000)
    .run();

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', redirectUri(env, requestUrl));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('include_granted_scopes', 'true');
  return { url: url.toString() };
}

export async function consumeOAuthState(env: Env, state: string): Promise<{ userId: string; verifier: string } | null> {
  const stateHash = await sha256Hex(state);
  const row = await env.DB.prepare('SELECT user_id, code_verifier, expires_at FROM oauth_states WHERE state = ?')
    .bind(stateHash)
    .first<{ user_id: string; code_verifier: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(stateHash).run();
  return { userId: row.user_id, verifier: row.code_verifier };
}

export async function exchangeCode(
  env: Env,
  code: string,
  verifier: string,
  requestUrl: string,
): Promise<GoogleTokens> {
  assertGoogleConfigured(env);
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(env, requestUrl),
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Google token exchange failed', res.status, detail);
    throw new ApiError(502, 'google_token_exchange_failed', 'دسترسی به Google Drive تأیید نشد. لطفاً دوباره تلاش کنید.');
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
  if (!json.refresh_token) {
    throw new ApiError(
      502,
      'google_no_refresh_token',
      'Google اجازه‌ی دسترسی دائمی را صادر نکرد. اتصال را قطع و دوباره برقرار کنید.',
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000 - 60_000,
    scope: json.scope,
  };
}

export async function refreshAccessToken(env: Env, userId: string): Promise<string> {
  assertGoogleConfigured(env);
  const conn = await env.DB.prepare('SELECT refresh_token_enc FROM google_connections WHERE user_id = ?')
    .bind(userId)
    .first<{ refresh_token_enc: string }>();
  if (!conn) throw new ApiError(400, 'google_not_connected', 'ابتدا Google Drive را متصل کنید.');

  const refreshToken = await decryptSecret(conn.refresh_token_enc, env);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new ApiError(401, 'google_token_expired', 'دسترسی Google Drive منقضی شده است. لطفاً دوباره متصل شوید.');
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await env.DB.prepare(
    'UPDATE google_connections SET access_token_enc = ?, access_expires_at = ?, updated_at = ? WHERE user_id = ?',
  )
    .bind(await encryptSecret(json.access_token, env), Date.now() + json.expires_in * 1000 - 60_000, Date.now(), userId)
    .run();
  return json.access_token;
}

interface ConnectionRow {
  user_id: string;
  google_email: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string;
  access_expires_at: number | null;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export async function getConnection(env: Env, userId: string): Promise<ConnectionRow | null> {
  return env.DB.prepare('SELECT * FROM google_connections WHERE user_id = ?')
    .bind(userId)
    .first<ConnectionRow>();
}

/** Returns a valid access token, refreshing it when needed. */
export async function getAccessToken(env: Env, userId: string): Promise<string> {
  const conn = await getConnection(env, userId);
  if (!conn) throw new ApiError(400, 'google_not_connected', 'ابتدا Google Drive را متصل کنید.');
  if (conn.access_token_enc && conn.access_expires_at && conn.access_expires_at > Date.now() + 30_000) {
    return decryptSecret(conn.access_token_enc, env);
  }
  return refreshAccessToken(env, userId);
}

export async function saveConnection(
  env: Env,
  userId: string,
  tokens: GoogleTokens,
  email: string | null,
  folderId: string | null,
): Promise<void> {
  const accessEnc = await encryptSecret(tokens.accessToken, env);
  const refreshEnc = await encryptSecret(tokens.refreshToken ?? '', env);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO google_connections (user_id, google_email, access_token_enc, refresh_token_enc,
        access_expires_at, scope, folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       google_email = excluded.google_email,
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       access_expires_at = excluded.access_expires_at,
       scope = excluded.scope,
       folder_id = COALESCE(excluded.folder_id, google_connections.folder_id),
       updated_at = excluded.updated_at`,
  )
    .bind(userId, email, accessEnc, refreshEnc, tokens.expiresAt, tokens.scope, folderId, now, now)
    .run();
}

export async function disconnect(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM google_connections WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM backups WHERE user_id = ?').bind(userId).run();
}

export async function deleteConnection(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM google_connections WHERE user_id = ?').bind(userId).run();
}

// ─────────────────────────────────────────────────────────────
// Drive API helpers
// ─────────────────────────────────────────────────────────────

async function driveFetch(
  env: Env,
  userId: string,
  path: string,
  init: RequestInit = {},
  base = DRIVE_API,
): Promise<Response> {
  const token = await getAccessToken(env, userId);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (res.status !== 401) return res;

  const fresh = await refreshAccessToken(env, userId);
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set('authorization', `Bearer ${fresh}`);
  if (init.body && !(init.body instanceof FormData) && !retryHeaders.has('content-type')) {
    retryHeaders.set('content-type', 'application/json');
  }
  return fetch(`${base}${path}`, { ...init, headers: retryHeaders });
}

export async function ensureFolder(env: Env, userId: string): Promise<string> {
  const conn = await getConnection(env, userId);
  if (conn?.folder_id) return conn.folder_id;
  const name = env.GOOGLE_DRIVE_FOLDER_NAME ?? 'My Media Universe';

  const query = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
  );
  const listRes = await driveFetch(env, userId, `/files?q=${query}&spaces=drive&fields=files(id,name)`);
  if (listRes.ok) {
    const list = (await listRes.json()) as { files?: { id: string }[] };
    const found = list.files?.[0]?.id;
    if (found) {
      await env.DB.prepare('UPDATE google_connections SET folder_id = ?, updated_at = ? WHERE user_id = ?')
        .bind(found, Date.now(), userId)
        .run();
      return found;
    }
  }

  const createRes = await driveFetch(env, userId, '/files?fields=id', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'پشتیبان‌های برنامه‌ی دنیای رسانه‌ای من',
    }),
  });
  if (!createRes.ok) {
    throw new ApiError(502, 'drive_folder_failed', 'ساخت پوشه‌ی پشتیبان در Google Drive ممکن نشد.');
  }
  const created = (await createRes.json()) as { id: string };
  await env.DB.prepare('UPDATE google_connections SET folder_id = ?, updated_at = ? WHERE user_id = ?')
    .bind(created.id, Date.now(), userId)
    .run();
  return created.id;
}

export async function uploadBackup(
  env: Env,
  userId: string,
  name: string,
  content: string,
  folderId: string,
): Promise<{ fileId: string; sizeBytes: number }> {
  const metadata = { name, parents: [folderId], mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'application/json' }));

  const res = await driveFetch(env, userId, '/files?uploadType=multipart&fields=id,size', {
    method: 'POST',
    body: form,
  }, UPLOAD_API);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Drive upload failed', res.status, detail);
    throw new ApiError(502, 'drive_upload_failed', 'ذخیره‌ی پشتیبان در Google Drive ممکن نشد.');
  }
  const json = (await res.json()) as { id: string; size?: string };
  return { fileId: json.id, sizeBytes: Number(json.size ?? content.length) };
}

export async function listDriveFiles(env: Env, userId: string, folderId: string): Promise<{ id: string; name: string; createdTime: string; size: string }[]> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    env,
    userId,
    `/files?q=${query}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,createdTime,size,mimeType)`,
  );
  if (!res.ok) {
    throw new ApiError(502, 'drive_list_failed', 'خواندن فهرست پشتیبان‌ها ممکن نشد.');
  }
  const json = (await res.json()) as { files?: { id: string; name: string; createdTime: string; size: string }[] };
  return json.files ?? [];
}

export async function downloadFile(env: Env, userId: string, fileId: string): Promise<string> {
  const res = await driveFetch(env, userId, `/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!res.ok) {
    throw new ApiError(502, 'drive_download_failed', 'دانلود فایل پشتیبان ممکن نشد.');
  }
  return res.text();
}

export async function deleteDriveFile(env: Env, userId: string, fileId: string): Promise<void> {
  await driveFetch(env, userId, `/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

export async function getGoogleEmail(env: Env, userId: string): Promise<string | null> {
  const res = await driveFetch(env, userId, 'https://www.googleapis.com/oauth2/v3/userinfo', {}, '');
  if (!res.ok) return null;
  const json = (await res.json()) as { email?: string };
  return json.email ?? null;
}

export { base64UrlEncode };
