# DECISIONS — My Media Universe

Architecture decision records. Each one states the context, the decision, the
alternatives that were rejected, and the consequences the owner should know about.

---

## ADR-001 · Custom authentication instead of Clerk

**Status:** accepted (supersedes the "Clerk preferred" line in the original brief)

**Context.** The brief preferred Clerk for authentication. Clerk's free tier caps
at 10 000 monthly active users, requires a session token to be minted on a
domain Clerk controls, and — decisive for a Persian, self-hosted, $0 app — its
hosted widgets render in English by default and inject a third-party script on
every page. The app also needs invite-only registration with single-use codes,
which is not a Clerk primitive.

**Decision.** Build a focused auth system on Workers + D1:
PBKDF2-SHA256 client-side → SHA-256 stored server-side → opaque session cookie.

**Rejected alternatives**

| Option | Why not |
| --- | --- |
| Clerk | English-first widgets, third-party script, invite flow is bespoke anyway, external dependency for a single-user app |
| Auth.js on Workers | Designed for Next.js/Node; needs a KV/DB adapter and brings its own cookie format |
| Supabase Auth | Another account, another dashboard, free tier pauses projects after 7 days of inactivity |
| Password in D1 hashed with bcrypt server-side | bcrypt/argon2 at OWASP strength exceeds the 10 ms Worker CPU budget |

**Consequences.** Full control over the Persian copy, no third-party script, no
user caps — but the auth code is **ours to secure**. See `SECURITY_REVIEW.md`.
Invite-only registration is a first-class feature rather than a workaround.

---

## ADR-002 · PBKDF2 runs in the browser, the Worker stores SHA-256(derived key)

**Status:** accepted, with documented trade-offs

**Context.** OWASP recommends ≥ 600 000 iterations of PBKDF2-SHA256 (or Argon2id).
Cloudflare's free Workers allow **10 ms CPU per request**. A 600k-iteration PBKDF2
takes ~90–250 ms of CPU depending on hardware — 9–25× the budget — and Argon2id is
not available in workerd.

**Decision.** The browser derives `authKey = PBKDF2-SHA256(password, perUserSalt, 600 000, 256 bits)` and sends only `authKey`. The Worker stores `SHA-256(authKey)`.

**Why this is still sound.** A D1 leak exposes a hash of a 256-bit derived key:
offline cracking still costs 600 000 PBKDF2 rounds per guess, exactly the
work factor OWASP's Password Storage Cheat Sheet asks for. The salt is per-user and random (16 bytes), so
rainbow tables and cross-user amortisation are useless.

**What it costs.** The derived key is a **password-equivalent reusable credential**:
anyone who captures it can authenticate until the password changes. That is why
the app forces HTTPS in production, uses `HttpOnly; Secure; SameSite=Lax`
cookies, never logs request bodies, and revokes every session on password change,
reset and recovery. Full analysis in `SECURITY_REVIEW.md`.

**Rejected alternatives**

| Option | Why not |
| --- | --- |
| Server-side PBKDF2 | Exceeds the free CPU budget; would require a paid plan |
| Plain SHA-256(password) | Cracks at billions of guesses per second |
| No password, magic link only | Needs a paid/limited e-mail provider and breaks offline-first goals |

---

## ADR-003 · One Worker serves both the API and the SPA

**Status:** accepted

**Context.** Cloudflare Pages (500 builds/month) and Workers Static Assets are both
free. Splitting the app across two origins would require CORS, a second deploy
pipeline, and cross-site cookies.

**Decision.** `wrangler.jsonc` binds `dist/client` as `ASSETS` on the same Worker
that serves `/api/*` (`run_worker_first: ["/api/*"]`, SPA fallback).

**Consequences.** One origin → the session cookie is first-party, CSRF reasoning is
simple, one `wrangler deploy` ships everything. Static assets are free and
uncached-billed on Workers.

**Rejected.** Pages + separate Worker (CORS + cookie complexity), or serving the
SPA from D1/R2 (wrong tool).

---

## ADR-004 · D1 for rate limiting, not KV

**Status:** accepted

**Context.** KV's free tier allows only **1 000 writes/day** — a login limiter alone
would exhaust it. D1 allows 100 000 rows written/day.

**Decision.** A `rate_limits` table with an atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING count` fixed window.

**Consequences.** One write per check on sensitive endpoints only (auth, invites),
well inside the free tier. Stale rows are pruned probabilistically. If the app
ever needs per-account rather than per-IP limits, the key gains a user id — no
schema change.

**Rejected.** KV (write quota), Durable Objects (paid-only for state), in-memory
(Workers are stateless across isolates).

---

## ADR-005 · One canonical backup document

**Status:** accepted

**Context.** Drive backup, portable export and import must agree byte-for-byte on
shape, or a restore silently loses data.

**Decision.** `worker/services/backup.ts` owns `buildBackupDocument` and
`validateBackupDocument`; `src/shared/types.ts` owns the `BackupSummary` type.
Every producer and consumer goes through them.

**Consequences.** Adding a field means editing one schema and one builder. A
`schemaVersion` guard rejects newer files (`backup_too_new`) instead of
half-importing them. Unknown keys are preserved (`passthrough`) so a restore into
an older build does not strip future data.

---

## ADR-006 · No realtime sync

**Status:** accepted

**Context.** The brief asked for sync but explicitly forbade "unreliable fake
realtime". Real realtime needs WebSockets (Durable Objects — paid) or polling
(burns the 100 k/day request budget for a single-user app).

**Decision.** Server-authoritative sync with revalidation on focus/online + manual
Sync Now + an idempotent offline queue. No websockets, no polling loop.

**Consequences.** Two tabs open at once can show stale data for a few seconds
until focus triggers a refetch. That is honest and cheap; a fake "live" badge
would be neither.

---

## ADR-007 · Anime is a flag, not a media kind

**Status:** accepted

**Context.** TMDB has no anime type; anime is TV (or a movie) with the Animation
genre plus an Asian origin.

**Decision.** `kind IN ('movie','series')` plus `is_anime INTEGER`. A heuristic
(`looksLikeAnime`) sets the flag, the owner can override it per item.

**Consequences.** One code path for search, details, seasons and episodes; the
Anime page is a filtered view, not a duplicate implementation. Adding a real new
type later (books) stays a clean `kind` extension.

**Rejected.** A third `kind = 'anime'` — would duplicate every TV query and break
"add an anime movie".

---

## ADR-008 · TMDB images are hot-linked, never stored

**Status:** accepted

**Context.** TMDB's terms require attribution and forbid long-lived local caching
of their data; storing posters would also blow the D1 5 GB / 500 MB-per-database
budget quickly.

**Decision.** Store only the path (`/abc.jpg`) and build URLs at render time
against `image.tmdb.org`. A missing poster renders a styled placeholder.

**Consequences.** Posters need network on first view (cached by the browser after
that). Offline mode shows placeholders for uncached images — acceptable and
honest. No copyright exposure from redistributing artwork.

---

## ADR-009 · ISO dates in the database, Jalali in the UI

**Status:** accepted

**Context.** The owner thinks in the Persian calendar; SQL, sorting and TMDB all
speak Gregorian.

**Decision.** Every date is stored as `YYYY-MM-DD` (ISO) or an epoch-ms integer.
`src/shared/jalali.ts` converts for display and for the picker.

**Consequences.** Range filters and ordering stay trivial and index-friendly.
The conversion table is unit-tested (18 cases, including the 1403/1408 leap years
and the `Math.trunc` vs `Math.floor` regression that produced ۱۴۰۵/۱۲/۰۳ instead
of ۱۴۰۵/۱۲/۱۳).

---

## ADR-010 · Hono as the Worker framework

**Status:** accepted

**Context.** Options: Hono, itty-router, or raw `fetch`.

**Decision.** Hono — typed context, `createMiddleware`, Zod-friendly helpers,
first-class Workers support, ~14 kB.

**Consequences.** Route files are small and typed (`Hono<AppEnv>`). One caveat
worth remembering: Hono's `setCookie()` writes into a response-guarded `Headers`
object where `Set-Cookie` is a silent no-op — the app builds the header itself
(`worker/auth/service.ts`).

---

## ADR-011 · Idempotency keys for every write

**Status:** accepted

**Context.** An offline queue retries requests. A retried `POST /watch` without a
key would create a duplicate watch event — exactly the "silently overwrite
history" failure the brief forbids.

**Decision.** The client generates a UUID per logical operation and sends it as
`Idempotency-Key`. The Worker stores `(user_id, op_id) → response` in `sync_ops`
and replays it.

**Consequences.** Retries are safe by construction. Cost: one indexed insert per
write and a 7-day pruning window.

---

## ADR-012 · Soft delete for media items

**Status:** accepted

**Context.** A mis-tapped delete on a 200-episode series should not be irreversible.

**Decision.** `removed_at` is set instead of `DELETE`. All list queries filter
`removed_at IS NULL`. A dedicated purge path exists for account deletion.

**Consequences.** Rows linger until the account is deleted — negligible for one
user. A restore from backup can resurrect an item that was deleted minutes ago.

---

## ADR-013 · Vazirmatn, self-hosted

**Status:** accepted

**Context.** Persian UI needs a proper Persian typeface. Google Fonts is a
third-party request and a privacy leak.

**Decision.** `@fontsource/vazirmatn`, bundled by Vite, `font-display: swap`.

**Consequences.** ~90 kB of woff2 across four weights, cached by the service
worker. No external font request, no layout shift after first paint.
