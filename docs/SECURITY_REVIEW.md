# SECURITY_REVIEW — My Media Universe

**Scope:** the custom authentication system, session handling, authorisation,
transport and data-at-rest protections of this application.
**Verdict:** *suitable for a private, single-owner deployment, **not** yet
"production-grade" by the standard of a public consumer product.* The gaps are
listed in §10 and are all fixable without changing the architecture.

This document is deliberately blunt. Where something is weaker than a hosted
identity provider, it says so.

---

## 1. Summary

| Area | Mechanism | Assessment |
| --- | --- | --- |
| Password at rest | `SHA-256(PBKDF2-SHA256(password, salt, 600 000, 256 bit))` | ✅ Strong vs offline cracking; ⚠️ derived key is a reusable credential (§4) |
| Password in transit | never sent; only the derived key | ✅ |
| Session token | 32 random bytes, **SHA-256 stored**, HttpOnly cookie | ✅ |
| Cookie flags | `HttpOnly; SameSite=Lax; Path=/; Max-Age; Secure` (prod) | ✅ |
| CSRF | Origin/Referer allow-list on every non-GET `/api/*` | ✅ |
| Authorisation | user id from the session only; every owned-table query scoped | ✅ (regression-tested) |
| Timing attacks | constant-time compare, dummy hash for unknown users, decoy salt | ✅ |
| Brute force | per-IP fixed-window limits on all sensitive endpoints | ⚠️ per-IP, not per-account |
| Invitation | hashed code, single-use, expiring, revocable, atomic consume | ✅ |
| Recovery key | 160 bits, shown once, SHA-256 stored, 10-minute ticket | ✅ |
| Token storage at rest (Google) | AES-GCM with a 32-byte key from a Worker secret | ✅ |
| XSS | React escaping, no `dangerouslySetInnerHTML`, strict CSP | ✅ |
| Transport | HTTPS enforced by Cloudflare; HSTS in production | ✅ |
| Secrets in repo | none; `.env.example` names only; `.dev.vars` gitignored | ✅ |
| Logging | no request bodies, no credentials | ✅ (with one dev-only caveat) |

---

## 2. Password hashing — the exact construction

```
client:  authKey = PBKDF2-HMAC-SHA256(password, salt, iterations = 600 000, dkLen = 32 bytes)
         → base64url, sent in the JSON body over HTTPS
worker:  password_hash = SHA-256 hex( base64url-decoded authKey )
         stored in users.password_hash
```

| Parameter | Value | Why |
| --- | --- | --- |
| Hash | **PBKDF2-HMAC-SHA256** | Available in every browser's WebCrypto; SHA-512 would need ~210 000 iterations for equivalent strength and is slower on 32-bit mobile cores |
| Iterations | **600 000** | Matches the current OWASP Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA256 |
| Output length | **256 bits** | Full-entropy derived key; more than enough for a 128-bit security level |
| Salt | **16 random bytes**, base64url, **per user** | Generated client-side at registration with `crypto.getRandomValues`, stored in `users.password_salt` |
| Stored form | `SHA-256(authKey)` (64 hex chars) | A database leak yields neither the password nor the reusable key |

### Salt handling, including the login edge case

The client needs the salt *before* it can derive a key, so login is two requests:
`GET /api/auth/salt?identifier=…` → `POST /api/auth/login`.

- **Known user:** returns the real salt.
- **Unknown user:** returns a deterministic decoy
  `SHA-256("mmu-decoy:" + normalised identifier + ":" + ENCRYPTION_KEY).slice(0,22)`.
  The response is indistinguishable in shape and timing from a real one, so the
  endpoint cannot be used to enumerate usernames. (The salt is not a secret anyway;
  the decoy exists purely to avoid an oracle.)
- **Registration:** the client generates the salt. A hostile client could pick a
  weak salt — that only weakens *its own* account, never another user's.

### Measured cost (real numbers, not guesses)

Measured in this build environment with Node 22 on the sandbox CPU, `deriveBits`
only, best of 4 runs:

| Iterations | Wall-clock |
| --- | --- |
| 310 000 | 47–57 ms |
| **600 000** | **87–99 ms** |

**These are wall-clock times on the developer machine.** The Worker performs
**zero** PBKDF2 work, so none of this counts against the 10 ms CPU/request limit
of the free plan. On a low-end Android phone expect roughly 3–6× these numbers
(≈300–600 ms), once per login — acceptable for a media library, and the reason the
app shows a disabled button with a spinner while deriving.

> The earlier "~45 ms" figure quoted during development was **Node wall-clock for
> 310 000 iterations**, not Worker CPU time. It has been superseded by the table
> above.

---

## 3. What the Worker stores and why

Only `SHA-256(authKey)`. Consequences:

- **A read-only database leak does not expose the password** and does not expose a
  directly usable login secret — the attacker would have to find a preimage of the
  derived key, which is a 256-bit search.
- **Cracking cost is the PBKDF2 cost:** 600 000 SHA-256 compressions per guess,
  per user (salt is unique). A dictionary attack against a weak password is still
  feasible — which is why the password policy exists (§6) and why a strong
  passphrase is recommended in the UI.
- **The Worker never sees the password**, so it cannot log it, and a compromised
  Worker cannot replay it against another site.

---

## 4. The real weakness: the derived key is a reusable credential

This must be understood clearly.

`authKey` is **deterministic for (password, salt)**. Anyone who obtains it can
authenticate as that user **without knowing the password**, for as long as the
password is unchanged. It is a password-equivalent bearer secret.

**Where it could leak and what stops it:**

| Vector | Mitigation | Residual risk |
| --- | --- | --- |
| Network interception | HTTPS only (Cloudflare terminates TLS); HSTS in production; `Secure` cookie | none realistically |
| XSS in the app | strict CSP (`script-src 'self'`, no `unsafe-inline`, no third-party scripts), React escaping, no `dangerouslySetInnerHTML` | low; CSP blocks injected `<script>` |
| Malicious browser extension | none possible from server side | **out of scope** — an extension can read anything in the page |
| Server-side request logging | bodies are never logged (§9) | none |
| Client-side persistence | `authKey` is **not stored**; it is derived on demand and discarded | none |
| Shoulder-surfing / malware | out of scope | accepted |

**Mitigations that reduce the blast radius:**

- Password change, reset and recovery **rotate the salt** (a fresh 16-byte salt is
  generated) and **revoke every session**, which also invalidates the old derived
  key.
- Sessions are revocable per device and globally (`/api/auth/sessions`,
  `/logout-all`).
- The derived key is only ever held in a local variable during the login request.

**What would remove this class of risk entirely:** a PAKE (SRP/OPA) or
WebAuthn/passkeys. Both are listed as open items in §10.

---

## 5. Sessions

| Property | Value |
| --- | --- |
| Token | 32 bytes from `crypto.getRandomValues`, base64url (256-bit entropy) |
| Storage | `sessions.token_hash = SHA-256(token)` — the raw token is never persisted |
| Cookie | `mmu_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, no `Domain` |
| Lifetime | 30 days, sliding |
| Refresh | at most one write per 6 h per session (`last_seen_at` throttle) |
| Revocation | per session (`logout`), all sessions (`logout-all`), and automatically on password change/reset/recovery |
| Invalidation | `revoked_at`, `expires_at`, and `users.disabled_at` all checked on every request |

`SameSite=Lax` plus the Origin check means a cross-site form post cannot ride an
existing session. The cookie is `HttpOnly`, so JavaScript cannot read it.

---

## 6. Password policy and account lifecycle

- Minimum 10 characters, must contain a letter **and** a digit, must not equal the
  username, must not be in a small built-in list of common passwords.
- **Change:** requires the current derived key; rotates the salt; revokes all
  other sessions.
- **Forgot:** 6-digit OTP by e-mail, 15-minute expiry, single use, rate-limited
  (5 per 15 min per IP); on success all sessions are revoked.
- **Recovery key:** 32 chars from a 32-symbol alphabet (`A–Z` minus `I`/`O`, plus
  `2–9`), grouped `XXXX-XXXX-…`. Entropy = 32 × log₂(32) = **160 bits**. Stored as
  `SHA-256(key)`. Shown exactly once at registration; regenerable from Settings
  with the current password. Emergency flow issues a 10-minute `recovery_session`
  ticket, then forces a new password and revokes all sessions.
- **Account deletion:** requires typing the username; cascades to every owned
  table. It explicitly warns that **Google Drive backups are not deleted**.

---

## 7. Authorisation

- The user id is taken from `c.get('userId')`, which only the auth middleware can
  set. It is never read from a body, header or query string.
- Guards: `requireUser`, `requireVerifiedUser`, `requireAdmin`.
- **Regression test:** `tests/worker/ownership.test.ts` mounts the real app with a
  recording fake D1 and asserts that **every query against an owned table carries a
  `user_id` predicate**. Adding a route that forgets the predicate fails CI.
- End-to-end proof: smoke checks 28–30 (unauthenticated 401; other user 403;
  other user's list filtered).

---

## 8. CSRF, XSS and transport

**CSRF.** Every non-GET `/api/*` request must carry `Origin` (or `Referer`) equal to
one of: the request origin, `APP_BASE_URL`, `x-forwarded-host`+`proto`. Failures:
`csrf_missing_origin` (403), `csrf_origin_mismatch` (403). Covered by 6 unit tests
including the `x-forwarded-host` case behind Cloudflare.

**XSS.** React's default escaping; `dangerouslySetInnerHTML` appears **nowhere** in
`src/`. Strict CSP on both static assets (`public/_headers`) and API responses:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://image.tmdb.org; font-src 'self';
connect-src 'self'; worker-src 'self' blob:; manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

`'unsafe-inline'` is allowed for **styles only** (React inline style props), never
for scripts. Also `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
`Permissions-Policy`, and HSTS (`max-age=31536000; includeSubDomains`) in
production.

**Transport.** Cloudflare serves HTTPS; HSTS pins it. There is no HTTP-only path in
production.

---

## 9. Secrets, logs and data at rest

- **Secrets** live in Worker env (`wrangler secret put`), never in
  `wrangler.jsonc`, never in Git. `.env.example` contains names only.
- **Logging.** `console.error('Unhandled error', err)` in `handleError` logs the
  `Error` object, never a request body. `console.error('Registration failed', err)`
  logs the D1 error. **No code path logs a password, derived key, session token or
  recovery key.**
- **One caveat:** in **development only**, `mailer.ts` prints the e-mail and the
  6-digit OTP to the console (`[DEV OUTBOX]`) because there is no mail provider.
  This is intentional for local testing and is impossible in production, where a
  missing Resend key raises `email_not_configured` instead.
- **Google tokens at rest:** AES-GCM with a fresh 96-bit IV per encryption,
  32-byte key from `ENCRYPTION_KEY`. Rotation of that key invalidates stored
  tokens (the user reconnects).
- **Backups** contain personal data in plaintext JSON — they are stored in the
  owner's own Drive, inside a folder the app created. They are **not** encrypted
  client-side. This is documented and is the main data-at-rest gap (§10).

---

## 10. Open items, in priority order

| # | Item | Severity | Why it matters | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Per-account login throttling** | Medium | Limits are per-IP (`12 / 15 min`). An attacker rotating IPs can attempt more guesses against one account. Add a per-`username_normalized` counter. | Small |
| 2 | **Client-side encryption of backups** | Medium | A compromised Google account exposes the library as plaintext JSON. Encrypt the backup document with a key derived from the password before upload. | Medium |
| 3 | **WebAuthn / passkey** | Medium | Removes the reusable-derived-key weakness (§4) entirely. Cloudflare WebAuthn is free and serverless. | Medium |
| 4 | **Session device binding** | Low | A stolen cookie is usable from any IP. Binding to a device fingerprint would break legitimate mobile roaming. | Medium |
| 5 | **Security e-mail on new login** | Low | Owner would not notice a hijack. | Small |
| 6 | **Admin audit log** | Low | No record of who created/revoked invitations. | Small |

None of these block a private deployment for one owner. Items 1 and 2 are the ones
to do before inviting more people.

---

## 11. Comparison with a $0 alternative

| Option | Cost | Password storage | Recovery | Verdict |
| --- | --- | --- | --- | --- |
| **This app** | $0 | PBKDF2-SHA256 600k + SHA-256, salted | Recovery key + e-mail reset | Full control, Persian UX, no third-party script; security is *ours* to maintain |
| Clerk free | $0 (10 k MAU) | Managed, likely Argon2id/bcrypt + rotation | Managed e-mail + SSO | Strong, but English-first widgets, external script, no invite-only primitive, and the owner's data leaves the app |
| Supabase Auth free | $0 | Managed (bcrypt) | Managed | Good, but projects pause after inactivity on the free tier and it is another dashboard for a non-programmer |
| Auth.js on Workers | $0 | Depends on adapter | Depends | Cookie/session format is framework-shaped; more moving parts than the 200 lines we actually need |

**Conclusion:** for a single-owner Persian app on a $0 budget, a small custom
implementation that is *explicitly reviewed* is a reasonable choice — provided the
open items above are tracked and the derived-key weakness is understood. For a
public multi-tenant product, use a managed provider or passkeys instead.

---

## 12. Test evidence

| Claim | Test |
| --- | --- |
| PBKDF2 parameters are exactly SHA-256 / 600 000 / 256 bits | `tests/client/auth.test.ts` |
| Unknown accounts are indistinguishable (dummy hash + decoy salt) | code path + `tests/worker/security-helpers.test.ts` |
| Constant-time comparison | `tests/worker/security-helpers.test.ts` |
| Raw session tokens never reach D1 | `tests/worker/auth-guards.test.ts` |
| Guards: 401/403 matrix | `tests/worker/auth-guards.test.ts` |
| Every owned-table query is user-scoped | `tests/worker/ownership.test.ts` |
| CSRF matrix | `tests/worker/security-helpers.test.ts` |
| CSP forbids framing, objects, third-party scripts | `tests/worker/security-helpers.test.ts` |
| AES-GCM round-trip, unique IV, refuses to run without a key | `tests/worker/security-helpers.test.ts` |
| Invitation is single-use | `npm run smoke` check 12 |
| Plaintext invitation codes are never returned | `npm run smoke` check 7 |
| Cross-user isolation | `npm run smoke` checks 28–30 |
