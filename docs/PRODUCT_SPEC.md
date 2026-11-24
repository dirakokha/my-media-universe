# PRODUCT_SPEC — My Media Universe

**Version:** 1.0 · **Audience:** the owner (single user, plus invited family/friends) · **Language:** Persian (fa-IR), RTL
**Non-goals:** social features, public profiles, streaming, commercial use of TMDB data.

---

## 1. Purpose

A private place to keep a personal media library and an honest viewing journal:
what I watched, when, how many times, what I thought of it, and how my taste
evolves. The owner is a non-programmer; every flow must be completable without
seeing a terminal.

## 2. Media types

| Type | TMDB source | Stored as |
| --- | --- | --- |
| Movie | `movie` | `kind = 'movie'` |
| TV series | `tv` | `kind = 'series'` |
| Anime | `tv` (or `movie`) with the Animation genre + JP/CN/KR/TW origin | `kind` + `is_anime = 1` |

Anime is a **flag**, not a third `kind`, because TMDB has no anime type. The
heuristic (`looksLikeAnime` in `src/shared/constants.ts`) requires the Animation
genre **and** an Asian origin country or `ja` original language. The owner can
override the flag on any item.

**Extensibility:** a future type (books, games, music) adds a `kind` value and a
page; no other table changes. `kind` is a `TEXT` column guarded by a `CHECK`, so a
migration is required to extend it — deliberately, so it is never added by accident.

## 3. Library rules

- **Statuses:** `plan` (قصد تماشا دارم), `watching` (در حال تماشا), `completed` (تماشا شده), `onhold` (متوقف شده), `dropped` (رها شده).
- **Categories:** multi-assign, owner-defined, colour optional. Deleting a category detaches items; it never deletes them.
- **Lists:** owner-defined, optional description, `manual | rating | date | title` sort, multi-membership. Deleting a list removes membership rows only. The watchlist is a system list that cannot be deleted.
- **Uniqueness:** one library item per `(user, tmdb kind, tmdb id)`; manual items have no such constraint.
- **Delete:** soft delete (`removed_at`) with a confirmation dialog; data is purged on the same request path as `DELETE /api/library/:id`.
- **Manual items:** title, original title, kind, anime flag, poster upload (stored as a data URL, capped), year, description, genres, runtime. Manual items never call TMDB.

## 4. Rating model

Five optional criteria, each 0–10 in 0.5 steps:

| Key | Label |
| --- | --- |
| `story` | داستان و فیلمنامه |
| `characters` | شخصیت‌پردازی و بازیگری |
| `direction` | کارگردانی و جلوه‌های بصری |
| `sound` | موسیقی و طراحی صدا |
| `impact` | تأثیرگذاری و درگیرکنندگی |

**Rules (implemented in `src/shared/ratings.ts`, tested):**

1. A rating is either **direct** (one number) or **criteria-based** (a map). The active method is stored with the item.
2. Criteria score = arithmetic mean of **only** the criteria that have a value. Skipped criteria are not zero.
3. If nothing is rated, the score is `null` — never `0`.
4. Season score = mean of that season's rated episodes; `null` if none.
5. Series score = mean of **all** rated episodes across all seasons (not the mean of season means, which would over-weight short seasons).
6. Coverage is shown as "Rated X of Y episodes" so a 10/10 from one episode is never mistaken for a completed series.
7. An optional **independent final series rating** is stored separately and displayed as a distinct badge; it never overwrites the computed average.
8. Values are rounded to 2 decimals for display and storage to avoid float artefacts.

## 5. Series and episodes

- Season selector → episode list with still, name, air date, runtime.
- Per episode: rating (direct or criteria), notes, quotes, watch date, rewatch events.
- Marking an episode watched without a rating is allowed; it never creates a rating.
- Rewatching an episode adds a new watch event; previous events keep their dates and ratings.
- Deleting a watch event is explicit and confirmed.

## 6. Journal

- Notes: free text, spoiler flag. Spoiler text renders blurred behind a "نمایش" button; the raw text is not present in the DOM before reveal (no CSS-only hiding).
- Quotes: multi-line, with an optional spoiler flag.
- Tags: free-form, normalised (Persian digits, Yeh/Kaf), deduplicated.
- Watch date: Jalali picker (`src/components/ui/date-picker.tsx`) that stores an ISO date. Persian digits are used for all labels — never `Intl.NumberFormat('fa-IR')`, which adds thousands separators.
- Every watch event is preserved with its own date, rating and note.

## 7. Statistics

Computed server-side from the owner's rows only.

| Metric | Rule |
| --- | --- |
| Totals | per kind and status |
| Watch time | Σ runtime of watch events **and** rated episodes that have a runtime; items without runtime are excluded and counted as "unknown runtime" |
| Average rating | mean of non-null scores only |
| Highest / lowest | top-3 and bottom-3 by score, ties by title |
| Genre distribution | from stored genre names |
| Monthly / yearly activity | grouped by **Jalali** month and year |
| Rating distribution | 10 buckets (0–1 … 9–10) |
| Completed series | series with `status = completed` |
| Rated episodes | count and coverage percentage |
| Most active months | top-3 by watch events |

Ranges: all-time, this Jalali year, this Jalali month, custom (two Jalali dates).
Custom ranges are inclusive; an invalid range yields an empty state, not an error.

## 8. Authentication and accounts

- **Invite-only.** An administrator creates single-use codes (`MMU-XXXXX-XXXXX-XXXXX`). Only a SHA-256 of the code and a 10-character hint are stored.
- Codes expire (default 7 days), can be revoked, and are consumed **atomically** with `UPDATE … WHERE use_count < max_uses` so two concurrent sign-ups cannot both win.
- **First admin:** `POST /api/auth/bootstrap` with `ADMIN_BOOTSTRAP_SECRET` — allowed only while no admin exists. The secret should be rotated/removed afterwards.
- **E-mail verification:** 6-digit OTP, 15-minute expiry, resend rate-limited.
- **Password:** min 10 characters, must contain a letter and a digit, must not be in a small built-in common-password list, must not equal the username.
- **Sessions:** 30 days, sliding, refreshed at most every 6 hours; listed and revocable in Settings; "log out everywhere" revokes all.
- **Recovery key:** 32 characters from a 32-symbol alphabet (no `0 1 I O`), 160 bits, grouped `XXXX-XXXX-…`. Shown once. Stored as SHA-256 only. Emergency flow: verify key → 10-minute ticket → set a new password → all sessions revoked.
- **Account deletion:** requires typing a confirmation phrase; cascades to every owned table and explains that Drive backups are **not** deleted by the app.

## 9. Offline and sync

- The server is authoritative. The client caches reads in IndexedDB for offline viewing.
- Writes are optimistic: the UI updates immediately, the request follows, and a failure rolls the UI back and shows a Persian toast.
- Offline writes enter a queue; each carries a stable id and is replayed with `Idempotency-Key`. Replays return the original response, so retries cannot duplicate a watch event.
- Permanent (4xx) failures are surfaced in a "needs attention" list with a retry button.
- The shell shows `همگام شده` / `در حال همگام‌سازی` / `N در انتظار ارسال` and a Sync Now button. A queued write is **never** reported as "saved" — it is reported as "queued".

## 10. Backup and portability

- One canonical JSON document (`worker/services/backup.ts`), used by Drive backup, portable export and import.
- `schemaVersion` guards both directions: too old → migrated or rejected with a message; too new → `backup_too_new`.
- Collections are capped (media items 50 000, episodes/watch events 200 000, categories/lists 5 000, memberships 100 000) so a hostile file cannot blow the Worker's memory.
- Drive backups keep the latest 25 versions; older files are deleted.
- Restore always shows a **preview** (counts, types, sample titles, exported date) before the owner chooses merge or replace; replace requires typing a confirmation.

## 11. Design system

- Dark by default, real light theme, toggle remembered **per user** (server preference + local fallback).
- Vazirmatn from `@fontsource` (self-hosted, no Google Fonts request).
- Lucide icons only — no emoji anywhere in the UI.
- Tokens: `canvas, surface, raised, overlay, line, line-strong, ink, ink-soft, ink-faint, accent, accent-ink, success, danger`.
- No glassmorphism, no decorative gradients (the only gradient is the hero backdrop scrim and the rating slider fill).
- Skeletons for every server-fetched region; explicit empty, error and success states.
- Motion: 120–200 ms, `prefers-reduced-motion` respected.
- Touch targets ≥ 44 px on mobile; the bottom nav respects `env(safe-area-inset-bottom)`.
- Contrast: body text ≥ 4.5:1 in both themes.

## 12. Error language

Every user-facing error is Persian and says what to do next, e.g.

- `اتصال به TMDB هنوز تنظیم نشده است` (admin has not set the key)
- `این کد دعوت منقضی شده است`
- `این نسخهٔ پشتیبان از نسخهٔ جدیدترِ برنامه است`

Technical details stay in the `error.code` field for logs, never in the toast.
