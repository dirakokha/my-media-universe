# TEST_PLAN — My Media Universe

Three layers, all runnable locally with no external credentials:

| Layer | Tool | Count | What it proves |
| --- | --- | --- | --- |
| Unit / integration | Vitest | **80 tests** (7 files) | Rating maths, Jalali conversion, KDF parameters, backup validation, CSRF, auth guards, ownership |
| API end-to-end | `scripts/smoke-test.mjs` | **31 checks** | The whole user journey against a real Worker + real D1 |
| Visual | headless Chromium | screenshots | Layout, RTL, both themes, mobile |

```bash
npm test          # unit/integration
npm run smoke     # API end-to-end (needs the Worker running)
npm run typecheck && npm run lint && npm run build
```

---

## 1. Unit and integration (Vitest)

### `tests/shared/ratings.test.ts` — 17 tests
The rating engine is the part of the product where a bug is invisible until it
has already corrupted a year of history.

- snaps to the 0.5 grid, clamps to 0–10, rejects `NaN`/`Infinity`
- rounds to 2 decimals without float artefacts (`8.299999999` → `8.3`)
- **does not treat a missing rating as 0** (the core correctness rule)
- averages only rated criteria; returns `null` when nothing is rated
- season score = average of that season's rated episodes only
- series score = average across all rated episodes, with coverage
- coverage never counts unrated episodes
- Persian decimal separator formatting (`۸٫۵`)

### `tests/shared/jalali.test.ts` — 18 tests
- Jalali ↔ Gregorian round-trips, plus **every day of a whole year**
- leap-year detection (1403 and 1408 are leaps, 1404 is not)
- Esfand 30 exists only in leap years
- year range covers Nowruz → Nowruz, month range, month key
- Persian digits in numeric and long formats
- regression for the `Math.trunc` vs `Math.floor` bug that produced ۱۴۰۵/۱۲/۰۳

### `tests/client/auth.test.ts` — 8 tests
- PBKDF2 uses exactly SHA-256 / 600 000 iterations / 256-bit output
- recovery key: 32 chars, 8 groups, 160 bits, no ambiguous glyphs (`I O 0 1`)
- normalisation accepts Persian digits, lowercase, stray whitespace
- password policy accepts a strong passphrase, rejects short or letter-only
- anime heuristic requires Animation genre **and** Asian origin

### `tests/worker/backup-validation.test.ts` — 9 tests
- complete document validates and summarises
- missing collections default to empty
- newer `schemaVersion` → `backup_too_new`
- structurally invalid documents rejected
- unknown fields preserved (forward compatibility)
- invalid criteria values rejected
- collection size caps enforced (protects Worker memory)
- error payload names the offending path

### `tests/worker/security-helpers.test.ts` — 17 tests
- constant-time equality (identical / different / not a prefix match)
- SHA-256 determinism and a known test vector
- e-mail and username normalisation (Persian digits, Arabic Yeh/Kaf)
- AES-GCM round-trip, unique ciphertext per call, refuses to run without a key in production
- **CSRF matrix:** safe methods ignored; matching Origin, `APP_BASE_URL` origin and `x-forwarded-host` accepted; foreign/missing Origin → 403

### `tests/worker/auth-guards.test.ts` — 8 tests
- no cookie → 401; unknown/revoked/expired session → 401
- disabled account with a valid session → 401
- valid session attaches user id and role
- unverified account → 403 from `requireVerifiedUser`
- member on an admin route → 403, admin → 200
- **raw session token is never sent to D1** (only its SHA-256)

### `tests/worker/ownership.test.ts` — 3 tests
The regression guard for "no client-supplied user IDs".

- every protected route returns 401 without a session
- a member with a valid session gets 403 on admin routes
- **records the SQL the Worker emits** and asserts every query against an
  owned table (`media_items`, `episodes`, `watch_events`, `lists`, `backups`, …)
  carries a `user_id` predicate

---

## 2. API end-to-end (`npm run smoke`, 31 checks)

Runs against `http://127.0.0.1:8787` by default (`BASE_URL`/`ORIGIN` override).
When the target is local it clears `rate_limits` first so repeated runs do not
trip the brute-force limiter. The total is always **31**: on a database that
already has an administrator, the two bootstrap assertions are replaced by the
sign-in and cookie assertions.

| # | Scenario | Asserts |
| --- | --- | --- |
| 1 | health endpoint responds | 200 + `{ok:true}` |
| 2 | setup status is public | 200 without a session |
| 3 | first administrator created *(fresh database)* | 201, `role === 'admin'` |
| 4 | administrator signed in | 200 + `mmu_session` cookie |
| 5 | invitation code generated | 201 with `MMU-…` code |
| 6 | invitation list is readable | 200 array |
| 7 | **plaintext invitation codes are never stored or returned in lists** | only a 10-char hint |
| 8 | registration with an invalid invitation is rejected | 400 |
| 9 | registration with a valid invitation succeeds | 201 |
| 10 | new accounts start unverified | `emailVerified === false` |
| 11 | e-mail verification code works | `emailVerified === true` |
| 12 | **a single-use invitation cannot be reused** | 400 |
| 13 | session resolves to the right user | `/me` returns the same username |
| 14 | manual media item can be created | 201 + id |
| 15 | criteria average ignores skipped criteria | 8 & 6 → **7** |
| 16 | direct rating stores half points | 9.5 |
| 17 | rewatch events are recorded | two 201s |
| 18 | **both viewing events are preserved** | `watchEvents.length === 2` |
| 19 | the current rating is the most recent one | 8.5 |
| 20 | **the earlier 9/10 viewing keeps its original rating** | history is immutable |
| 21 | **a spoiler-flagged viewing keeps its flag** | `isSpoiler === true` |
| 22 | custom category created | 201 |
| 23 | media item is classified into the category | `itemCount === 1` |
| 24 | personal list contains the item | `items.length === 1` |
| 25 | statistics are computed | `totalWatchTimeMinutes` numeric |
| 26 | episode statistics are present | `ratedEpisodes >= 0` |
| 27 | portable JSON export works | `schemaVersion >= 1` |
| 28 | export contains the library | `mediaItems.length >= 1` |
| 29 | unauthenticated request cannot read this library | 401 |
| 30 | another user cannot read this library item | 403/404 |
| 31 | another user cannot see this item in their library list | filtered out |

Checks 7, 12, 15, 18, 20, 21 and 29–31 are the ones that protect the owner's data:
no plaintext invitation codes, invitation single-use, no silent zero, no
overwritten history, spoiler flags that survive a save, and no cross-user leakage.

---

## 3. Manual scenarios (31 UI journeys — 29 required by the brief, plus 2 added during verification)

These need a browser and a real account. Each is written as a sentence the owner
can follow, with the expected result.

### Auth and account
1. Open `/register` without a code → the form explains an invitation is required.
2. Register with a valid code → lands on e-mail verification.
3. Enter the 6-digit code → redirected home, verified badge in Settings.
4. Request a second code within 15 minutes → the old code stops working.
5. Log out, log back in → library, lists and theme are intact.
6. Change the password → every other session is revoked.
7. Use "forgot password" → reset link arrives, old sessions are revoked.
8. Lose the password, use the recovery key at `/recover` → new password set, all sessions revoked.
9. Try the admin page as a member → 403 page, no data leak.
10. Delete the account → confirmation phrase required, explanation about Drive backups shown.

### Library and metadata
11. Search TMDB for "Inception" → Persian title and overview when available, English otherwise.
12. Add the same movie twice → the second attempt is blocked (uniqueness).
13. Add a manual item with a poster → poster renders, no TMDB call.
14. Toggle the anime flag on a TV series → it moves to the Anime page.
15. Change status to "Completed" → counters update everywhere.
16. Favourite an item → appears first in the Favourites filter.

### Ratings and series
17. Rate only 3 of 5 criteria → the score is the average of those 3, not of 5.
18. Clear all criteria → the score disappears (does not become 0).
19. Rate episodes in two seasons → season and series averages follow the rules.
20. Set an independent final series rating → shown as a separate badge.

### Journal
21. Add a spoiler note → text is blurred and absent from the DOM until reveal.
22. Rewatch a movie and record it → two watch events, two dates.
23. Delete one watch event → the other survives.

### Lists and categories
24. Create a list, reorder items, rename it → order persists after reload.
25. Put one item in two lists → both lists show it.
26. Delete a list → the item stays in the library.

### Offline and sync — **verified in the browser (2026-11-24)**
27. Go offline, change a status → toast says «تغییر وضعیت ذخیره شد. بعد از اتصال به اینترنت ارسال می‌شود.»,
    sidebar shows «آفلاین · ۱ در انتظار ارسال». ✅
28. Come back online → the write is applied once, sidebar returns to «همگام شده». ✅
    (Confirmed server-side: the item's status and spoiler flag both changed.)
29. Reload while offline on `/item/:id` → the page renders from the IndexedDB cache
    instead of bouncing to the login page. ✅
30. Kill the network mid-request → the request is queued, not lost. ✅
31. Service worker: after one online load, `navigator.serviceWorker.controller`
    is non-null and `caches.keys()` returns `mmu-shell-v1-shell` and
    `mmu-shell-v1-assets`; with the network off, a reload still renders the app
    (the HTML/JS/CSS come from the SW shell, the data from IndexedDB). ✅

### Visual checks
For each of the above: 1366×900 and 390×844, dark and light, `prefers-reduced-motion`
enabled, and keyboard-only navigation (Tab/Enter/Escape on modals and dropdowns).

---

## 4. Headless screenshots (how the UI was verified)

Playwright cannot download browsers in this sandbox, so the driver uses the
Chromium build shipped inside `@sparticuz/chromium`:

```bash
# one-time: extract the shared libraries
node -e "const z=require('zlib'),t=require('tar-stream');" # …or use the prebuilt /tmp/al2023/lib
LD_LIBRARY_PATH=/tmp/al2023/lib node .cache/shot.mjs '[
  {"goto":"/login","fill":{"#identifier":"smoke_owner","#password":"Correct-Horse-9!"},
   "click":"button[type=submit]","wait":2000},
  {"goto":"/stats","wait":2000,"shot":"stats"}
]'
```

`W=390 H=844 OUT=.cache/shots/mobile` switches to the mobile viewport.
Crops are made with `sharp` (`extract` + `resize`); PIL is not installed.

Screenshots checked this cycle: home, item, stats, search, movies, lists, settings,
admin, login, mobile home/item/manual-add, light theme.

---

## 5. Coverage gaps (honest list)

| Area | Status | Why | How to close |
| --- | --- | --- | --- |
| TMDB live responses | **not tested** | no API key in the build environment | set `TMDB_API_KEY`, run scenario 11 |
| Google Drive OAuth + upload | **not tested** | no OAuth client | create one, run `docs/SETUP_GUIDE.md` §10 |
| Resend delivery | **not tested** | no API key / verified domain | set key, run scenario 3 |
| PWA install prompt | **not tested** | headless Chromium does not show install UI | real Android device |
| Cron | **not tested** | never deployed | `wrangler tail` after deploy |
| Screen-reader audit | **not done** | manual only | NVDA/VoiceOver pass on item page and settings |
| Cross-browser | Chromium only | WebKit/Firefox not installed here | manual Safari + Firefox pass |

Do not mark these as verified until they have actually been run.
