# TECHNICAL_ARCHITECTURE — My Media Universe

**Stack:** React 19 + Vite 6 + Tailwind 3 (SPA/PWA) · Hono on Cloudflare Workers · Cloudflare D1 (SQLite) · TMDB API · Google Drive API · Resend
**Cost:** $0 — free tiers only. See `COSTS_AND_LIMITS.md`.

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│  React 19 SPA (dist/client, served as static assets by the Worker)     │
│  TanStack Query cache ──► src/lib/api.ts ──► fetch('/api/*', cookie)   │
│  IndexedDB: response cache  +  pending-write queue                     │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS, same-origin, HttpOnly cookie
┌───────────────────────────────▼───────────────────────────────────────┐
│  Cloudflare Worker (worker/index.ts)                                  │
│  ├─ static assets (ASSETS binding)                                    │
│  ├─ security headers + CSRF origin check on /api/*                    │
│  ├─ idempotency middleware (sync_ops)                                 │
│  ├─ /api/auth        /api/admin      /api/library                     │
│  ├─ /api/collections /api/stats      /api/tmdb                        │
│  ├─ /api/backup       /api/account   /api/health                      │
│  └─ scheduled(): daily Drive backup                                   │
└───────┬───────────────────────────────┬───────────────────────────────┘
        │                               │
   Cloudflare D1                 External APIs
   (SQLite, 18 tables)           TMDB · Google Drive · Resend
```

---

## 1. Repository layout

```
migrations/0001_init.sql     D1 schema (18 tables)
migrations/0002_watch_event_spoiler.sql   adds watch_events.is_spoiler
worker/
  index.ts                   App composition, security headers, CSRF, idempotency, cron
  env.ts                     Env bindings (D1, ASSETS, secrets, vars)
  lib/crypto.ts              SHA-256, base64url, AES-GCM, constant-time compare, recovery key
  lib/http.ts                ApiError, json/readJson, assertSameOrigin, security headers
  lib/rate-limit.ts          D1 fixed-window limiter
  lib/mailer.ts              Resend client (dev fallback: logs the message)
  lib/mappers.ts             row → API object
  lib/constants.ts           status labels, limits, sort modes (shared with client)
  auth/service.ts            sessions, guards (requireUser/Verified/Admin), limits
  auth/routes.ts             bootstrap, register, login, logout, verify, reset, recovery, prefs
  routes/library.ts          library CRUD, ratings, watch events, episodes
  routes/collections.ts      categories, lists, memberships
  routes/stats.ts            aggregates (all in SQL, single round-trip)
  routes/tmdb.ts             proxy to TMDB (server-side key)
  routes/backup.ts           Drive connect/callback, backups, restore
  routes/account.ts          export, import, delete account
  routes/admin.ts            invitations, overview
  services/tmdb.ts           localized fetch + D1 cache + normalisation
  services/drive.ts          OAuth PKCE, token encryption, upload/download
  services/backup.ts         canonical backup document + validation
src/
  app.tsx                    Router
  pages/*.tsx                9 files → 20 route patterns (auth, app, admin, 404)
  components/ui/*            Button, Field, Modal, Dropdown, Rating, DatePicker, TagInput
  components/layout/         AppShell (sidebar / mobile header + bottom nav)
  components/media/          PosterCard
  hooks/                     useAuth, useTheme, useOnline, useToast, useLibrary, useOfflineAction
  lib/                       api, auth, idb, sync, query, images, write
  shared/                    types, ratings, jalali, constants  ← imported by BOTH client and Worker
  index.css                  design tokens + component classes
public/                      PWA manifest, icons, service worker, fonts
tests/                       Vitest suites (shared / client / worker)
scripts/                     smoke-test.mjs, reset-local-db.sh
```

`src/shared/` is the contract layer: everything there must be dependency-free and
isomorphic. The Worker imports it directly; Vite bundles it into the client.

## 2. Request lifecycle

1. **Static assets.** `wrangler.jsonc` binds `dist/client` as `ASSETS` with `not_found_handling: single-page-application` and `run_worker_first: ["/api/*"]`. Everything not under `/api` is served as a static file.
2. **Security headers.** Two sources, kept in sync: `public/_headers` for everything
   served as a static asset (the SPA shell, JS, CSS, fonts, icons) and
   `worker/lib/http.ts → securityHeaders(c.env)` for `/api/*` responses. Both set a
   strict `Content-Security-Policy` (`default-src 'self'`, `script-src 'self'`,
   `frame-ancestors 'none'`, no `unsafe-eval`), `Referrer-Policy`,
   `X-Content-Type-Options`, `Permissions-Policy`, `X-Frame-Options`, and HSTS in
   production.
3. **CSRF.** For non-GET `/api/*`, `assertSameOrigin` requires an `Origin` (or `Referer`) equal to the request origin, `APP_BASE_URL`, or `x-forwarded-host`+`proto`. Missing → `csrf_missing_origin` (403), foreign → `csrf_origin_mismatch` (403). Since the session cookie is `SameSite=Lax` and every write is JSON, this closes the classic CSRF path.
4. **Idempotency.** A non-GET with an `Idempotency-Key` (8–128 chars) is looked up in `sync_ops (user_id, op_id)`. A hit replays the stored status and body with `idempotent-replay: true`. After a successful (<500) response, the pair is stored. Rows older than 7 days are pruned probabilistically.
5. **Auth.** `authenticate(c)` hashes the cookie token with SHA-256 and joins `sessions` → `users`. Guards: `requireUser`, `requireVerifiedUser`, `requireAdmin`. The user id comes **only** from the session — never from the request body or query string.
6. **Validation.** Every body goes through Zod (`readJson`). Failures return 422 with `error.fields`.
7. **Errors.** `ApiError(status, code, persianMessage, fields?)`; `app.onError` maps unknown errors to a generic Persian message and logs the original server-side.

## 3. Data model (D1)

```
users(id, username, username_normalized UNIQUE, email, email_normalized UNIQUE,
      email_verified_at, password_hash, password_salt, password_algo,
      recovery_key_hash, recovery_key_updated_at, role, preferences JSON, timezone,
      invited_by, disabled_at, created_at, updated_at)

sessions(id, user_id → users, token_hash UNIQUE, user_agent, ip, created_at,
         last_seen_at, expires_at, revoked_at)

invitations(id, code_hash UNIQUE, code_hint, created_by → users, email_hint,
            max_uses, use_count, note, expires_at, revoked_at, used_by → users,
            used_at, created_at)

email_tokens(id, user_id → users, purpose 'verify_email'|'reset_password'|'recovery_session',
             token_hash UNIQUE, expires_at, used_at, created_at)

rate_limits(key PK, count, window_start)

media_items(id, user_id → users, source 'tmdb'|'manual', tmdb_id, kind 'movie'|'series',
            is_anime, title, original_title, overview, overview_en, poster_path,
            backdrop_path, custom_poster_data, release_date, year, genres JSON,
            runtime_minutes, country, language, director, cast_list JSON, status,
            rating_method 'direct'|'criteria', rating_direct, criteria JSON,
            rating_final, final_series_rating, notes, quotes JSON, is_spoiler,
            tags JSON, watch_date, favorite, added_at, updated_at, removed_at)

episodes(id, user_id → users, media_item_id → media_items, tmdb_episode_id,
         season_number, episode_number, name, original_name, overview, still_path,
         air_date, runtime_minutes, watched, rating_method, rating_direct,
         criteria JSON, rating_final, notes, quotes JSON, tags JSON, is_spoiler,
         watch_date, added_at, updated_at;
         UNIQUE (user_id, media_item_id, season_number, episode_number))

seasons(id, user_id → users, media_item_id → media_items, tmdb_season_id,
        season_number, name, overview, poster_path, air_date, episode_count,
        added_at, updated_at; UNIQUE (user_id, media_item_id, season_number))

watch_events(id, user_id → users, media_item_id → media_items, episode_id → episodes,
             watched_at, rating, rating_method, criteria JSON, notes, quotes JSON,
             created_at, is_spoiler)          -- is_spoiler added by migration 0002;
                                               -- append-only: rewatch history is never overwritten

categories(id, user_id → users, name, color, icon, sort_order, created_at, updated_at;
           UNIQUE (user_id, name))

category_items(category_id → categories, media_item_id → media_items, added_at;
               PK (category_id, media_item_id))

lists(id, user_id → users, name, description, sort_mode 'manual'|'rating'|'date'|'title',
      is_watchlist, created_at, updated_at)   -- one watchlist per user (unique partial index)

list_items(list_id → lists, media_item_id → media_items, position REAL, added_at;
           PK (list_id, media_item_id))

sync_ops(user_id → users, op_id, method, path, status_code, response, created_at;
         PK (user_id, op_id))                 -- idempotency replay for the offline queue

tmdb_cache(cache_key PK, body, fetched_at, expires_at)

google_connections(user_id PK → users, google_account_id, google_email,
                   access_token_enc, refresh_token_enc, access_expires_at, scope,
                   folder_id, created_at, updated_at)

backups(id, user_id → users, drive_file_id, name, size_bytes, schema_version,
        item_count, kind 'manual'|'auto', created_at)

oauth_states(state PK, user_id → users, code_verifier, expires_at)
```

Design notes:

- **No client-supplied `user_id`.** Every owned table carries `user_id` and every query filters on it. `tests/worker/ownership.test.ts` asserts this by recording the SQL the Worker emits.
- **Ratings are stored twice by design:** `criteria` (the raw map) and `rating_final` (the resolved score). The resolved value is what statistics index; the map is what the UI edits. Both are written in the same statement.
- **JSON columns** (`genres`, `cast_list`, `criteria`, `quotes`, `tags`, `preferences`) are typed as `TEXT` and parsed through `parseArray`/Zod on read. D1 has no JSON type; this keeps the schema simple and the queries indexable.
- **Soft delete** (`removed_at`) for media items so an accidental delete is recoverable from a backup without a tombstone table.

## 4. Rating computation

`src/shared/ratings.ts` — pure, isomorphic, unit-tested.

```
resolveScore(method, direct, criteria)
  method === 'direct'    → snap(direct)
  method === 'criteria'  → averageOf(Object.values(criteria))   // only rated ones
  nothing rated          → null
seasonScore  = averageOf(rated episodes in that season)
seriesScore  = averageOf(rated episodes across all seasons)
coverage     = ratedEpisodes / totalEpisodes
```

Statistics read `rating_final` (movies, episodes, watch events) and
`final_series_rating` (the optional independent verdict). They never recompute
from criteria, so a criteria edit is always reflected by the same write that
stored it.

## 5. TMDB integration

- **Key** lives only in the Worker (`TMDB_API_KEY`); the client calls `/api/tmdb/*`.
- **Persian first:** `tmdbLocalized` requests `language=fa-IR`, then fills blank
  fields (`overview`, `tagline`, title) from `language=en-US`. The English
  overview is kept as `overview_en` and offered as a toggle.
- **Cache:** `tmdb_cache` table keyed by path+params, TTL 6 h for details, 20 min
  for search, 24 h for genres/config. TMDB's terms cap caching at 6 months; the
  app stays far below that.
- **Normalisation:** the raw TMDB payload is typed as `TmdbRaw` and mapped once
  into the app's own `TmdbSearchResult` / detail types, so the UI never binds to
  TMDB's field names.
- **Rate limit:** one upstream call per client request, `Promise.all` only for
  parallel movie+TV search. HTTP 429 is retried once after `Retry-After`.
- **Images** are hot-linked from `image.tmdb.org` at `w342`/`w780`/`original`.
  Nothing is downloaded into D1 or the repository (terms + storage budget).
- **Attribution:** footer line in the shell, plus the TMDB logo in Settings.

## 6. Google Drive integration

- **Scope:** `drive.file` only — the app can see files it created, never the whole Drive.
- **Flow:** `POST /api/backup/google/connect` → OAuth 2.0 **PKCE (S256)** with a
  hashed `state` (10 min) → `GET /api/backup/google/callback` → token exchange →
  encrypted storage → redirect to `/settings?google=connected`.
- **At rest:** access and refresh tokens are AES-GCM encrypted with
  `ENCRYPTION_KEY` (32-byte base64). The key is a Worker secret; it never reaches
  the client, logs or repository.
- **Folder:** a dedicated folder named from `GOOGLE_DRIVE_FOLDER_NAME` is created
  on first use and its id stored on the connection.
- **Uploads:** multipart upload of the canonical backup JSON; the 25 newest files
  are kept, older ones deleted.
- **Restore:** `GET /api/backup/:id/preview` downloads and validates without
  writing; `POST /api/backup/:id/restore` applies merge or replace.
- **Failure modes:** `google_not_configured` (503), `google_callback_failed`,
  `backup_too_new`, `backup_invalid`. The UI never shows a green checkmark unless
  the Worker confirmed an upload.

> ⚠️ The OAuth round-trip has not been exercised against a real Google account in
> this build environment. See `PROJECT_STATE.md` §3.

## 7. Sync and offline

```
write → optimistic cache update → apiRequest(idempotency-key)
        ├─ 2xx      → invalidate queries
        ├─ offline  → enqueue in IndexedDB → toast "در انتظار ارسال"
        └─ 4xx/5xx  → rollback + error toast

online again → flush queue in order → replay with the same key
             → 2xx: remove from queue
             → 4xx: move to "needs attention" (never silently dropped)
```

- **Revalidation:** `refetchOnWindowFocus` + `online` event + manual Sync Now.
- **Read cache:** the *dehydrated query cache* (successful queries only) is written
  to IndexedDB under the key `react-query-cache-v1`, debounced 900 ms, capped at
  4 MB and discarded after 14 days. `src/main.tsx` **awaits hydration before the
  first render**, so an offline reload of `/item/:id` renders the app instead of
  bouncing to `/login`. (`cacheSet` already wraps the payload as `{state, savedAt}` —
  the call site must not wrap it again; that bug silently produced an empty cache.)
- **Write queue:** `queue` store, one row per pending write with a stable client id,
  replayed in order with the same `Idempotency-Key`.
- **Conflict policy:** last-write-wins at the field level, because the owner is a
  single person on a few devices. A watch event is append-only, so the only
  conflicting writes are edits to the same field — and those are idempotent.
- **No realtime.** Deliberate; see `DECISIONS.md` ADR-006.

## 8. Build & deployment shape

| Concern | Choice |
| --- | --- |
| Client bundle | Vite → `dist/client`, code-split per route, fonts self-hosted |
| Server bundle | `wrangler deploy` bundles `worker/index.ts` |
| Assets | Same Worker via `ASSETS` binding (one origin, no CORS, no separate Pages project) |
| Database | Single D1 database `mmu-db`, migrations in `migrations/` (2 applied) |
| Secrets | `wrangler secret put` — never in `wrangler.jsonc`, never in Git |
| Cron | `17 3 * * *` → `scheduled()` → automatic backups |
| Observability | `observability.enabled = true` (Workers Logs, free tier) |

## 9. Performance budget

| Item | Budget | Actual |
| --- | --- | --- |
| Initial JS | < 150 kB gzip | 127 kB gzip (`index`) + 26 kB (`react`) + 11 kB (`query`) |
| CSS | < 15 kB gzip | 9.4 kB gzip |
| Fonts | self-hosted, subset | Vazirmatn woff2, 16–22 kB per weight, `font-display: swap` |
| Worker CPU | < 10 ms free tier | auth ≈ 1–3 ms (PBKDF2 is client-side) |
| D1 queries | < 50 per invocation | detail ≈ 4, list ≈ 2, stats ≈ 3 |
| Images | lazy, `decoding=async`, fixed aspect box | poster 2:3, no layout shift |

## 10. Extension points

- **New media type:** add a `kind` value (migration + `CHECK`), a nav entry, a
  `COLLECTION_META` entry, and a library page variant. `MediaItem.kind` is a union,
  so TypeScript finds every switch for you.
- **New rating criterion:** append to `CRITERIA` in `src/shared/ratings.ts`. The
  schema stores criteria as a JSON map, so no migration is needed.
- **New statistic:** add a query in `worker/routes/stats.ts` and a card in
  `stats-page.tsx`. Keep it in the same request to stay under 50 D1 queries.
- **New backup source:** implement `list/upload/download` against the provider and
  reuse `buildBackupDocument` / `validateBackupDocument` unchanged.
