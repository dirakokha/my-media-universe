/**
 * Cryptography helpers for the Worker.
 *
 * Password handling: the client derives an auth key from the password with
 * PBKDF2-SHA256 (310k iterations, per-user random salt) and only ever sends that
 * derived key. The Worker stores SHA-256(derivedKey). A database leak therefore
 * exposes neither the password nor the derived key, and cracking still costs an
 * attacker 310k PBKDF2 rounds per guess. This keeps the free 10 ms CPU budget
 * while preserving strong password storage. See docs/DECISIONS.md (ADR-002).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** URL-safe random token. */
export function randomToken(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}

/** Readable, grouped recovery key: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (base32-ish). */
export function generateRecoveryKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(32);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(''));
  return groups.join('-');
}

export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  const data =
    typeof input === 'string'
      ? encoder.encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash a session / email token before storing it. */
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token.trim());
}

/**
 * Constant-time comparison for equal-length secrets.
 * Falls back to a length-safe manual loop (Workers' timingSafeEqual is not in every runtime).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) {
    // Burn comparable time so a length mismatch is not observable through timing.
    let burn = 0;
    for (let i = 0; i < 64; i += 1) burn ^= ab[i % ab.length] ^ bb[i % bb.length];
    return burn === 0 && ab.length === bb.length;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// ── AES-256-GCM for OAuth refresh tokens at rest ────────────────────────────

function resolveEncryptionKey(env: { ENCRYPTION_KEY?: string; ENV?: string }): Uint8Array {
  const raw = env.ENCRYPTION_KEY;
  if (raw) {
    const bytes = base64ToBytes(raw);
    if (bytes.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte value');
    }
    return bytes;
  }
  if (env.ENV === 'production') {
    throw new Error('ENCRYPTION_KEY is not configured. Refusing to store OAuth tokens unencrypted.');
  }
  // Deterministic development-only key. Never used in production.
  return new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
}

async function getAesKey(env: { ENCRYPTION_KEY?: string; ENV?: string }): Promise<CryptoKey> {
  const raw = resolveEncryptionKey(env);
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(plaintext: string, env: { ENCRYPTION_KEY?: string; ENV?: string }): Promise<string> {
  const key = await getAesKey(env);
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(plaintext) as BufferSource,
  );
  const encrypted = new Uint8Array(cipher);
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, iv.length);
  return base64UrlEncode(combined);
}

export async function decryptSecret(
  payload: string,
  env: { ENCRYPTION_KEY?: string; ENV?: string },
): Promise<string> {
  const key = await getAesKey(env);
  const combined = base64UrlDecode(payload);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource);
  return decoder.decode(plain);
}

// ── Normalisation ───────────────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Usernames are case-insensitive but keep their original casing for display. */
export function normalizeUsername(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک');
}
