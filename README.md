# My Media Universe

> کتابخانهٔ شخصی و دفترچهٔ تماشای فیلم، سریال و انیمه — فارسی، راست‌به‌چپ، نصب‌پذیر روی موبایل، با هزینهٔ صفر.

**My Media Universe** is a private, single-owner media library and viewing journal. You search TMDB (or add a title manually), put it in your library, rate it on five criteria, track episodes, write notes and quotes, record every rewatch, and see honest statistics — all in Persian, right-to-left, with a real light/dark theme, offline support, and encrypted Google Drive backups.

It runs entirely on **Cloudflare's free tier** (Workers + D1 + static assets) plus **TMDB** and **Google Drive** free quotas. There is no paid service anywhere in the stack.

---

## What it does

| Area | Details |
| --- | --- |
| **Library** | Movies, TV series and anime; five statuses (Plan to Watch / Watching / Completed / On Hold / Dropped); custom categories; personal lists with reorder, description, sort and safe delete. |
| **Ratings** | Five optional criteria (story, acting, direction/visuals, sound, impact) on a 0–10 scale in 0.5 steps. Score = direct rating **or** the average of only the criteria you actually rated. Unrated is never treated as zero. |
| **Series** | Season and episode pages, per-episode rating/notes/quotes/watch date, rewatch history, automatic season and series averages, "Rated X of Y episodes" coverage, optional independent final series rating. |
| **Journal** | Notes, quotes, tags, spoiler-marked text hidden until reveal, multiple watch events with dates — history is never overwritten. |
| **Statistics** | Totals, watch time, averages, best/worst, genre distribution, monthly/yearly activity, rating distribution, completed series, rated episodes, most active months — with all-time / this-year / this-month / custom ranges. Items without runtime are excluded from time math instead of being guessed. |
| **Auth** | Invite-only registration, e-mail verification, password reset, persistent sessions, one-time recovery key, admin bootstrap, brute-force rate limiting. |
| **Sync** | Server is the source of truth; writes auto-sync, reads are revalidated on focus, IndexedDB cache for offline reading, a pending-write queue with idempotent replay, conflict detection. No fake "success" when a write is only queued. |
| **Backup** | Manual and automatic (daily cron) backups to a dedicated Google Drive folder (`drive.file` scope only), version history, restore preview, merge/replace with confirmation, portable JSON export. |

## Stack

- **Client:** React 19, TypeScript, Vite 6, Tailwind CSS 3, Lucide icons, TanStack Query 5, `idb`, Vazirmatn (self-hosted), installable PWA.
- **Server:** Cloudflare Workers (Hono), D1 (SQLite), static assets served from the same Worker.
- **External:** TMDB API (server-side key only), Google Drive API, Resend (e-mail, optional).
- **Tests:** Vitest (unit/integration) + an end-to-end API smoke suite against a real local Worker and D1.

## Quick start (local development)

```bash
npm install
cp .env.example .dev.vars          # fill in at least TMDB_API_KEY
npm run db:migrate:local
npm run dev                        # web on :5173, API on :8787
```

Then open <http://localhost:5173>, create the first administrator with your
`ADMIN_BOOTSTRAP_SECRET` (the app walks you through it), and start inviting.

```bash
npm run typecheck    # tsc for client and worker
npm run lint         # eslint, zero warnings allowed
npm test             # vitest (80 tests)
npm run build        # production client bundle
npm run smoke        # 31 end-to-end API checks against the running Worker
```

## Documentation

| Document | Contents |
| --- | --- |
| [`PROJECT_STATE.md`](PROJECT_STATE.md) | **Read this first.** What exists, what is verified, what is left, and instructions for the next agent. |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Product behaviour, rules and acceptance criteria. |
| [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) | System design, data model, API surface, sync and caching. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture decisions and their trade-offs (ADRs). |
| [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) | راهنمای قدم‌به‌قدم برای شخص غیر برنامه‌نویس (فارسی). |
| [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) | Publishing to Cloudflare, secrets, custom domain, updates. |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Test strategy, scenario list, how to run everything. |
| [`docs/COSTS_AND_LIMITS.md`](docs/COSTS_AND_LIMITS.md) | Every free tier used, its real limits, and what happens at the ceiling. |
| [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | Honest security analysis of the custom auth, including its limits. |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history. |
| [`AGENTS.md`](AGENTS.md) | Conventions for automated contributors. |

## Honest status

Working and verified locally: the full Persian UI (11 pages), the API, invite-only
auth, ratings, series/episode tracking, lists, categories, statistics, portable
export/import, offline queue, PWA install, light/dark theme, Jalali dates.

**Not yet verified against real third-party accounts** (no credentials were
available in the build environment): TMDB live data, Google Drive OAuth upload,
and production e-mail delivery. The code paths exist and fail loudly with a clear
Persian message instead of pretending to succeed — see `PROJECT_STATE.md` for the
exact checklist to verify them on your own account.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
Movie, series and artwork metadata © TMDB. Non-commercial, personal use only.
