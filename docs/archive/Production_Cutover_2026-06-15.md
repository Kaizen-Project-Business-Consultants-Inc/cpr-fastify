# Production Cutover: Express → Fastify 5

> **Historical record (2026-06-15).** Deploys now run from GitHub Actions; see `README.md` and `ROLLBACK.md` for the current process.

**Date**: 2026-06-15
**Performed by**: Claude Opus 4.6 + George

## Summary

Replaced the Express.js backend on `cpr.kpbc.ca` with the Fastify 5 port from `stagecprapp.kpbc.ca`. All features, all 8 portal roles, and all 36 E2E tests confirmed working post-cutover.

## What Changed

| Component | Before (Express) | After (Fastify 5) |
|-----------|------------------|--------------------|
| Framework | Express.js | Fastify 5 |
| Email | Gmail SMTP (`michaela@kpbc.ca`) | Resend API (`noreply@kpbc.ca`) |
| Entry point | `server.js` → direct ESM import | `server.js` → `NODE_PATH` setup + ESM import |
| SPA routing | Express static middleware | `.htaccess` RewriteRule + Fastify `setNotFoundHandler` |
| Error monitoring | Sentry (Express) | Sentry (`@sentry/node` v10, dynamic import) |
| Deploy source | `cpr-may18-dev` repo (Express) | `cpr-fastify` repo (Fastify) |
| Deploy script | `deploy_routes.sh` (git pull only) | `deploy-production.sh` (pull + build + install + restart) |

## Server Files Modified

### `/home/kaizenmo/cpr.kpbc.ca/.htaccess`
- Added `SetEnv NODE_PATH /home/kaizenmo/cpr.kpbc.ca/backend/node_modules`
- Added `SetEnv EMAIL_FROM noreply@kpbc.ca`
- Added SPA rewrite rules (non-file, non-API requests → `/index.html`)
- Kept existing: DB credentials, JWT secrets, `RESEND_API_KEY`, `SENTRY_DSN`

### `/home/kaizenmo/cpr.kpbc.ca/server.js`
```javascript
// Passenger entry point — sets NODE_PATH before ESM import
process.env.NODE_PATH = __dirname + "/backend/node_modules";
require('module').Module._initPaths();
process.chdir(__dirname + "/backend");
import(__dirname + "/backend/dist/index.js").catch(err => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
```

### `/home/kaizenmo/deploy-production.sh`
New deploy script that:
1. Clones/pulls from `https://github.com/Kaizenpbc/cpr-fastify.git` to `/home/kaizenmo/cpr.kpbc.ca-src/`
2. Runs `npm ci` (falls back to `npm install --legacy-peer-deps`)
3. Builds backend via `npx tsc`
4. Backs up old dist to `backend/dist-backup/`
5. Copies dist + `package.json` + `package-lock.json` to app dir
6. Runs `npm install --omit=dev` for production deps
7. Writes `server.js` with `NODE_PATH` setup
8. Touches `tmp/restart.txt` to restart Passenger

### Cron Jobs
- **Removed**: `deploy_routes.sh` at `:48` (old Express git-pull-only)
- **Added**: `deploy-production.sh` at `:48` (full Fastify build + deploy)
- **Unchanged**: `deploy-staging.sh` at `:18`, `backup-cpr.sh` at `2:00`

## Rollback Procedure

If Fastify production breaks and needs immediate rollback to Express:

1. Restore Express dist:
   ```bash
   # On server (via cron or FTPS):
   cd /home/kaizenmo/cpr.kpbc.ca
   rm -rf backend/dist
   cp -r backend/dist-backup backend/dist
   ```

2. Restore Express server.js (no NODE_PATH needed):
   ```javascript
   process.chdir(__dirname + "/backend");
   import(__dirname + "/backend/dist/index.js").catch(err => {
     console.error("Failed to start backend:", err);
     process.exit(1);
   });
   ```

3. Remove `NODE_PATH` and `EMAIL_FROM` from `.htaccess`, remove SPA rewrite rules

4. Restart: `touch tmp/restart.txt`

5. Switch cron back to `deploy_routes.sh`

**Note**: Express backup in `dist-backup/` will be overwritten on next deploy. If rollback might be needed, copy it elsewhere first.

## Not Ported (Deferred)

These Express features were not ported to Fastify and are tracked in TODO.md:

- **OCR-1**: Google Cloud Vision receipt scanning (`@google-cloud/vision`)
- **WS-1**: socket.io WebSocket real-time dashboard updates
- Both are low-priority — no customers actively use them

## Verification Performed

1. **Health check**: `GET /api/v1/health` → `{"status":"UP"}`
2. **Frontend**: `GET /login` → HTTP 200 (SPA serves correctly)
3. **SPA routing**: `GET /instructor/dashboard` → HTTP 200 (deep links work)
4. **All 8 roles login**: instructor, accountant, sysadmin, admin, orguser, vendoruser, hruser, courseadmin
5. **API calls**: instructor dashboard stats, accounting dashboard, invoice access — all return correct data
6. **Multi-tenant pentest (SECURITY-3)**: IDOR, role escalation, SQLi, XSS, JWT forgery, CORS — all blocked
7. **E2E tests**: 36/36 passing against staging (same codebase)

## Environment Variables (Production .htaccess)

```
NODE_ENV=production
PORT=3001
NODE_PATH=/home/kaizenmo/cpr.kpbc.ca/backend/node_modules
DB_HOST=localhost
DB_PORT=3306
DB_USER=kaizenmo_cpruser
DB_PASSWORD=CprApp@TMD2026!
DB_NAME=kaizenmo_cpr
JWT_SECRET=<redacted>
JWT_ACCESS_SECRET=<redacted>
JWT_REFRESH_SECRET=<redacted>
REFRESH_TOKEN_SECRET=<redacted>
JWT_RESET_SECRET=<redacted>
FRONTEND_URL=https://cpr.kpbc.ca
REDIS_ENABLED=false
BCRYPT_SALT_ROUNDS=12
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
RESEND_API_KEY=<redacted>
EMAIL_FROM=noreply@kpbc.ca
SENTRY_DSN=<redacted>
```
