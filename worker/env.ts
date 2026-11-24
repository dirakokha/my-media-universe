export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** TMDB v4 read access token — server-side only. */
  TMDB_API_KEY?: string;
  TMDB_API_BASE_URL?: string;

  /** Google OAuth (Drive.file scope only). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_FOLDER_NAME?: string;

  /** Public origin of the deployed app, used for OAuth redirects and CSRF checks. */
  APP_BASE_URL?: string;

  /** Base64 32-byte key used to encrypt Google refresh tokens at rest. */
  ENCRYPTION_KEY?: string;

  /** Email delivery (Resend). Optional — without it, development logs codes to the console. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;

  /** One-time secret used to create the first administrator. Remove after use. */
  ADMIN_BOOTSTRAP_SECRET?: string;

  ENV?: string;
  APP_NAME?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    userRole: 'admin' | 'member';
    sessionId: string;
  };
};

export const IS_PRODUCTION = (env: Env): boolean => env.ENV === 'production';
