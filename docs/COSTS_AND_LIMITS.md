# COSTS_AND_LIMITS — My Media Universe

**Total cost: $0.** No paid plan, no credit card, no trial that converts, no
"contact sales". Every service below has a free tier that this app stays inside
with a large margin.

Figures checked against the providers' published pages in **November 2026**.
Re-verify before scaling beyond a handful of users — free tiers change.

---

## 1. What the app uses

| Service | Free allowance | This app's expected use | Headroom |
| --- | --- | --- | --- |
| **Cloudflare Workers** | 100 000 requests/day, 10 ms CPU per request, 128 MB memory, 50 subrequests per request, 6 concurrent connections, 64 MiB script | ~300–800 requests/day for one owner | ~99 % |
| **Cloudflare D1** | 5 000 000 rows read/day, 100 000 rows written/day, 5 GB account storage, 500 MB max per database, 50 queries per Worker invocation | ~30 000 rows read, ~1 500 rows written per day | >99 % |
| **Cloudflare Workers Static Assets** | 20 000 files/version, 25 MiB per file, free egress | 40 files, ~1.5 MB total | ~100 % |
| **Cloudflare Cron Triggers** | 5 per account | 1 (`17 3 * * *`) | 4 left |
| **Cloudflare Observability (logs)** | Included, 3-day retention on free | low volume | — |
| **TMDB API** | Free for non-commercial use, attribution required, ~40 requests / 10 s | A few hundred requests/day worst case | High |
| **Google Drive** | 15 GB free per account | Backups are JSON, ~200 KB–2 MB each, 25 kept → < 50 MB | ~100 % |
| **Resend** | 3 000 e-mails/month, **100 per day**, 3 domains, no credit card | < 30/month (verification + password resets) | ~99 % |

**Unused on purpose:** Cloudflare KV (1 000 writes/day — too little for a limiter),
Cloudflare Pages (the Worker serves the SPA), Cloudflare R2 (no file storage needed).

---

## 2. What happens at the ceiling

| Service | Behaviour when exceeded | Impact |
| --- | --- | --- |
| Workers | Requests fail with **error 1027** until 00:00 UTC. **No charge, no bill.** | Site down for the rest of the day — a 100 k/day ceiling for one person is unreachable |
| D1 reads | Query fails until the daily reset | Lists/stats would error; writes unaffected until the write cap |
| D1 writes | `D1_ERROR: too many rows written` | Writes fail; reads still work |
| D1 storage | Inserts fail at 500 MB | A single owner's library is megabytes |
| TMDB | HTTP **429** | App retries once after `Retry-After`, then shows a Persian "try again" message |
| Resend | 429 from the API | Verification mail not sent; the app returns a 502 with a clear message instead of pretending |
| Google Drive quota | 403 `quotaExceeded` | Backup fails with `google_upload_failed`; local library is untouched |

Nothing can silently bill the owner: there is no payment method on the account
and no paid plan is enabled.

---

## 3. The Google OAuth trap (important, and easy to miss)

Google issues **refresh tokens that expire after 7 days** while the OAuth consent
screen is in **"Testing"** publishing status. After a week, automatic backups
would start failing with `google_token_expired`.

**Fix (free, ~2 minutes):**

1. <https://console.cloud.google.com/apis/credentials/consent> → **Publish app** →
   **In production**.
2. Because the app requests only `drive.file` — a **non-sensitive** scope — Google
   does **not** require the full verification process. Users may still see an
   "unverified app" interstitial once; click **Advanced → Go to … (unsafe)**.
3. Reconnect Drive from Settings so a long-lived refresh token is issued.

Other token lifetimes to know about:

| Event | Effect |
| --- | --- |
| 6 months without using the refresh token | Token expires — reconnect |
| User changes their Google password | Only affects Gmail-scoped tokens, not `drive.file` |
| More than 50 authorisations of the same app by the same user | Oldest refresh token silently revoked — the app only re-prompts when a refresh actually fails |
| User revokes access at <https://myaccount.google.com/permissions> | Refresh returns `invalid_grant` → app shows "دسترسی Google Drive منقضی شده است" |

---

## 4. Capacity planning for one owner

Assuming 300 titles, 5 000 episodes, 20 000 watch events:

| Resource | Estimate | Free allowance | Utilisation |
| --- | --- | --- | --- |
| D1 storage | ~15 MB | 500 MB | 3 % |
| D1 rows written/day | ~1 500 | 100 000 | 1.5 % |
| D1 rows read/day | ~30 000 | 5 000 000 | 0.6 % |
| Worker requests/day | ~500 | 100 000 | 0.5 % |
| Backup size | ~1.5 MB × 25 versions | 15 GB | 0.25 % |

The design stays inside free tiers by construction:

- **One Worker, one origin** — no extra service to pay for.
- **PBKDF2 in the browser** — the 10 ms CPU limit is not touched by password hashing.
- **Rate limiting in D1, not KV** — KV's 1 000 writes/day would be exhausted by login attempts alone.
- **Hot-linked TMDB images** — no image storage at all.
- **JSON backups** — no R2, no attachment storage.

---

## 5. If the owner ever wants more

| Need | Free-tier path | When it stops being free |
| --- | --- | --- |
| More users | Same Worker; D1 rows scale with users | ~50+ active users hitting 100 k requests/day |
| Bigger backups | Keep 25 versions, prune old ones manually | Drive 15 GB (never for JSON) |
| E-mail beyond 3 000/month | — | Resend Pro ($20/month) — **not needed** for one person |
| Longer log retention | Workers Logs free = 3 days | Paid observability plan — **not needed** |
| More cron jobs | 5 free triggers | 6th trigger needs Workers Paid ($5/month) |

The only realistic reason to ever pay would be "more than ~50 active users",
which is outside the product's stated scope (a private library).
