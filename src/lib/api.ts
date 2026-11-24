/** Typed API client. All requests are same-origin, cookie-authenticated, and JSON. */

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  get isOffline(): boolean {
    return this.code === 'offline' || this.status === 0;
  }
}

export class OfflineError extends ApiError {
  constructor() {
    super(0, 'offline', 'به اینترنت متصل نیستید. تغییرات شما ذخیره شده و بعد از اتصال ارسال می‌شود.');
    this.name = 'OfflineError';
  }
}

const NETWORK_MESSAGES: Record<number, string> = {
  0: 'ارتباط با سرور برقرار نشد',
  400: 'درخواست معتبر نیست',
  401: 'برای این کار باید وارد حساب شوید',
  403: 'اجازه‌ی انجام این کار را ندارید',
  404: 'مورد موردنظر پیدا نشد',
  409: 'این مورد قبلاً ثبت شده است',
  429: 'درخواست‌های شما بیش از حد مجاز است. کمی صبر کنید',
  500: 'خطای داخلی سرور',
  502: 'سرویس خارجی در دسترس نیست',
  503: 'این سرویس هنوز پیکربندی نشده است',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the automatic offline check (used by the sync replayer). */
  raw?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const { body, headers, signal, raw } = options;

  if (!raw && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineError();
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      signal,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new OfflineError();
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorBody = parsed as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
    const code = errorBody?.error?.code ?? 'http_error';
    const message = errorBody?.error?.message ?? NETWORK_MESSAGES[response.status] ?? 'خطایی رخ داد';
    throw new ApiError(response.status, code, message, errorBody?.error?.fields);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE', body }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'خطای غیرمنتظره‌ای رخ داد';
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? (err.fields ?? {}) : {};
}
