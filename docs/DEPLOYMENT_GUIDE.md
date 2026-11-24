# DEPLOYMENT_GUIDE — My Media Universe

Audience: whoever runs the terminal (the owner can do it with the Persian guide in
`SETUP_GUIDE.md`). Everything here uses free tiers only.

---

## 0. Prerequisites

- Node.js 20+ (LTS recommended)
- A Cloudflare account
- `wrangler` (installed by `npm install`)
- Optional: a domain managed by Cloudflare (otherwise `*.workers.dev` works)

Check the toolchain:

```bash
node -v        # >= 20
npx wrangler --version
```

## 1. Log in to Cloudflare

```bash
npx wrangler login
```

Opens a browser; click **Allow**. Alternatively set `CLOUDFLARE_API_TOKEN` in the
environment (CI). Never paste a token into a file that gets committed.

## 2. Create the D1 database

```bash
npx wrangler d1 create mmu-db
```

Copy the returned `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "mmu-db",
    "database_id": "PASTE-HERE",
    "migrations_dir": "migrations"
  }
]
```

Then apply the schema remotely:

```bash
npx wrangler d1 migrations apply mmu-db --remote
```

Verify:

```bash
npx wrangler d1 execute mmu-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expect 21 tables.

## 3. Configure secrets

Secrets are **not** in `wrangler.jsonc` and **not** in Git. Set them per environment:

```bash
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
npx wrangler secret put APP_BASE_URL
```

Generate `ENCRYPTION_KEY` with:

```bash
openssl rand -base64 32
```

Generate `ADMIN_BOOTSTRAP_SECRET` with:

```bash
openssl rand -base64 24
```

Non-secret variables live in `wrangler.jsonc` under `vars`:

```jsonc
"vars": {
  "APP_NAME": "My Media Universe",
  "GOOGLE_DRIVE_FOLDER_NAME": "My Media Universe",
  "ENV": "production"
}
```

> **Important:** `ENV` must be `production` on the deployed Worker. It switches on
> the `Secure` cookie flag, strict e-mail behaviour (a missing Resend key becomes an
> error instead of a console log), and hides stack traces from API responses.

### Secret reference

| Name | Required | Purpose |
| --- | --- | --- |
| `TMDB_API_KEY` | yes (for TMDB features) | Server-side TMDB access token |
| `APP_BASE_URL` | yes | Canonical origin for CSRF and OAuth redirect |
| `ENCRYPTION_KEY` | yes for Drive | AES-GCM key for Google tokens at rest |
| `GOOGLE_CLIENT_ID` / `_SECRET` | for Drive | OAuth 2.0 PKCE client |
| `RESEND_API_KEY` / `EMAIL_FROM` | for e-mail | Verification and reset mails |
| `ADMIN_BOOTSTRAP_SECRET` | first run only | Creates the first admin — **remove afterwards** |
| `GOOGLE_DRIVE_FOLDER_NAME` | no | Backup folder name (plain var) |

## 4. Build and deploy

```bash
npm ci
npm run build          # outputs dist/client
npx wrangler deploy
```

`wrangler.jsonc` already points `assets.directory` at `./dist/client`, so the same
deploy ships the SPA, the Worker and the cron trigger.

Confirm:

```bash
curl -s https://<your-worker>.workers.dev/api/health
# {"ok":true,"service":"My Media Universe","time":"..."}
```

## 5. First run

1. Open `https://<your-worker>.workers.dev/setup`.
2. Create the admin account using `ADMIN_BOOTSTRAP_SECRET`.
3. **Delete the bootstrap secret immediately:**
   ```bash
   npx wrangler secret delete ADMIN_BOOTSTRAP_SECRET
   ```
   The endpoint refuses to run once an admin exists, but removing the secret is
   defence in depth.
4. Save the recovery key shown once. It is not recoverable later.

## 6. Custom domain (optional, free)

1. Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings** →
   **Domains & Routes** → **Add** → **Custom domain**.
2. Enter a hostname on a zone you already have in Cloudflare (e.g.
   `media.example.com`). Cloudflare creates the DNS record and the certificate.
3. Update `APP_BASE_URL` to the new origin and redeploy:
   ```bash
   npx wrangler secret put APP_BASE_URL
   ```
4. Update the Google OAuth **Authorized redirect URIs** to
   `https://media.example.com/api/backup/google/callback`.

## 7. Updating the app

```bash
git pull
npm ci
npx wrangler d1 migrations apply mmu-db --remote   # only when migrations changed
npm run build
npx wrangler deploy
```

Migrations are forward-only. Never edit an applied migration; add the next file.

## 8. Rollback

Cloudflare keeps previous deployments:

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

Database rollbacks are not automatic — restore from the previous backup
(`POST /api/backup/:id/restore` or re-import the exported JSON). This is exactly
why the backup feature exists.

## 9. Verifying a production deploy

```bash
BASE_URL=https://<your-worker>.workers.dev \
ORIGIN=https://<your-worker>.workers.dev \
ADMIN_BOOTSTRAP_SECRET=... \
npm run smoke
```

The smoke suite creates a second admin if none exists; **do not run it against a
production Worker you care about** without first removing the bootstrap secret.
It is intended for local/staging.

## 10. Operational checks

| Check | How often | Command |
| --- | --- | --- |
| Worker errors | weekly | dashboard → Workers → Logs, filter `error` |
| D1 rows written | monthly | dashboard → D1 → metrics |
| Backup cron fired | after enabling auto-backup | `wrangler tail` at 03:17 UTC, or check Drive folder for `mmu-auto-*.json` |
| Secrets inventory | quarterly | `npx wrangler secret list` |
| Dependency advisories | monthly | `npm audit` |

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `10021` / `database_id` not found | Wrong id in `wrangler.jsonc` | Re-run `d1 create`, paste the id |
| Login loops on `*.workers.dev` | `APP_BASE_URL` mismatch | Set it to the exact public origin |
| `google_not_configured` | OAuth secrets missing | `wrangler secret put` both values |
| E-mails not delivered | Domain not verified in Resend | Add the domain and its DNS records |
| Cron never fires | Triggers not deployed | Redeploy after adding `triggers.crons` |
| 1027 errors in logs | Daily request quota exhausted | Wait for 00:00 UTC reset; see `COSTS_AND_LIMITS.md` |
