# AGENTS.md

Instructions for automated contributors (Claude Code, Codex, Cursor, Arena agents).
Human contributors: read `PROJECT_STATE.md` first, then this file.

## What this project is

A private, Persian (RTL) personal media library and viewing journal. Single owner
plus a handful of invited people. Runs on Cloudflare's free tier with a $0 budget.
The owner is **not a programmer** — every message, error and document aimed at them
must be plain Persian without jargon.

## Non-negotiable rules

1. **$0 budget.** No paid service, no trial that converts, no "requires a credit
   card". Check `docs/COSTS_AND_LIMITS.md` before adding anything external.
2. **Never fake success.** If a credential is missing, the UI says so in Persian.
   No mock data, no fake "connected" state, no pretend uploads.
3. **Never leak secrets.** No keys in `src/`, in Git, in docs, in fixtures or in
   chat. `.env.example` holds names only. `.dev.vars` is gitignored.
4. **Never silently lose data.** Unrated ≠ 0. Watch history is append-only.
   Offline edits are queued and replayed idempotently, never dropped.
5. **Never break the gates.** `npm run typecheck && npm run lint && npm test &&
   npm run build && npm run smoke` must stay green. Do not delete a failing test
   to make it pass.
6. **TMDB terms.** Non-commercial, attribution shown, images hot-linked (never
   stored), cache under 6 months, key server-side only.
7. **Persian and RTL.** All user-facing strings in Persian; dates in Jalali for
   display and ISO in storage; Persian digits via `toPersianDigits()` (never
   `Intl.NumberFormat('fa-IR')`, which adds thousands separators).

## Where things are

```
src/shared/          isomorphic contract layer (types, ratings, jalali, constants)
src/pages/           11 pages
src/components/      ui/ (button, field, modal, dropdown, rating, date-picker, tag-input)
                     layout/app-shell.tsx (sidebar + mobile bottom nav)
src/lib/             api, auth (PBKDF2), idb, sync, write, images
src/hooks/           use-auth, use-theme, use-online, use-toast, use-library
src/index.css        design tokens + component classes
worker/              Hono app: routes/, auth/, services/, lib/
migrations/          D1 schema (forward-only)
tests/               Vitest: shared/, client/, worker/
scripts/             smoke-test.mjs, reset-local-db.sh
docs/                product spec, architecture, ADRs, guides, test plan, security
```

## Commands

```bash
npm install
npm run dev              # web :5173 + worker :8787 (concurrently)
npm run typecheck        # tsc client + worker
npm run lint             # eslint, --max-warnings 0
npm test                 # vitest (80 tests)
npm run build            # vite build → dist/client
npm run smoke            # 30 API checks against a running worker
npm run db:reset:local   # wipe local D1 and re-apply migrations
```

## Conventions

- **TypeScript strict**, `noUnusedLocals`/`noUnusedParameters` on the client.
- **Imports:** value imports first, then `import type`. ESLint enforces
  `consistent-type-imports` with inline `type` modifiers.
- **Worker:** every route file is `new Hono<AppEnv>()` and exported as default;
  mounted in `worker/index.ts`. Bodies are validated with Zod through `readJson`.
- **Errors:** throw `ApiError(status, code, persianMessage, fields?)`. The
  `code` is for logs; the message is for the owner.
- **Auth:** user id comes only from `c.get('userId')`. Never accept a user id from
  a request. `tests/worker/ownership.test.ts` will fail if you add an unscoped
  query.
- **Dates:** store ISO or epoch ms, display with `src/shared/jalali.ts`.
- **Ratings:** all maths lives in `src/shared/ratings.ts` and must stay pure.
- **CSS:** use the tokens in `src/index.css`. New colours go in the token file,
  not inline. No glassmorphism, no decorative gradients, no emoji.
- **Accessibility:** every interactive element needs a Persian `aria-label`; focus
  rings stay visible; modals trap focus and close on Escape; touch targets ≥ 44 px.

## Commit messages

Conventional commits, imperative mood, English (the code is English):

```
feat(ratings): add independent final series rating
fix(sync): replay queued writes with a stable idempotency key
docs: add security review and cost analysis
test(ownership): assert every owned-table query is user-scoped
```

## Definition of done

A change is done when:

1. `typecheck`, `lint`, `test`, `build` and `smoke` all pass.
2. It was looked at in a browser at 1366×900 **and** 390×844, in both themes.
3. Persian copy was reviewed for naturalness, not just translation.
4. `docs/` was updated if the behaviour or an architecture decision changed.
5. `PROJECT_STATE.md` "Verified / Not verified" tables still tell the truth.
