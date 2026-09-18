# Rollback Procedure

Every push to `master` deploys to **both** environments through GitHub Actions
(`.github/workflows/ci.yml`): staging (`stagecprapp.kpbc.ca`) and production (`cpr.kpbc.ca`).
CI uploads a self-contained backend bundle
and the built frontend over FTPS, touches `tmp/restart.txt` to restart Passenger, and
health-checks each environment.

## Quick rollback (about 10 minutes end to end)

1. Find the last known good commit:
   ```bash
   git log --oneline -10
   ```
2. Revert and push (this is just another deploy):
   ```bash
   git revert HEAD --no-edit          # last commit
   # or a range:
   git revert HEAD~N..HEAD --no-edit
   git push origin master
   ```
3. Watch it land:
   ```bash
   gh run watch
   ```
   or https://github.com/Kaizenpbc/cpr-fastify/actions

The run is green only if lint, type-check, unit tests, the bundle smoke test, both
deploys, both health checks and the Playwright E2E suite against staging all pass.

## If the app will not start after a deploy

Symptoms: health returns 503, or pages hang on "Initial Loading".

- The backend is a single bundled file (`backend/dist/index.js`). A few packages are
  still loaded from the host's `node_modules` (see `EXTERNAL` in `backend/build.mjs`).
  If one of those was upgraded in the repo, the host copy is stale — either add the
  package to the bundle (remove it from `EXTERNAL`) or install it on the host.
- Restart without redeploying (FTPS credentials from GitHub Secrets):
  ```bash
  echo "restart-$(date +%s)" | curl --ssl-reqd --insecure -u "$FTP_USERNAME:$FTP_PASSWORD" \
    -T - "ftp://$FTP_SERVER/cpr.kpbc.ca/tmp/restart.txt"
  ```
  (use `stagecprapp.kpbc.ca` for staging). From cPanel: File Manager → `cpr.kpbc.ca/tmp/restart.txt`
  → Edit → change anything → Save.

## Database

Migrations are forward-only and run at startup under a MySQL named lock
(`backend/src/config/migrations.ts`). To undo one:

1. Reverse its SQL by hand (the guarded helpers in `config/schemaHelpers.ts` make the
   forward direction idempotent, so re-running after a fix is safe).
2. `DELETE FROM schema_migrations WHERE version = N;`
3. Redeploy or restart.

Nightly `mysqldump` runs at 02:00 on the server with 7-day rotation (`/home/kaizenmo/backup-cpr.sh`).
Every night at 03:30 UTC `.github/workflows/backup.yml` test-restores that dump and copies it (plus vendor uploads) to the Backblaze B2 bucket `GTA-CPR-Backups` with 90-day retention. To restore from offsite: Backblaze → Buckets → GTA-CPR-Backups → db → download the wanted `cpr_*.sql.gz`.

## Verify after a rollback

1. `curl -s https://cpr.kpbc.ca/api/v1/health` → `{"status":"UP"...}`
2. Open https://cpr.kpbc.ca/login in a fresh tab (Ctrl+F5) — the login form renders.
3. Log in with a test account and click through the sidebar.

## Monitoring

- CI/CD: https://github.com/Kaizenpbc/cpr-fastify/actions (email on success/failure)
- Health: `GET /api/v1/health` (200 UP / 503 DEGRADED); UptimeRobot polls every 5 min
- Metrics: `GET /metrics` (root-level)
- Errors: Sentry when `SENTRY_DSN` is set; client errors via `POST /api/v1/client-errors`
- Server logs: cPanel → Metrics → Errors (LiteSpeed/Passenger)
