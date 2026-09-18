# CPR Training Management System - Deployment Guide

**Last Updated**: 2026-06-28
**App**: https://cpr.kpbc.ca (Production), https://stagecprapp.kpbc.ca (Staging)
**Repo**: https://github.com/Kaizenpbc/cpr-fastify

This guide covers **routine deployments** of the CPR Training Management System.

---

## 1. Pre-Deployment Checklist

Before deploying any changes, verify:

- [ ] **All tests pass locally**
  ```bash
  cd backend && npx vitest run
  cd frontend && npx vitest run
  ```
- [ ] **TypeScript compiles cleanly**
  ```bash
  cd backend && npx tsc --noEmit
  ```
- [ ] **Changes reviewed** -- review the diff for unintended changes, debug code, or hardcoded credentials
- [ ] **Database migrations** -- if adding a new migration file, verify it runs cleanly against a test database. Migrations are forward-only; there is no automated rollback.
- [ ] **Environment variables** -- if new env vars are required, they must be added to the server's `.htaccess` file *before* deploying the code that uses them

---

## 2. CI/CD Pipeline Overview

The CI/CD pipeline is defined in `.github/workflows/ci.yml` and runs on GitHub Actions.

### Triggers

- **Push to `master`**: Runs full pipeline (test + build + deploy)
- **Pull request to `master`**: Runs test + build only (no deploy)

### Pipeline Jobs

| Job | What It Does | Runs On |
|-----|-------------|---------|
| **Backend** | `npm ci` -> `npx tsc --noEmit` -> `npx vitest run` | ubuntu-latest, Node 22 |
| **Frontend** | `npm ci` -> `npx vitest run` -> `VITE_API_URL=... npx vite build` | ubuntu-latest, Node 22 |
| **Deploy** | Builds backend (`tsc`), downloads frontend artifact, deploys both via FTPS, restarts Passenger, runs health check | Only on `master` push, after both test jobs pass |
| **Notify** | Sends success/failure email notification | After deploy completes or fails |

### Deploy Job Details

The deploy job:
1. Builds backend via `npx tsc` and removes sourcemaps
2. Downloads the frontend build artifact from the frontend job
3. Uploads `backend/dist/` to `cpr.kpbc.ca/backend/dist/` via FTPS
4. Uploads `frontend/dist/` to `cpr.kpbc.ca/public/` via FTPS
5. Deploys `.htaccess` for SPA routing in the public directory
6. Restarts Passenger via cPanel API (`touch tmp/restart.txt`)
7. Runs a health check loop (up to 8 attempts over ~3 minutes) against `GET /api/v1/health`

---

## 3. Backend Deployment

### 3.1 Automatic Deploy (CI/CD -- Primary Method)

Pushing to `master` triggers the full CI/CD pipeline described above. This is the standard deployment method.

```bash
git push origin master
# Monitor: https://github.com/Kaizenpbc/cpr-fastify/actions
```

### 3.2 What CI uploads

CI uploads a self-contained backend bundle (`backend/build.mjs`, esbuild) plus the built frontend to **both** environments and restarts each by touching `tmp/restart.txt`; nothing is built or installed on the server.

### 3.3 Manual Deploy (FTPS)

Use this when CI/CD is unavailable or for emergency hotfixes:

1. **Build locally**:
   ```bash
   cd backend
   npx tsc
   ```

2. **Upload** compiled JS from `backend/dist/` to the server at `/home/kaizenmo/cpr.kpbc.ca/backend/dist/` via FTPS (e.g., FileZilla with Explicit FTPS)

3. **If dependencies changed**, also upload `package.json` and `package-lock.json`, then run `npm install --omit=dev` on the server

4. **Restart Passenger**:
   ```bash
   # Via FTPS -- upload any file to tmp/restart.txt
   echo "restart" | curl --ftp-ssl -k -u "$FTP_USERNAME:$FTP_PASSWORD" \
     -T - "ftp://$FTP_SERVER/cpr.kpbc.ca/tmp/restart.txt"
   ```
   Or touch the file via cPanel File Manager.

### 3.4 Database Migrations

Migrations run **automatically on startup** via the migration system (`backend/src/config/migrations.ts`).

- Migrations are tracked in the `schema_migrations` table
- Each migration runs once (idempotent tracking by version number)
- Migrations are **forward-only** -- there is no automated rollback
- To manually reverse a migration, see `ROLLBACK.md` (Database Rollback section)

No manual intervention is required for migrations during a normal deploy. When Passenger restarts the Node.js process, `runMigrations()` is called during startup before the server begins accepting requests.

---

## 4. Frontend Deployment

The frontend must be built **locally** because the TMD shared hosting server runs out of memory (OOM) when running `vite build`.

### 4.1 Build Locally

```bash
cd frontend
VITE_API_URL=https://cpr.kpbc.ca/api/v1 npx vite build
```

This produces the `frontend/dist/` directory with the compiled SPA.

For staging:
```bash
VITE_API_URL=https://stagecprapp.kpbc.ca/api/v1 npx vite build
```

### 4.2 Upload to Server

**Option A: CI/CD (automatic)** -- The GitHub Actions deploy job handles this. The frontend build artifact is uploaded to `cpr.kpbc.ca/public/` via FTPS.

**Option B: cPanel File Manager API** -- Upload `dist/` contents to `/home/kaizenmo/cpr.kpbc.ca/public/` using the cPanel Fileman API.

**Option C: FTPS** -- Upload the contents of `frontend/dist/` to `/home/kaizenmo/cpr.kpbc.ca/public/` using an FTPS client.

After uploading, the `.htaccess` in `public/` handles SPA routing (rewrites non-file requests to `index.html`).

---

## 5. Post-Deployment Verification

After every deployment, verify the following:

### 5.1 Health Endpoint

```bash
curl -s https://cpr.kpbc.ca/api/v1/health
```

Expected response: `{"status":"UP","database":"UP","timestamp":"..."}`

If `status` is `DEGRADED` or the endpoint is unreachable, check the Incident Response runbook (`docs/Incident_Response.md`).

### 5.2 Metrics Endpoint

```bash
curl -s https://cpr.kpbc.ca/api/v1/metrics
```

Review for:
- Error rate spikes (compare to pre-deploy baseline)
- Unusual latency increases
- Slow request counts

### 5.3 Sentry

Check the Sentry dashboard for new unhandled exceptions that correlate with the deploy timestamp. New errors appearing immediately after a deploy likely indicate a regression.

### 5.4 Spot-Check Key Functionality

- [ ] Login page loads at `https://cpr.kpbc.ca/login`
- [ ] Login succeeds with a test account
- [ ] Dashboard loads after login
- [ ] SPA deep links work (e.g., `https://cpr.kpbc.ca/instructor/dashboard`)
- [ ] If the deploy included specific feature changes, verify those features manually

---

## 6. Rollback Procedure

For full details, see `ROLLBACK.md` in the repository root.

### Quick Rollback (< 5 minutes)

```bash
git log --oneline -10              # Identify the bad commit
git revert HEAD --no-edit          # Revert the last commit
git push origin master             # Triggers CI/CD auto-deploy
```

Monitor the deploy:
```bash
gh run watch
# Or: https://github.com/Kaizenpbc/cpr-fastify/actions
```

### Emergency Restart (No Redeploy)

```bash
echo "restart" | curl --ftp-ssl -k -u "$FTP_USERNAME:$FTP_PASSWORD" \
  -T - "ftp://$FTP_SERVER/cpr.kpbc.ca/tmp/restart.txt"
```

### Emergency Rollback (Restore Previous Build)

On the server:
```bash
cd /home/kaizenmo/cpr.kpbc.ca
rm -rf backend/dist
cp -r backend/dist-backup backend/dist
touch tmp/restart.txt
```

Note: `dist-backup/` is overwritten on every deploy. Copy it elsewhere first if you may need it again.

### Database Rollback

Migrations are forward-only. To reverse a problematic migration:
1. Identify the version in `schema_migrations`
2. Manually run the reverse SQL
3. Delete the row: `DELETE FROM schema_migrations WHERE version = N;`

---

## 7. Staging Deployment

Staging is at **https://stagecprapp.kpbc.ca** and follows the same process as production with different targets.

| Aspect | Production | Staging |
|--------|-----------|---------|
| URL | `https://cpr.kpbc.ca` | `https://stagecprapp.kpbc.ca` |
| App directory | `/home/kaizenmo/cpr.kpbc.ca/` | `/home/kaizenmo/stagecprapp.kpbc.ca/` |
| Source directory | `/home/kaizenmo/cpr.kpbc.ca-src/` | (same repo, different deploy target) |
| Deploy | GitHub Actions `deploy` job | GitHub Actions `deploy-staging` job |
| Trigger | every push to `master` | every push to `master` (E2E runs here afterwards) |
| VITE_API_URL | `https://cpr.kpbc.ca/api/v1` | `https://stagecprapp.kpbc.ca/api/v1` |
| Database | `kaizenmo_cpr` | Separate staging database |

Deploy to staging first to validate changes before pushing to production.

---

## 8. Server Details

### Hosting

| Detail | Value |
|--------|-------|
| **Provider** | TMD Hosting (shared hosting) |
| **Web server** | LiteSpeed with Passenger (Node.js app server) |
| **Node.js** | v22 |
| **OS** | Linux (shared hosting -- no root access) |
| **Resource limits (LVE)** | 100 processes, 2 GB RAM, 2 CPU cores |
| **SSL** | LiteSpeed handles HTTPS termination; HSTS enabled |

### Server Paths

| Path | Purpose |
|------|---------|
| `/home/kaizenmo/cpr.kpbc.ca/` | Production app root |
| `/home/kaizenmo/cpr.kpbc.ca/backend/dist/` | Compiled backend JS |
| `/home/kaizenmo/cpr.kpbc.ca/public/` | Frontend static files |
| `/home/kaizenmo/cpr.kpbc.ca/server.js` | Passenger entry point |
| `/home/kaizenmo/cpr.kpbc.ca/tmp/restart.txt` | Touch to restart Passenger |
| `/home/kaizenmo/cpr.kpbc.ca/.htaccess` | Environment variables (SetEnv) |
| `/home/kaizenmo/cpr.kpbc.ca-src/` | Git source checkout |
| `/home/kaizenmo/backup-cpr.sh` | Database backup script (cron at 2:00 AM) |

### Passenger Entry Point

The `server.js` file sets up `NODE_PATH` for module resolution and imports the Fastify app:

```javascript
process.env.NODE_PATH = __dirname + "/backend/node_modules";
require('module').Module._initPaths();
process.chdir(__dirname + "/backend");
import(__dirname + "/backend/dist/index.js").catch(err => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
```

### Restart Mechanism

Passenger watches `tmp/restart.txt` for timestamp changes. Touching or writing to this file triggers a graceful restart of the Node.js process. The application handles `SIGTERM` for graceful shutdown (10-second timeout, closes HTTP connections and database pool).

### Cron Jobs

| Schedule | Script | Purpose |
|----------|--------|---------|
| `2:00 AM` daily | `backup-cpr.sh` | MariaDB dump with 7-day rotation |
| `03:30 UTC` daily | GitHub Actions `backup.yml` | Test-restore + offsite copy to Backblaze B2 (90-day retention) |
