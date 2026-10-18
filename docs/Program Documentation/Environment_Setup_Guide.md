# CPR Training Management System -- Environment Setup Guide

This guide covers setting up a local development environment for the CPR Training Management System, including backend (Fastify/Node.js), frontend (React/Vite), and database (MySQL).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Cloning the Repository](#cloning-the-repository)
3. [Backend Setup](#backend-setup)
4. [Frontend Setup](#frontend-setup)
5. [Running Tests](#running-tests)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Common Issues and Troubleshooting](#common-issues-and-troubleshooting)
8. [VS Code Recommended Extensions](#vs-code-recommended-extensions)

---

## Prerequisites

| Tool | Required Version | Notes |
|------|-----------------|-------|
| **Node.js** | v22.x (LTS) | The CI pipeline uses Node 22. Use [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows) to manage versions. |
| **npm** | v10.x+ | Ships with Node.js 22. |
| **MySQL** | 8.x | InnoDB engine, utf8mb4 charset. Can use MySQL Community Server, XAMPP, MAMP, or Docker. |
| **Git** | 2.x+ | Standard Git installation. |

Optional but recommended:
- **VS Code** -- primary IDE with TypeScript support
- **MySQL Workbench** or **DBeaver** -- for database inspection

---

## Cloning the Repository

```bash
git clone <repository-url> cpr-training-system
cd cpr-training-system
```

The project structure is:

```
cpr-training-system/
  backend/          # Fastify API server (TypeScript, ESM)
  frontend/         # React SPA (TypeScript, Vite)
  docs/             # Documentation
  .env.example      # Backend environment template
  .github/          # CI/CD workflows
```

---

## Backend Setup

### 1. Install Dependencies

From the project root:

```bash
npm install --legacy-peer-deps
```

This installs dependencies for both backend and frontend (if using a workspace setup). Alternatively, install them separately:

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit the `.env` file in the project root. Below is the complete list of environment variables:

#### Required Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | string | `development` | Environment: `development`, `production`, or `test` |
| `PORT` | number | `3001` | Port the API server listens on |
| `DB_HOST` | string | `localhost` | MySQL server hostname |
| `DB_PORT` | number | `3306` | MySQL server port |
| `DB_USER` | string | *(required)* | MySQL username |
| `DB_PASSWORD` | string | *(required)* | MySQL password |
| `DB_NAME` | string | *(required)* | MySQL database name (e.g., `kaizenmo_cpr`) |
| `JWT_ACCESS_SECRET` | string | *(required, min 32 chars)* | Secret key for signing JWT access tokens. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | string | *(required, min 32 chars)* | Secret key for signing JWT refresh tokens. Generate separately from access secret. |

#### Optional Variables with Defaults

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ACCESS_TOKEN_EXPIRY` | string | `15m` | JWT access token lifetime (format: `15m`, `1h`, `7d`) |
| `REFRESH_TOKEN_EXPIRY` | string | `7d` | JWT refresh token lifetime |
| `FRONTEND_URL` | string | `http://localhost:5173` | Frontend origin for CORS and CSRF validation |
| `BCRYPT_SALT_ROUNDS` | number | `12` | Bcrypt hashing rounds (higher = slower but more secure) |
| `EMAIL_FROM` | string | `noreply@kpbc.ca` | Default "from" address for outgoing emails |

#### Optional Variables (Disabled if Not Set)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RESEND_API_KEY` | string | *(not set)* | API key for the Resend email service. Email features are disabled if not set. |
| `HST_RATE` | number | `0.13` | HST tax rate as a decimal (0.13 = 13%). Also stored in system_config DB table. |
| `SENTRY_DSN` | string | *(not set)* | Sentry error tracking DSN. Sentry is disabled if not set or if @sentry/node is not installed. |

#### Example `.env` File

```env
NODE_ENV=development
PORT=3001

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=kaizenmo_cpr

# JWT
JWT_ACCESS_SECRET=your-64-char-hex-string-for-access-tokens
JWT_REFRESH_SECRET=your-64-char-hex-string-for-refresh-tokens
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# App
FRONTEND_URL=http://localhost:5173
BCRYPT_SALT_ROUNDS=12

# Email (optional)
RESEND_API_KEY=
```

### 3. Database Setup

Create the MySQL database:

```sql
CREATE DATABASE kaizenmo_cpr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Create a dedicated database user (recommended):

```sql
CREATE USER 'cpr_dev'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON kaizenmo_cpr.* TO 'cpr_dev'@'localhost';
FLUSH PRIVILEGES;
```

**Important:** The core schema tables (users, organizations, class_types, course_requests, course_students, invoices, payments, etc.) must exist before the application starts. These are typically created by an initial SQL schema dump or seed script. The versioned migration system in `backend/src/config/migrations.ts` handles incremental changes only (login_attempts, token_blacklist, students master table, audit_logs, etc.).

### 4. Running Migrations

Migrations run automatically when the server starts. They are tracked in the `schema_migrations` table and each migration runs exactly once.

To run migrations without starting the server, you can start and immediately stop the server, or import and call `runMigrations()` directly.

### 5. Start the Development Server

```bash
cd backend
npm run dev
```

This uses `tsx watch` for hot-reloading TypeScript. The server will:
1. Connect to the MySQL database
2. Run any pending migrations
3. Initialize the tax configuration from system_config
4. Schedule certification reminder checks (60s after startup, then every 24h)
5. Listen on `http://0.0.0.0:3001`

Verify the server is running:

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{"status":"UP","database":"UP","timestamp":"2026-06-28T..."}
```

### 6. Available Backend Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start dev server with hot reload (tsx watch) |
| `build` | `npm run build` | Compile TypeScript to `dist/` |
| `start` | `npm start` | Run compiled JS from `dist/` (production) |
| `test` | `npm test` | Run tests with vitest |
| `test:watch` | `npm run test:watch` | Run tests in watch mode |
| `lint` | `npm run lint` | Run ESLint on `src/` |

### Backend Architecture Notes

- **Framework:** Fastify 5.x with ESM modules
- **TypeScript:** Target ES2022, NodeNext module resolution
- **Logging:** Pino (structured JSON in production, pretty-printed in development)
- **Validation:** Zod schemas for all request bodies
- **Authentication:** JWT (access + refresh tokens), bcrypt password hashing
- **Database:** mysql2/promise connection pool (20 connections, 100 queue limit)
- **API prefix:** All routes are under `/api/v1/`
- **OpenAPI docs:** Available at `/api/v1/docs` (Swagger UI)
- **Health check:** `GET /health` (outside the /api/v1 prefix)
- **Rate limiting:** 100 req/min globally, 10 req/min on auth endpoints
- **CSRF protection:** Origin header validation on state-changing requests
- **Security headers:** Helmet with CSP in production
- **Metrics:** `GET /metrics` endpoint for performance monitoring

---

## Frontend Setup

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

The frontend uses Vite environment variables (prefixed with `VITE_`). A `.env` file already exists at `frontend/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api/v1` | API base URL. In development with separate servers, set to `http://localhost:3001/api/v1`. When deployed behind a reverse proxy, use `/api/v1`. |
| `VITE_WS_URL` | *(derived from VITE_API_URL)* | WebSocket URL for real-time features. Falls back to `http://localhost:3001` |
| `VITE_APP_NAME` | *(optional)* | Application display name |
| `VITE_APP_VERSION` | *(optional)* | Application version string |
| `VITE_ENVIRONMENT` | *(optional)* | Environment label: development, staging, production |
| `VITE_ANALYTICS_ENABLED` | *(optional)* | Set to `true` to enable analytics in non-production |
| `VITE_LOGGING_ENDPOINT` | *(optional)* | Remote logging endpoint URL |
| `VITE_ANALYTICS_ENDPOINT` | *(optional)* | Remote analytics endpoint URL |

For local development with the backend on port 3001:

```env
VITE_API_URL=http://localhost:3001/api/v1
```

Or if using Vite's proxy (default `/api/v1` path), configure the Vite dev server to proxy API requests.

### 3. Start the Development Server

```bash
npm run dev
```

The frontend dev server starts at `http://localhost:5173` by default with Vite's HMR (Hot Module Replacement).

### 4. Build for Production

```bash
npm run build
```

The production build is output to `frontend/dist/`. In the CI pipeline, the build uses:

```bash
VITE_API_URL=https://cpr.kpbc.ca/api/v1 npx vite build
```

The built files are deployed to the `public/` directory on the server where Fastify serves them as static files with SPA fallback routing.

### 5. Available Frontend Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start Vite dev server (port 5173) |
| `dev:test` | `npm run dev:test` | Start dev server with test config (port 5174) |
| `build` | `npm run build` | Production build to `dist/` |
| `preview` | `npm run preview` | Preview production build locally |
| `test` | `npm test` | Run vitest in watch mode |
| `test:run` | `npm run test:run` | Run tests once (CI mode) |
| `test:coverage` | `npm run test:coverage` | Run tests with coverage report |
| `test:ui` | `npm run test:ui` | Run tests with Vitest UI |
| `test:components` | `npm run test:components` | Run component tests only |
| `test:services` | `npm run test:services` | Run service tests only |
| `test:contexts` | `npm run test:contexts` | Run context tests only |
| `test:portals` | `npm run test:portals` | Run portal component tests only |
| `lint` | `npm run lint` | Run ESLint |

### Frontend Architecture Notes

- **Framework:** React 18 with TypeScript
- **Build tool:** Vite 5.x
- **UI Library:** Material UI (MUI) 5.x with Emotion styling
- **Routing:** React Router DOM 6.x
- **State management:** React Query (TanStack Query 5.x) for server state
- **HTTP client:** Axios
- **Charts:** Recharts
- **Date handling:** date-fns with MUI X Date Pickers
- **Form validation:** Zod
- **Email template HTML:** a plain monospace text box (Monaco was removed 2026-10-17: it loaded from a CDN that the CSP blocks)
- **Testing:** Vitest + React Testing Library + jsdom
- **Path aliases:** `@/*` and `src/*` map to `src/` directory

---

## Running Tests

### Backend Tests

```bash
cd backend
npm test              # Run all tests once
npm run test:watch    # Run in watch mode
```

Backend tests use **Vitest** and run without requiring a database connection (tests mock the database layer).

### Frontend Tests

```bash
cd frontend
npm run test:run      # Run all tests once (CI mode)
npm test              # Run in watch mode
npm run test:coverage # Run with coverage (v8 provider)
npm run test:ui       # Open Vitest UI in browser
```

Frontend tests use **Vitest** with **jsdom** environment, **React Testing Library**, and **@testing-library/user-event**.

### End-to-End Tests

The project has Playwright configuration available for E2E testing. To run E2E tests:

```bash
# Install Playwright browsers (first time)
npx playwright install

# Run E2E tests
npx playwright test
```

**Note:** E2E tests require both the backend and frontend dev servers to be running.

### TypeScript Type Checking

Type checking is separate from test execution:

```bash
# Backend
cd backend && npx tsc --noEmit

# Frontend
cd frontend && npx tsc -b
```

---

## CI/CD Pipeline

The project uses GitHub Actions for CI/CD, defined in `.github/workflows/ci.yml`.

### Pipeline Stages

1. **Backend Job** (ubuntu-latest, Node 22):
   - Install dependencies: `npm ci --legacy-peer-deps`
   - TypeScript check: `npx tsc --noEmit`
   - Run tests: `npx vitest run`

2. **Frontend Job** (ubuntu-latest, Node 22):
   - Install dependencies: `npm ci --legacy-peer-deps`
   - Run tests: `npx vitest run`
   - Production build: `VITE_API_URL=https://cpr.kpbc.ca/api/v1 npx vite build`
   - Upload `frontend/dist` as artifact

3. **Deploy Job** (runs only on push to `master`):
   - Build backend TypeScript
   - Download frontend artifact
   - Deploy via FTPS to production server
   - Deploy SPA `.htaccess` for client-side routing
   - Restart Passenger application server
   - Health check with retry (up to 8 attempts, 20s apart)

4. **Notification Job** (always runs on `master` push):
   - Sends success/failure email notifications via Gmail SMTP

### CI Secrets Required

- `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` -- FTPS deployment credentials
- `SMTP_USERNAME`, `SMTP_PASSWORD` -- Gmail SMTP for CI notifications
- `NOTIFY_EMAIL` -- Email recipient for deploy notifications

---

## Common Issues and Troubleshooting

### Database Connection Errors

**Symptom:** `Error: connect ECONNREFUSED 127.0.0.1:3306`

**Fix:** Ensure MySQL is running and the credentials in `.env` are correct. Verify with:
```bash
mysql -u your_user -p -h localhost -P 3306
```

---

### "Invalid environment variables" on Startup

**Symptom:** Server exits immediately with field validation errors.

**Fix:** The backend validates all environment variables with Zod on startup (`backend/src/config/env.ts`). Common issues:
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be at least 32 characters
- `DB_USER` and `DB_PASSWORD` are required (no defaults)
- `FRONTEND_URL` must be a valid URL (include `http://`)
- `ACCESS_TOKEN_EXPIRY` format must match pattern like `15m`, `1h`, `7d`

---

### CORS Errors in Browser

**Symptom:** `Access to XMLHttpRequest ... blocked by CORS policy`

**Fix:** Ensure `FRONTEND_URL` in `.env` matches exactly where your frontend is running (e.g., `http://localhost:5173`). The backend allows CORS only from this origin. Also ensure the origin header matches (no trailing slash).

---

### Migration Failures

**Symptom:** Server crashes during startup with SQL errors.

**Fix:** Migrations use `IF NOT EXISTS` guards but may fail if the base schema tables are missing. Ensure the initial database schema has been loaded before running migrations. Check the `schema_migrations` table to see which versions have been applied.

---

### `npm install` Fails with Peer Dependency Errors

**Symptom:** `ERESOLVE unable to resolve dependency tree`

**Fix:** Use the `--legacy-peer-deps` flag:
```bash
npm install --legacy-peer-deps
```

The CI pipeline uses this flag as well.

---

### Frontend Build Fails with Type Errors

**Symptom:** `tsc` reports type errors during build.

**Fix:** The frontend `tsconfig.json` enables strict mode. Ensure you have the correct TypeScript version:
```bash
cd frontend
npx tsc --version  # Should be 5.3+
```

---

### Port Already in Use

**Symptom:** `Error: listen EADDRINUSE: address already in use :::3001`

**Fix:** Kill the existing process or change the `PORT` in `.env`:
```bash
# Find and kill the process
lsof -ti :3001 | xargs kill -9   # macOS/Linux
netstat -ano | findstr :3001      # Windows (then taskkill /PID <pid> /F)
```

---

### Email Features Not Working

**Symptom:** Email-related API calls return errors or silently fail.

**Fix:** Email requires a valid `RESEND_API_KEY`. If not set, the email service reports as unconfigured. Check the status at:
```
GET /api/v1/email-templates/status
```

---

## VS Code Recommended Extensions

The following extensions are recommended for development:

| Extension | ID | Purpose |
|-----------|----|---------|
| ESLint | `dbaeumer.vscode-eslint` | JavaScript/TypeScript linting |
| Prettier | `esbenp.prettier-vscode` | Code formatting |
| TypeScript Importer | `pmneo.tsimporter` | Auto-import TypeScript modules |
| MySQL (cweijan) | `cweijan.vscode-mysql-client2` | Database management |
| REST Client | `humao.rest-client` | Test API endpoints from VS Code |
| Vite | `antfu.vite` | Vite integration |
| ES7+ Snippets | `dsznajder.es7-react-js-snippets` | React/JS code snippets |
| Error Lens | `usernamehw.errorlens` | Inline error/warning display |
| GitLens | `eamodio.gitlens` | Git blame and history |

### Recommended VS Code Settings

Add to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.workingDirectories": ["backend", "frontend"],
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true
  }
}
```
