# CPR Training Management System

A multi-portal web application for managing CPR/First Aid training operations — scheduling, billing, instructor management, certification tracking, and vendor invoicing.

**Production**: https://cpr.kpbc.ca · **Staging**: https://stagecprapp.kpbc.ca
**Repo**: https://github.com/Kaizenpbc/cpr-fastify

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Fastify 5, TypeScript (ESM), Zod validation, bundled with esbuild |
| Frontend | React 18, MUI 5, Vite, TypeScript |
| Database | MariaDB 11.4 in production (MySQL-compatible; migrations are written to run on either), forward-only migrations |
| Auth | JWT access tokens + rotated, server-tracked refresh tokens; bcrypt; per-route role guards |
| Email | Resend API |
| CI/CD | GitHub Actions → lint/typecheck/tests → FTPS deploy to staging and production → Playwright E2E |
| Hosting | TMD shared cPanel: LiteSpeed (Apache-compatible) + Phusion Passenger |

## Repository layout

```
backend/
  src/
    config/        env, database, migrations (+ schemaHelpers), logger
    plugins/       auth (requireAuth / requireRole), errorHandler, metrics, swagger
    repositories/  data access (MySQL)
    routes/        Fastify route modules (registered in routes/index.ts)
    services/      business logic (auth, billing, HR, email, PDF, cert reminders)
    utils/         html escaping, csv, pagination, tax config, audit log
    __tests__/     vitest unit tests
  build.mjs        esbuild bundle -> dist/index.js
  scripts/         generate-api-docs.ts (docs/API.md)
frontend/
  src/
    components/gtacpr/   design-system primitives (AdminShell, DataTable, ConfirmDialog, ...)
    components/portals/  the 8 role portals
    contexts/            Auth, Theme, Snackbar, Toast, Notification, Realtime
    services/            axios API client + services
    utils/formatters.ts  the one place for currency / date / tax formatting
  public/.htaccess       SPA rewrite + asset caching (deployed with the build)
tests/e2e/               Playwright suite (runs against staging in CI)
docs/                    audit, action plan, API reference, runbooks, program documentation
```

### Portals

| Portal | Role | Purpose |
|--------|------|---------|
| System Admin | `sysadmin` | Users, orgs, courses, vendors, students, certifications, audit log |
| Super Admin | `superadmin` | Cross-org management, pricing rules |
| Course Admin | `admin` / `courseadmin` | Schedule courses, manage instructors, vendor invoice approval |
| Organization | `organization` | Request courses, rosters, invoices, payments |
| Instructor | `instructor` | Schedule, availability, attendance, timesheets, profile |
| Accounting | `accountant` | Billing, invoicing, AR aging, payment verification |
| HR | `hr` | Personnel, profile changes, pay rates, payroll |
| Vendor | `vendor` | Submit and track invoices |

## Local development

Prerequisites: Node.js 22, MariaDB 11 or MySQL 8, npm.

```bash
git clone https://github.com/Kaizenpbc/cpr-fastify.git
cd cpr-fastify
npm install --legacy-peer-deps        # single root install (workspaces)
cp .env.example .env                  # DB credentials + JWT secrets (>= 32 chars)

npm run dev                           # backend :3001 + frontend :5173 together
```

Useful scripts (repo root):

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` in both packages |
| `npm run lint` | ESLint in both packages (0 errors required; warnings are tracked debt) |
| `npm test` | vitest in both packages |
| `npm run build` | backend bundle + type-checked frontend build |
| `cd backend && npm run docs:api` | regenerate `docs/API.md` from the route table |
| `npx playwright test --project=chromium` | E2E against staging (`BASE_URL` to override) |

A husky pre-commit hook runs `eslint --fix` on staged files.

### Environment variables (backend)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DB_HOST` / `DB_PORT` | No | `localhost` / `3306` | |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Yes | — | |
| `DB_POOL_SIZE` | No | `6` | per-process pool; shared hosting has a low MySQL connection cap |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Yes | — | min 32 chars; the server refuses to boot otherwise |
| `ACCESS_TOKEN_EXPIRY` / `REFRESH_TOKEN_EXPIRY` | No | `15m` / `7d` | |
| `PORT` | No | `3001` | |
| `FRONTEND_URL` | No | `http://localhost:5173` | CORS origin, CSRF origin check, links in emails |
| `BCRYPT_SALT_ROUNDS` | No | `12` | |
| `HST_RATE` | No | `0.13` | seeded into `system_config`; frontend uses `VITE_HST_RATE` |
| `RESEND_API_KEY` / `EMAIL_FROM` | No | — / `noreply@kpbc.ca` | email disabled (mock mode) when unset |
| `SENTRY_DSN` | No | — | |
| `NODE_ENV` | No | `development` | `production` enables CSP, trustProxy, hides Swagger |

## Authentication

1. `POST /api/v1/auth/login` → access token in the body; refresh token as an httpOnly, secure, `SameSite=Strict` cookie scoped to `/api/v1/auth/refresh`.
2. Access token in `Authorization: Bearer <token>` (15 min).
3. `POST /api/v1/auth/refresh` rotates the pair. Refresh tokens are stored hashed server-side; reuse of a rotated token revokes the user's whole token family.
4. `POST /api/v1/auth/logout` revokes the cookie token. Password change/reset revokes everything.
5. `POST /api/v1/auth/forgot-password` → emailed link → `POST /api/v1/auth/reset-password` (1-hour single-use token).

Lockout: 5 failed logins in 15 minutes locks the account for 15 minutes.

## API

All application endpoints live under `/api/v1`; `/health` and `/metrics` are root-level.
The full reference is generated from the route table: [docs/API.md](docs/API.md).
In non-production, Swagger UI is served at `/api/v1/docs`.

## Database

Forward-only migrations in `backend/src/config/migrations.ts` run at startup under a MySQL named lock, using `config/schemaHelpers.ts` so each is idempotent and runs on both MariaDB and MySQL 8. Core business tables predate the migration system (see the note in `docs/AUDIT_2026-09-17.md` §6 about a baseline dump).

## CI/CD

`.github/workflows/ci.yml` on every push/PR to `master`:

1. **Backend** — `npm audit` (high+), `tsc`, ESLint, vitest
2. **Frontend** — `tsc`, ESLint, vitest, production build (+ a staging build)
3. **Deploy to staging** and **Deploy to production** — bundle the backend (esbuild), smoke-test the bundle, FTPS upload backend + frontend, touch `tmp/restart.txt`, health-check
4. **E2E** — Playwright against staging after the staging deploy
5. **Email notification** — success/failure

See `ROLLBACK.md` for reverting.

## Security notes

- Every non-public route has `requireAuth` / `requireRole`; org/vendor/instructor data is scoped in SQL by the caller's identity
- Parameterised SQL throughout; Zod-validated bodies; HTML-escaped email/PDF templates
- Origin-checked state-changing requests (CSRF), Helmet + CSP, HSTS at the edge
- Rate limits: 100 req/min global, 10 req/min on auth endpoints (real client IP via `trustProxy`)
- Uploads: size cap, MIME + magic-byte checks, random server-side names, never served
- Audit log for auth and admin actions (`GET /sysadmin/audit-logs`)

## Documentation

- `docs/AUDIT_2026-09-17.md` — full audit (security, links, dead code, API contract, usability, performance, tests/CI)
- `docs/ACTION_PLAN_2026-09-17.md` — the phased plan and its status
- `docs/Incident_Response.md`, `docs/Customer_Onboarding.md`, `docs/Customer_Offboarding.md`
- `docs/Program Documentation/` — architecture, deployment, DR, security, PIPEDA SOP, MSA/DPA, user guide
- `docs/archive/` — superseded June 2026 reviews, the Express→Fastify cutover record, and UAT tooling

## License

Proprietary. All rights reserved.
