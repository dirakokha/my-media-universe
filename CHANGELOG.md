# CHANGELOG

All notable changes to **My Media Universe** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); dates are ISO.

---

## [1.0.0] — 2026-11-24

First complete version. Everything below is implemented and verified locally
(80 unit/integration tests, 31 API end-to-end checks, typecheck/lint/build clean).

### Added

**Product**
- Persian RTL interface for the whole app, dark by default with a real light theme
  remembered per user, Vazirmatn self-hosted, Lucide icons only.
- Library for movies, TV series and anime with five statuses, custom categories
  (multi-assign) and personal lists (rename, description, reorder, sort,
  multi-membership, safe delete, system watchlist).
- TMDB search and details with Persian-first metadata and per-field English
  fallback; server-side key only; D1 response cache.
- Manual media creation with poster upload, year, genres, runtime and overview.
- Five-criteria rating engine (0–10 in 0.5 steps), direct-or-criteria scoring,
  season and series averages, episode coverage, independent final series rating.
- Episode tracking with per-episode ratings, notes, quotes and watch dates.
- Viewing journal with spoiler-marked notes, quotes, tags and append-only
  rewatch history.
- Statistics with totals, watch time, averages, extremes, genre distribution,
  Jalali month/year activity, rating distribution, completed series, rated
  episodes, and all-time / this-year / this-month / custom ranges.
- Home page with continue-watching, recent activity and quick actions.
- Admin area for single-use invitations and an overview.

**Accounts**
- Invite-only registration with hashed, expiring, revocable, atomically-consumed
  codes; first-admin bootstrap with a temporary secret.
- E-mail verification (6-digit OTP), password reset, password change, e-mail
  change, session list and global revocation.
- High-entropy recovery key (160 bits) shown once, stored hashed, with a
  10-minute emergency recovery ticket.
- Rate limiting on every sensitive endpoint, constant-time comparison, decoy salt
  to prevent account enumeration.

**Data**
- Cloudflare Workers + D1 backend with 18 tables, migrations and indexed queries.
- Offline support: IndexedDB response cache, optimistic writes with rollback, and
  a pending-write queue replayed with idempotency keys.
- Portable JSON export and import with schema-version guards and size caps.
- Google Drive backup: OAuth 2.0 PKCE, `drive.file` scope, AES-GCM token storage,
  manual and daily-cron backups, 25-version rotation, restore preview and
  merge/replace.
- PWA manifest, service worker and icons; installable on Android and desktop.

**Quality**
- 80 Vitest tests across rating maths, Jalali conversion, KDF parameters, backup
  validation, CSRF, auth guards, security headers and ownership scoping.
- 31-check API smoke suite covering the full user journey including cross-user
  isolation.
- ESLint (flat config, zero warnings), strict TypeScript on both client and
  Worker, production build at 127 kB gzip for the main chunk.
- Strict Content-Security-Policy on static assets and API responses, HSTS in
  production, and `X-Frame-Options`/`Referrer-Policy`/`Permissions-Policy`.
- Documentation set: product spec, architecture, ADRs, Persian setup guide,
  deployment guide, test plan, costs and limits, security review, agent
  instructions.

### Fixed during the final verification pass
- **Offline cache never hydrated.** `cacheSet` already wraps its payload, and the
  persistence layer wrapped it a second time, so every launch restored an empty
  cache and an offline reload bounced to the login page. Fixed, and the cache is
  now hydrated before the first render.
- **Spoiler notes were in the DOM.** They were hidden with `blur-sm` only, which
  is copyable. Spoiler content is now not rendered at all until the reader
  reveals it, and the watch-event spoiler flag (previously collected by the form
  and then dropped) is stored in a new `watch_events.is_spoiler` column
  (`migrations/0002`), preserved through backup/restore, and honoured in the
  viewing history.
- Queued writes were reported as "saved" without saying they were queued.
- The sidebar said «همگام شده» while offline; it now says «آفلاین · N در انتظار ارسال».
- **Light-theme poster placeholders were near-black slabs.** The placeholder
  tint is now theme-driven (`--ph-sat/--ph-l1/--ph-l2` tokens), and the card
  footer scrim and year colour only use the dark scrim when a real poster exists.
  Verified at 1366×900 and 390×844 in both themes.
- **The status switcher clipped its last option on a 390 px viewport.**
  `.segmented` is now horizontally scrollable with narrower mobile padding, so
  all five statuses (including «رها شده») are reachable on a phone.
- **Documentation drifted from the schema.** The table count was stated as 21
  where the migrations create 18 (plus SQLite's internal `sqlite_sequence`), and
  the architecture doc's column list missed `overview_en`, `custom_poster_data`,
  `year`, `country`, `language`, `quotes`, `is_spoiler`, `watch_date` and
  `added_at` while inventing `release_year`, `tmdb_kind`, `created_at` and
  `connected_at`. Both now match `sqlite_master`, and §7 describes the real
  offline mechanism (dehydrated query cache + service-worker shell) instead of a
  per-path response cache.

### Verified in the final pass
- **Service worker:** registers, precaches the shell, and an offline reload
  renders the app (`navigator.serviceWorker.controller === true`, caches
  `mmu-shell-v1-shell` + `mmu-shell-v1-assets`).
- **Mobile layouts at 390×844:** home, library, item, stats, settings, lists.

### Known limitations (documented, not hidden)
- TMDB live API, Google Drive OAuth and production e-mail have **not** been
  exercised against real third-party accounts in the build environment; they fail
  with clear Persian messages instead of pretending to succeed.
- Password KDF runs client-side, so the derived key is a password-equivalent
  credential — analysed in `docs/SECURITY_REVIEW.md` §4.
- No real-time sync (deliberate).
- Backups are plaintext JSON inside the owner's own Drive.

---

## [Unreleased]

### Planned
- Per-account login throttling.
- Client-side encryption of backup documents.
- WebAuthn / passkey sign-in.
- Admin audit log for invitation changes.
- Drag-and-drop list reordering on desktop.
