/**
 * Client-side credential derivation.
 *
 * The password never leaves the device. We derive a 32-byte key with
 * PBKDF2-HMAC-SHA256 over a per-user random salt and send only that key.
 * The server stores SHA-256(key) — see docs/DECISIONS.md (ADR-002).
 */

const encoder = new TextEncoder();

/**
 * OWASP Password Storage Cheat Sheet recommends 600 000 iterations for
 * PBKDF2-HMAC-SHA256. The KDF runs in the browser, so this costs the *user*
 * ~90 ms on a desktop and does not touch the Worker's 10 ms CPU budget.
 * Changing this value invalidates every existing password hash — it must be
 * treated as a migration, not a tweak.
 */
export const PBKDF2_ITERATIONS = 600_000;
export const KEY_LENGTH_BITS = 256;

export const PASSWORD_MIN_LENGTH = 10;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 16 cryptographically random bytes, base64url encoded (22 characters). */
export function generateSalt(): string {
  return toBase64Url(randomBytes(16));
}

export function assertWebCryptoAvailable(): void {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'مرورگر شما از رمزنگاری وب پشتیبانی نمی‌کند. برای ورود، از مرورگر جدیدتر یا اتصال امن (https) استفاده کنید.',
    );
  }
}

/** Derives the auth key that the server verifies. Deterministic for (password, salt). */
export async function deriveAuthKey(password: string, salt: string): Promise<string> {
  assertWebCryptoAvailable();
  const saltBytes = fromBase64Url(salt);
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return toBase64Url(new Uint8Array(bits));
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A high-entropy recovery key, grouped for readability. Shown to the user exactly once. */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(32);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(''));
  return groups.join('-');
}

/** Accepts pasted keys with spaces, lower-case letters or Persian digits. */
export function normalizeRecoveryKey(input: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const clean = input
    .toUpperCase()
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
    .replace(/[^A-Z0-9]/g, '');
  // Canonical form: 8 groups of 4, regardless of how the user pasted it.
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

const RECOVERY_KEY_SHAPE = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){7}$/;

/** Exactly 8 groups of 4 characters from the unambiguous alphabet. */
export function isValidRecoveryKeyShape(input: string): boolean {
  return RECOVERY_KEY_SHAPE.test(input);
}

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push(`حداقل ${PASSWORD_MIN_LENGTH} نویسه`);
  if (!/[A-Za-z]/.test(password) && !/[\u0600-\u06FF]/.test(password)) issues.push('شامل حروف');
  if (!/\d/.test(password)) issues.push('شامل عدد');
  return issues;
}
