# PROJECT_STATE

**Last updated:** 2026-11-24
**Branch:** `arena/08ec0aef-my-media-universe` (off `main` @ `688cfed`)
**Status:** Feature-complete for v1. All quality gates green. Three integrations remain unverified against live third-party accounts.

---

## INSTRUCTIONS FOR THE NEXT AI AGENT

Read this section before touching anything.

1. **Do not re-scaffold.** The app is complete and working. The stack is React 19 + Vite 6 + Tailwind 3 (client) and Hono on Cloudflare Workers + D1 (server). `npm install` then `npm run dev` is all it takes to run it. Do not migrate to Next.js, a different ORM, or a paid service.
2. **Run the gates before and after every change:**
   ```bash
   npm run typecheck   # tsc, client + worker, must be 0 errors
   npm run lint        # eslint, must be 0 warnings (max-warnings 0)
   npm test            # vitest, 80 tests
   npm run build       # vite build
   npm run smoke       # 31 API checks — needs `npx wrangler dev --port 8787 --local` running
   ```
   `npm run smoke` clears the local `rate_limits` table first when it targets `127.0.0.1`, so repeated runs do not trip the brute-force limiter. Never "fix" a failing test by deleting it.
3. **Never fake a success state.** If TMDB, Google Drive or e-mail is not configured, the UI must say so in Persian. That behaviour is intentional and tested by hand. Do not add mock data to make a screenshot look nicer.
4. **Auth is custom and documented.** Do not swap it for Clerk/Auth.js without reading `docs/DECISIONS.md` (ADR-002) and `docs/SECURITY_REVIEW.md` first. The password KDF runs **client-side on purpose** (Cloudflare's 10 ms CPU limit). Any change must keep: server-side authorisation, hashed session tokens, HttpOnly cookies, constant-time comparison, invite-only registration.
5. **Schema changes go in `migrations/`.** Never edit `0001_init.sql` after it has been applied to a database you care about; add `0002_*.sql`. Keep `SCHEMA_VERSION` in `src/shared/constants.ts` in sync with `worker/services/backup.ts` so old backups are rejected instead of half-imported.
6. **TMDB images are hot-linked, never downloaded** into the database or the repo. The API key stays server-side (`TMDB_API_KEY` in `.dev.vars` / `wrangler secret`), never in `src/`.
7. **Budget is exactly $0.** Before adding any service, check its free tier in `docs/COSTS_AND_LIMITS.md`. No credit cards, no "free trial that converts", no paid plugins.
8. **Persian, RTL, non-programmer owner.** All user-facing strings are Persian. Never ask the owner to run a command that a script could run. When a manual step is unavoidable, write exact clicks with official URLs (`docs/SETUP_GUIDE.md`).
9. **Where things live:**
   - Pages: `src/pages/*.tsx`; shell/nav: `src/components/layout/app-shell.tsx`
   - Design tokens: `src/index.css` (`--c-canvas`, `--c-surface`, `--c-accent`, …) and `tailwind.config.js`
   - API client + offline queue: `src/lib/{api,sync,idb,write}.ts`
   - Worker routes: `worker/routes/*.ts`; auth: `worker/auth/*.ts`; services: `worker/services/*.ts`
   - Shared (isomorphic) code: `src/shared/{types,ratings,jalali,constants}.ts` — imported by both client and Worker
10. **Before declaring anything done:** run the gates, open the page in a browser at 1366×900 *and* 390×844, check both themes, and update the "Verified / Not verified" tables below plus `CHANGELOG.md`.

### Known traps (do not rediscover these)

- **Never run `npm run db:reset:local` while `wrangler dev` is running** — it deletes
  `.wrangler/state` out from under the dev server and every query then fails with
  `SQLITE_CANTOPEN`. Stop the server, reset, start it again.
- Rebuilding `dist/client` while `wrangler dev` runs can leave the asset binding
  stale (every route returns the Worker's `Not found`). Restart `wrangler dev`.

- `Set-Cookie` must be appended to a **fresh `Headers`** and passed to `new Response()`. Hono's `setCookie()` on a response-guarded `Headers` silently drops the cookie. See `sessionCookieValue()` / `attachSessionCookie()` in `worker/auth/service.ts`.
- Vite's dev proxy must set `x-forwarded-proto: http` for `localhost`, otherwise the `Secure` cookie breaks local login (`vite.config.ts`).
- `Intl.NumberFormat('fa-IR')` inserts thousands separators (۱٬۴۰۵). Use `toPersianDigits()` from `src/shared/jalali.ts` for years and dates.
- A `linear-gradient(90deg, …)` fills an RTL range slider from the wrong end; use `to left`.
- `.ltr` is `direction: ltr; unicode-bidi: isolate` only — do not add `text-align` there; put `text-start` on the specific input instead.
- The SQL column is `cast_list`, not `cast` (reserved word in SQLite).
- Deleting from `users` directly violates FKs; use `npm run db:reset:local`.
- Headless screenshots need `LD_LIBRARY_PATH=/tmp/al2023/lib` with the Chromium build from `@sparticuz/chromium` (see `docs/TEST_PLAN.md`).

---

## 1. What exists

### Pages (11, all routed in `src/app.tsx`)

| Route | Page | Verified in browser |
| --- | --- | --- |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/recover`, `/setup`, `/verify` | Auth flows | ✅ |
| `/` | Home (continue watching, recent activity, quick actions) | ✅ |
| `/movies`, `/series`, `/anime` | Library per kind, filters, sort, search, pagination | ✅ |
| `/item/:id` | Item detail: hero, criteria rating, direct rating, final series rating, seasons/episodes, watch events, notes, quotes, spoilers, categories, lists, edit, delete | ✅ |
| `/search` | TMDB search + **manual add** (title, original title, type, poster upload, year, description, genres, runtime) | ✅ (manual add verified; TMDB live search unverified) |
| `/lists`, `/lists/:id` | Personal lists, watchlist, reorder, description, sort, multi-membership, safe delete | ✅ |
| `/stats` | Statistics with range switcher | ✅ |
| `/settings` | Profile, theme, recovery key, password, e-mail, sessions, Google Drive, backups, export/import, account deletion | ✅ |
| `/admin/invitations` | Admin: create/revoke invitations, overview | ✅ |

### Server

- 8 route groups under `/api/*` (`auth`, `admin`, `library`, `collections`, `stats`, `tmdb`, `backup`, `account`) plus `/api/health`.
- D1 schema in `migrations/0001_init.sql` (21 tables, indexed on every user-scoped query path) plus `0002_watch_event_spoiler.sql`.
- CSRF: every non-GET `/api/*` request must carry an `Origin` matching the request origin, `APP_BASE_URL`, or `x-forwarded-host`; otherwise 403.
- Idempotency: non-GET requests with an `Idempotency-Key` are replayed from `sync_ops` (offline queue safety).
- Rate limiting: D1 fixed windows on `bootstrap`, `register`, `login`, `resend`, `forgot`, `reset`, `recovery`, `recovery-complete`.
- Cron: `wrangler.jsonc` → `triggers.crons = ["17 3 * * *"]` → daily Drive backup for users who opted in.

### Data & sync

- Server is the source of truth. Client keeps an IndexedDB mirror of library/detail/meta.
- Writes go through `src/lib/write.ts`: optimistic update → request → rollback on failure.
- Offline writes are queued in IndexedDB with a client-generated id and replayed with `Idempotency-Key`; permanent 4xx failures move to a "needs attention" list, never silently dropped.
- `visibilitychange`/`focus` triggers revalidation; the sidebar shows pending count and a manual **Sync Now**.

---

## 2. Verified — exact results (2026-11-24)

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript (client) | `npx tsc -p tsconfig.json --noEmit` | **0 errors** |
| TypeScript (worker) | `npx tsc -p tsconfig.worker.json --noEmit` | **0 errors** |
| Lint | `npm run lint` | **0 errors, 0 warnings** |
| Unit/integration | `npm test` | **80 passed / 80** (7 files) |
| Build | `npm run build` | ✅ `index` 455 kB (127 kB gzip), CSS 46.9 kB |
| API end-to-end | `npm run smoke` | **31 / 31 passed** |
| Visual | headless Chromium, 1366×900 and 390×844, dark + light | ✅ no console errors on the checked pages |
| CSP | `curl -I /` against the Worker | ✅ `default-src 'self'`, no CSP violations in the browser |
| Cron handler | `curl /cdn-cgi/local/scheduled` | ✅ executes locally (no-op with no Drive connections) |
| Offline read | Playwright `setOffline(true)` + reload on `/item/:id` | ✅ page renders from the IndexedDB cache, no redirect to login |
| Offline write | offline → change status → reconnect | ✅ toast says "بعد از اتصال ارسال می‌شود", sidebar shows "آفلاین · ۱ در انتظار ارسال", write applied after reconnect |
| Spoiler hiding | DOM inspection before reveal | ✅ spoiler text absent from `document.body.innerText` until revealed |

Test files:

```
tests/shared/ratings.test.ts          17   rating math, unrated ≠ 0, 0.5 steps, coverage
tests/shared/jalali.test.ts           18   Jalali↔Gregorian round-trips, leap years, trunc-vs-floor regression
tests/client/auth.test.ts              8   KDF vector, recovery-key entropy/shape, password policy, anime heuristic
tests/worker/backup-validation.test.ts  9   schema validation, caps, passthrough, spoiler flag, too-new rejection
tests/worker/security-helpers.test.ts  17   hashing, normalisation, AES-GCM at rest, CSRF matrix, CSP + HSTS
tests/worker/auth-guards.test.ts       8   requireUser/requireVerifiedUser/requireAdmin, token hashing
tests/worker/ownership.test.ts         3    401 without session, 403 for member→admin, every owned-table query scoped by user_id
```

Smoke suite (`scripts/smoke-test.mjs`, 31 checks): bootstrap admin → invitation → register →
verify e-mail → login → library CRUD → criteria/direct/final ratings → watch events →
episodes → categories → lists → stats → export → **cross-user isolation (403 + filtered list)** →
invalid invitation rejected → single-use invitation rejected on reuse.

---

## 3. Not verified — be honest about these

None of these are "broken"; they are **untested because no credentials exist in the build environment**. Each fails with a clear Persian message rather than pretending to work.

| Integration | State | What is needed to verify |
| --- | --- | --- |
| **TMDB live API** | Code complete, unit-typed, cache in D1; **never called with a real key** | `TMDB_API_KEY` in `.dev.vars` → search a title → add to library → check poster/backdrop render and the attribution line |
| **Google Drive** | OAuth PKCE, `drive.file`, AES-GCM token storage, upload/download, restore preview, 25-version rotation; **never run against a real Google account** | Create an OAuth client (Desktop type) in Google Cloud Console, set `GOOGLE_CLIENT_ID/SECRET`, click connect, upload, restore |
| **Production e-mail** | Resend integration; in dev the message is logged instead; **never sent through Resend** | `RESEND_API_KEY` + verified `EMAIL_FROM` domain, then register and confirm delivery |
| **PWA install prompt** | Manifest + service worker + icons ship and register; **install prompt not clicked on a real Android device** | Open on Android Chrome → "Add to Home screen" |
| **Cron** | Handler + `triggers.crons` configured; **never fired on a deployed Worker** | Deploy, opt in to auto-backup, inspect `wrangler tail` at 03:17 UTC |

Do not report these as working in a delivery message until they have been exercised.

---

## 4. Remaining work (ordered)

1. **Owner-side verification of the four integrations above** (30–45 min of clicking; guide in `docs/SETUP_GUIDE.md`).
2. **Production deploy** — `docs/DEPLOYMENT_GUIDE.md` walks through `wrangler d1 create`, migrations, secrets, `wrangler deploy`, custom domain.
3. **Security review follow-ups** listed in `docs/SECURITY_REVIEW.md` §"Open items": session-binding hardening, optional WebAuthn passkey, per-account (not per-IP) login throttling.
4. **Nice to have:** CSV export alongside JSON, "share a list" read-only link (public token), K drama/animation type split, per-episode thumbnail strip, drag-and-drop list reorder on desktop (currently up/down buttons).
5. **Future media types** (books, games, music) — the schema uses `kind` + `is_anime`; adding a type means a new `kind` value, a migration default, a nav entry and a library page variant. Nothing else in the data model changes.

---

## 5. Known issues / accepted trade-offs

- **Password KDF runs in the browser.** Required by the 10 ms Worker CPU limit. Full analysis, including the "derived key is a reusable credential" risk, in `docs/SECURITY_REVIEW.md`.
- **No real-time sync.** Revalidation on focus + manual sync instead. Deliberate: fake realtime is worse than honest polling.
- **TMDB Persian coverage is incomplete** for older/obscure titles; the app falls back to English per field and shows the English overview toggle.
- **`wrangler dev` logs a TLS warning** on startup in this sandbox (`Request.cf` fetch). Harmless locally.
- **List reorder is button-based** (up/down), not drag-and-drop.
- `navigator.onLine` is `false` while Playwright's offline mode is on, but Chromium
  does not always fire the `offline` event — the write path handles this by
  catching the failed request and queueing it anyway (verified).

---

## 6. Local test fixtures (never use in production)

Local D1 after `npm run db:reset:local` + smoke run:

- Account: `smoke_owner` / `Correct-Horse-9!`
- Seeded library (local only, via `scripts/seed-local.mjs`): بینستار (film, 9.3),
  برکینگ بد (series, 9.5), حمله به تایتان (anime, 9.3) — all with a watch event.
- Each smoke run adds a `friend_*` account with one item, so the database grows
  by one user per run.

`.dev.vars` is gitignored. `.env.example` contains variable names only.
