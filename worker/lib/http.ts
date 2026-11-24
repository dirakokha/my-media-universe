import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError, type ZodTypeDef, type ZodType } from 'zod';
import type { AppEnv } from '../env';

export class ApiError extends Error {
  status: ContentfulStatusCode;
  code: string;
  fields?: Record<string, string>;

  constructor(status: ContentfulStatusCode, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function json<T>(data: T, status: ContentfulStatusCode = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(headers ?? {}),
    },
  });
}

/** Human-readable Persian messages for validation failures. */
const VALIDATION_MESSAGES: Record<string, string> = {
  too_small: 'خیلی کوتاه است',
  too_big: 'خیلی بلند است',
  invalid_string: 'مقدار واردشده معتبر نیست',
  invalid_type: 'این فیلد الزامی است',
  invalid_email: 'نشانی ایمیل معتبر نیست',
  invalid_enum_value: 'مقدار انتخاب‌شده معتبر نیست',
  custom: 'مقدار واردشده معتبر نیست',
  invalid_number: 'عدد معتبر نیست',
  multiple_of: 'مقدار باید مضرب ۰٫۵ باشد',
  not_multiple_of: 'مقدار باید مضرب ۰٫۵ باشد',
};

export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    if (result.error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) {
          const detail = (issue as { message?: string }).message;
          fields[key] = VALIDATION_MESSAGES[issue.code] ?? detail ?? 'مقدار معتبر نیست';
        }
      }
      const first = Object.values(fields)[0] ?? 'ورودی معتبر نیست';
      throw new ApiError(400, 'validation_error', first, fields);
    }
    throw new ApiError(400, 'validation_error', 'ورودی معتبر نیست');
  }
  return result.data;
}

export async function readJson<T>(schema: ZodType<T, ZodTypeDef, unknown>, c: Context<AppEnv>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'بدنه‌ی درخواست معتبر نیست');
  }
  return parseBody(schema, body);
}

export function getOrigin(c: Context<AppEnv>): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * CSRF defence in depth.
 * Session cookies are SameSite=Lax (which already blocks cross-site POSTs), and we
 * additionally require every state-changing request to carry an Origin/Referer that
 * matches the app origin. Browsers always send Origin on cross-origin and same-origin
 * POST/PUT/PATCH/DELETE, so this is reliable.
 */
export function assertSameOrigin(c: Context<AppEnv>): void {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const allowed = new Set<string>();
  allowed.add(getOrigin(c));
  const configured = c.env.APP_BASE_URL?.replace(/\/$/, '');
  if (configured) allowed.add(configured);
  // Behind Cloudflare, x-forwarded-host/proto describe the public origin.
  const fwdHost = c.req.header('x-forwarded-host');
  const fwdProto = c.req.header('x-forwarded-proto') ?? 'https';
  if (fwdHost) allowed.add(`${fwdProto}://${fwdHost}`);

  const origin = c.req.header('origin') ?? c.req.header('referer');
  if (!origin) {
    throw new ApiError(403, 'csrf_missing_origin', 'درخواست از منبع نامعتبری آمده است');
  }
  let originHost: string;
  try {
    originHost = new URL(origin).origin;
  } catch {
    throw new ApiError(403, 'csrf_invalid_origin', 'منبع درخواست معتبر نیست');
  }
  if (!allowed.has(originHost)) {
    throw new ApiError(403, 'csrf_origin_mismatch', 'منبع درخواست با این برنامه هم‌خوانی ندارد');
  }
}

export function handleError(err: unknown, exposeDetail = false): Response {
  if (err instanceof ApiError) {
    return json(
      { error: { code: err.code, message: err.message, fields: err.fields } },
      err.status,
    );
  }
  console.error('Unhandled error', err);
  const isDb = err instanceof Error && /D1_ERROR|no such table|constraint|SQLITE/i.test(err.message);
  const message = isDb
    ? 'خطای پایگاه داده رخ داد'
    : 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.';
  return json(
    {
      error: {
        code: 'internal_error',
        message,
        // Development only — never leak internals in production.
        ...(exposeDetail && err instanceof Error ? { detail: err.message } : {}),
      },
    },
    500,
  );
}

/**
 * Content-Security-Policy for the SPA.
 *
 * Deliberately strict: no inline scripts (Vite emits none in the production
 * build), no third-party origins except the TMDB image CDN. `'unsafe-inline'` is
 * allowed for styles only — React applies inline style props through CSSOM, but
 * keeping it avoids breaking any future style injection without weakening script
 * isolation, which is what actually matters for XSS.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://image.tmdb.org",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(env?: { ENV?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (env?.ENV === 'production') {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}
