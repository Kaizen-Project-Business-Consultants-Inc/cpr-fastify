# CPR Training Management System -- Security Documentation

**Last Updated**: 2026-06-28
**System**: CPR Training Management System (Fastify 5 / React 18 / MySQL)
**Environment**: TMD Hosting (shared), LiteSpeed reverse proxy, Passenger

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Authorization](#2-authorization)
3. [Multi-Tenant Isolation](#3-multi-tenant-isolation)
4. [Input Validation](#4-input-validation)
5. [Rate Limiting](#5-rate-limiting)
6. [Account Security](#6-account-security)
7. [Security Headers](#7-security-headers)
8. [Session Management](#8-session-management)
9. [Audit Logging](#9-audit-logging)
10. [Monitoring](#10-monitoring)
11. [Data Protection](#11-data-protection)
12. [Vulnerability Management](#12-vulnerability-management)
13. [Penetration Test Results](#13-penetration-test-results)
14. [Security Improvement Roadmap](#14-security-improvement-roadmap)

---

## 1. Authentication

### JWT-Based Authentication

The system uses JSON Web Tokens (JWT) for stateless authentication with two token types:

- **Access Token**: Short-lived (configurable via `ACCESS_TOKEN_EXPIRY`, default `15m`), sent in the `Authorization: Bearer <token>` header. Payload contains `userId`, `role`, and `orgId`.
- **Refresh Token**: Long-lived (configurable via `REFRESH_TOKEN_EXPIRY`, default `7d`), stored in an httpOnly cookie scoped to the `/api/v1/auth/refresh` path.

### Token Generation

Tokens are generated via `jsonwebtoken` (`jwt.sign()`) using separate secrets:

- `JWT_ACCESS_SECRET` -- minimum 32 characters, validated at startup via Zod schema in `backend/src/config/env.ts`
- `JWT_REFRESH_SECRET` -- minimum 32 characters, validated at startup via Zod schema

Both secrets are stored as environment variables (set via `.htaccess` `SetEnv` directives on production), never committed to source code.

### Login Flow

1. Client sends `POST /api/v1/auth/login` with `{ username, password }`.
2. Server validates input via Zod schema (`loginSchema`).
3. Account lockout is checked (see Section 6).
4. User is looked up by username; inactive accounts are rejected.
5. Password is verified via `bcrypt.compare()`.
6. On success, failed login attempts are cleared, tokens are generated, refresh token is set as an httpOnly cookie, and the access token is returned in the response body.
7. Audit log entry is created for both successful and failed login attempts.

### Token Refresh

- `POST /api/v1/auth/refresh` reads the refresh token from the httpOnly cookie.
- The token is verified against `JWT_REFRESH_SECRET`.
- If the associated user is inactive, the refresh is rejected.
- A new token pair is issued and the refresh cookie is updated.

### Logout

- `POST /api/v1/auth/logout` clears the refresh token cookie.
- An audit log entry is created.

**Source**: `backend/src/routes/auth.ts`, `backend/src/services/AuthService.ts`

---

## 2. Authorization

### Role-Based Access Control (RBAC)

The system defines **8 roles**:

| Role | Description |
|------|-------------|
| `sysadmin` | System administrator -- full platform access |
| `admin` | Organization administrator |
| `instructor` | Course instructor |
| `organization` | Organization portal user |
| `accountant` | Accounting / billing |
| `hr` | Human resources |
| `courseadmin` | Course administration |
| `vendor` | External vendor |

### Middleware Enforcement

Authorization is enforced via two middleware functions in `backend/src/plugins/auth.ts`:

- **`requireAuth`**: Validates the Bearer token, checks the token blacklist (for password-change invalidation), and populates `request.userId`, `request.userRole`, and `request.userOrgId` on the Fastify request object.
- **`requireRole(...roles)`**: Calls `requireAuth` first, then verifies that `request.userRole` is in the allowed roles list. Returns HTTP 403 if the role is not permitted.

### Route-Level Role Checks

Every protected route file defines role-specific preHandlers. Examples from the codebase:

- HR routes: `requireRole('hr')`
- Accounting routes: `requireRole('accountant', 'admin', 'sysadmin')`
- Organization routes: `requireRole('organization')`
- Course admin routes: `requireRole('admin', 'sysadmin', 'courseadmin')`
- Instructor routes: `requireRole('instructor')`
- Sysadmin routes: `requireRole('sysadmin')`

**Source**: `backend/src/plugins/auth.ts`, all files under `backend/src/routes/`

---

## 3. Multi-Tenant Isolation

### Org Scoping via `request.userOrgId`

Multi-tenant data isolation is enforced at the query level. The authenticated user's organization ID (`request.userOrgId`) is injected into SQL `WHERE` clauses as a parameterized value to ensure users can only access data belonging to their own organization. This applies to all organization-scoped endpoints (courses, billing, students, etc.).

### SECURITY-2: Org Data Isolation Audit (2026-06-15)

A comprehensive audit of all 67 routes across 4 route files was performed. **9 issues were identified and fixed**:

- **8 unauthenticated/unscoped routes** in `course-requests.ts` -- these course-admin endpoints had no `authenticateToken` or `requireRole` middleware. Fixed by adding both `requireAuth` and `requireRole` preHandlers.
- **1 fetch-before-check pattern** in `org-billing.ts` -- an endpoint fetched an invoice by ID and then checked the org. Fixed by moving the org scope directly into the SQL `WHERE` clause so unauthorized data is never retrieved from the database.

### SECURITY-3: Multi-Tenant Penetration Test (2026-06-15)

A black-box penetration test was conducted against the production environment. The following attack vectors were tested:

| Attack Vector | Method | Result |
|---------------|--------|--------|
| IDOR via query parameters | Modified `?orgId=X` on cross-org endpoints | **Blocked** -- org scoping from JWT, not query params |
| IDOR via path parameters | Modified `/invoices/:id` across org boundaries | **Blocked** -- WHERE clause includes `organization_id` |
| Cross-role escalation (org to sysadmin) | Used org-role JWT on sysadmin endpoints | **Blocked** -- `requireRole` middleware returns 403 |
| Cross-role escalation (org to admin) | Used org-role JWT on admin endpoints | **Blocked** -- `requireRole` middleware returns 403 |
| Cross-role escalation (instructor to admin) | Used instructor-role JWT on admin endpoints | **Blocked** -- `requireRole` middleware returns 403 |
| Mutation attacks | Attempted unauthorized POST/PUT/DELETE | **Blocked** -- role middleware enforced |
| SQL injection | Injected SQL in query parameters and body fields | **Blocked** -- parameterized queries throughout |
| XSS | Injected script tags in input fields | **Blocked** -- Helmet CSP + input validation |
| JWT forgery | Modified JWT payload without valid signature | **Blocked** -- `jwt.verify()` rejects invalid signatures |
| No-auth access | Accessed protected endpoints without token | **Blocked** -- `requireAuth` returns 401 |
| CORS bypass | Cross-origin requests from unauthorized domains | **Blocked** -- `@fastify/cors` with explicit origin |

**Result**: All attacks were blocked. No data leakage or unauthorized access was achieved.

---

## 4. Input Validation

### Zod Schema Validation

Request bodies on security-critical routes are validated using Zod schemas before any processing occurs. Examples:

- `loginSchema` -- requires non-empty `username` and `password`
- `changePasswordSchema` -- requires `currentPassword` (min 1 char) and `newPassword` (min 8 chars)
- `refreshSchema` -- requires non-empty `refreshToken`
- User creation schema in `admin.ts` -- validates `username`, `email`, `password` (min 8), `role` (enum of 8 valid roles), and optional fields

Zod validation errors are caught by the Fastify error handler and returned as 400 responses with structured error details.

### Environment Variable Validation

All environment variables are validated at startup via a Zod schema in `backend/src/config/env.ts`. The server will not start if required variables are missing or malformed. Key validations include:

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be at least 32 characters
- `ACCESS_TOKEN_EXPIRY` and `REFRESH_TOKEN_EXPIRY` must match the pattern `/^\d+[smhd]$/`
- `FRONTEND_URL` must be a valid URL
- `BCRYPT_SALT_ROUNDS` must be a number (default 12)
- `SENTRY_DSN` must be a valid URL if provided

### Parameterized SQL Queries

The backend uses `mysql2/promise` with parameterized queries (`?` placeholders) throughout. There is no ORM -- all SQL is written directly -- but all user-supplied values are passed as bind parameters, not interpolated into query strings. This prevents SQL injection.

**Source**: `backend/src/routes/auth.ts`, `backend/src/routes/admin.ts`, `backend/src/config/env.ts`

---

## 5. Rate Limiting

Rate limiting is implemented via `@fastify/rate-limit` registered as a global plugin in `backend/src/app.ts`.

### Rate Limit Configuration

| Limiter | Scope | Limit | Window | Applied To |
|---------|-------|-------|--------|------------|
| Global API limiter | All `/api/v1` routes | 100 requests | 1 minute | All authenticated and unauthenticated API requests |
| Auth limiter | Auth endpoints | 10 requests | 1 minute | `/auth/login`, `/auth/refresh` (per-route override) |
| Auth limiter (TODO.md reference) | Login/forgot/recover/reset | 20 requests | 15 minutes | Login and password recovery endpoints |

The global rate limiter is registered at the application level. Individual auth routes apply a stricter per-route override via Fastify's route-level `config.rateLimit` option.

When the rate limit is exceeded, the server returns HTTP 429 (Too Many Requests) with a `Retry-After` header.

**Source**: `backend/src/app.ts` (lines 48-51), `backend/src/routes/auth.ts` (lines 49-52)

---

## 6. Account Security

### Login Lockout

The system implements database-backed account lockout to prevent brute-force attacks:

- **Threshold**: 5 failed login attempts within a 15-minute window
- **Lockout Duration**: 15 minutes from the most recent failed attempt
- **Tracking**: Failed attempts are stored in the `login_attempts` table (migration v1) with username and timestamp
- **Cleanup**: Old login attempts (older than 1 hour) are purged automatically on each migration run
- **Behavior**: When locked out, the login endpoint returns HTTP 429 with a message indicating how many minutes remain

Constants (defined in `backend/src/services/AuthService.ts`):
- `MAX_FAILED_ATTEMPTS = 5`
- `LOCKOUT_WINDOW_MINUTES = 15`
- `LOCKOUT_DURATION_MINUTES = 15`

### Password Policies

- Minimum password length: 8 characters (enforced by Zod schema on change-password and user creation endpoints)
- Passwords are hashed using `bcryptjs` with configurable salt rounds (default 12, set via `BCRYPT_SALT_ROUNDS` env var)
- Password hashes are never returned in API responses -- the `password_hash` field is destructured out before sending user data

### Forced Session Invalidation on Password Change

When a user changes their password:
1. The old password is verified via `bcrypt.compare()`
2. The new password is hashed and stored
3. All existing tokens for that user are invalidated by upserting into the `token_blacklist` table with the current timestamp
4. Any subsequent request using a token issued before the password change will be rejected by the `requireAuth` middleware

**Source**: `backend/src/services/AuthService.ts`

---

## 7. Security Headers

Security headers are managed via `@fastify/helmet`, registered in `backend/src/app.ts`.

### Production Headers

In production (`NODE_ENV === 'production'`), the following headers are set:

| Header | Value |
|--------|-------|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' <FRONTEND_URL>` |
| Strict-Transport-Security | Enabled (HSTS) -- LiteSpeed terminates TLS and sets HSTS headers |
| X-Frame-Options | Set by Helmet defaults (SAMEORIGIN) |
| X-Content-Type-Options | Set by Helmet defaults (nosniff) |
| X-DNS-Prefetch-Control | Set by Helmet defaults (off) |
| X-Download-Options | Set by Helmet defaults (noopen) |
| X-Permitted-Cross-Domain-Policies | Set by Helmet defaults (none) |
| Referrer-Policy | Set by Helmet defaults (no-referrer) |

### CORS Configuration

- Origin is restricted to the configured `FRONTEND_URL` (explicit single origin, not wildcard)
- Credentials are enabled (`credentials: true`) to allow httpOnly cookies

### CSRF Defense-in-Depth

An `onRequest` hook in `backend/src/app.ts` checks the `Origin` header on all state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`). If the `Origin` header is present and does not match `FRONTEND_URL`, the request is rejected with HTTP 403. Requests without an `Origin` header (same-origin navigations, non-browser clients) are allowed through.

**Source**: `backend/src/app.ts` (lines 28-65)

---

## 8. Session Management

### Token Architecture

- **Access tokens** are stored in the frontend's `sessionStorage` (cleared on tab close) and sent via the `Authorization` header
- **Refresh tokens** are stored in httpOnly, Secure, SameSite=Strict cookies scoped to `/api/v1/auth/refresh` -- inaccessible to JavaScript
- Cookie attributes: `httpOnly: true`, `secure: true`, `sameSite: 'strict'`, `maxAge: 7 days`

### Token Blacklist

The `token_blacklist` table (migration v2, fixed in migration v4) provides server-side token invalidation:

- **Schema**: `user_id INT PRIMARY KEY`, `invalidated_at DATETIME`
- **Mechanism**: On password change, an `UPSERT` sets `invalidated_at` to `NOW()` for the user
- **Check**: On every authenticated request, `requireAuth` compares the token's `iat` (issued-at) timestamp against the user's `invalidated_at` timestamp. If the token was issued before invalidation, it is rejected with "Token has been revoked"
- **Fail-open on DB error**: If the blacklist check fails due to a database error, the request is allowed through (to avoid blocking all authenticated requests during a DB hiccup). This is a deliberate design trade-off documented in the code.

### Forced Logout

Password changes trigger `invalidateUserTokens(userId)`, which:
1. Inserts or updates the `token_blacklist` entry for the user
2. All existing access and refresh tokens for that user become invalid
3. The user must re-authenticate on all devices/sessions

**Source**: `backend/src/plugins/auth.ts`, `backend/src/services/AuthService.ts`

---

## 9. Audit Logging

### Audit Log Table

The `audit_logs` table (migration v13) stores security-relevant events:

```
audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  username VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT,
  details JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

Indexes: `idx_audit_created` (time-range queries), `idx_audit_user` (per-user queries), `idx_audit_entity` (entity lookups).

### `logAudit()` Utility

The `logAudit()` function in `backend/src/utils/auditLog.ts` is a fire-and-forget function -- it inserts the audit record asynchronously and catches any errors (logging a warning but never throwing). This ensures audit logging cannot break the request flow.

### Logged Events

| Event | Action String | Context |
|-------|---------------|---------|
| Successful login | `login` | userId, username, IP address |
| Failed login | `login_failed` | username, failure reason, IP address |
| Logout | `logout` | userId (if available), IP address |
| Password change | `change_password` | userId, entityType=user, entityId=userId, IP address |
| User CRUD | Various | Logged by admin routes |

### Audit Log Viewer

A sysadmin-facing `AuditLogViewer` component provides:
- Paginated, filterable audit log viewing
- CSV export of audit records
- Statistics endpoint (`GET /audit-logs/stats`)

**Source**: `backend/src/utils/auditLog.ts`, `backend/src/config/migrations.ts` (v13)

---

## 10. Monitoring

### Sentry Error Tracking

- **Package**: `@sentry/node` v10
- **Initialization**: Dynamic import with graceful fallback -- if `SENTRY_DSN` is configured but the package is not installed, startup continues without Sentry
- **Configuration**: DSN via environment variable, `tracesSampleRate: 0.1` (10% of transactions traced)
- **Scope**: Captures unhandled 500 errors with request context in production

### `/metrics` Endpoint

The `registerMetrics()` plugin in `backend/src/plugins/metrics.ts` collects and exposes runtime metrics via `GET /metrics`:

| Metric | Description |
|--------|-------------|
| `uptime_seconds` | Time since server start |
| `requests.total` | Total request count |
| `requests.errors` | Count of 5xx responses |
| `requests.error_rate` | Error percentage |
| `latency.avg_ms` | Average response time |
| `latency.max_ms` | Maximum response time |
| `latency.slow_requests` | Count of requests exceeding 2000ms threshold |
| `timestamp` | Current server time |

Slow requests (>2000ms) are logged as warnings with method, URL, status code, and duration.

### UptimeRobot Health Checks

- **Endpoint**: `GET /health` (outside `/api/v1` prefix)
- **Behavior**: Pings the database with `SELECT 1`. Returns `{ status: "UP", database: "UP" }` with HTTP 200, or `{ status: "DEGRADED", database: "DOWN" }` with HTTP 503
- **Monitor**: UptimeRobot polls `https://cpr.kpbc.ca/api/v1/health` every 5 minutes, alerting `kpbcma@gmail.com` on failure

### HTTP Access Logging

Every HTTP request/response is logged via an `onResponse` hook in `backend/src/app.ts` with:
- Request correlation ID (`x-request-id` -- auto-generated UUID or passed from client)
- HTTP method, URL, status code, duration (ms), and authenticated userId (if available)
- Requests with status >= 400 are logged at `warn` level; others at `info`

**Source**: `backend/src/index.ts`, `backend/src/plugins/metrics.ts`, `backend/src/app.ts`

---

## 11. Data Protection

### Encryption in Transit

- **TLS/HTTPS**: LiteSpeed reverse proxy terminates TLS. HSTS headers are enabled to prevent protocol downgrade attacks.
- **Cookie security**: Refresh token cookies are set with `secure: true` (HTTPS-only) and `sameSite: 'strict'`.

### Encryption at Rest

- **Password hashing**: All passwords are hashed using `bcryptjs` with 12 salt rounds (configurable). Raw passwords are never stored or logged.
- **Database**: MySQL on TMD Hosting with standard at-rest encryption provided by the hosting provider.

### PIPEDA Compliance

The system implements Canadian privacy law (PIPEDA) requirements:

| Requirement | Implementation |
|-------------|----------------|
| Privacy policy | Published at `/privacy` (live on production) |
| Data retention schedule | 7-year retention for course/payment records, 2-year retention after account closure |
| Right to access | `GET /auth/my-data` endpoint returns all user data as downloadable JSON |
| Right to deletion | `DELETE /sysadmin/users/:id/personal-data` anonymizes PII (replaces names, emails with anonymized values) |
| Marketing consent | `students.marketing_consent` flag with `marketing_consent_at` timestamp |
| Terms of service | Published at `/terms` |
| Breach notification SOP | Documented in `docs/Program Documentation/PIPEDA_Breach_Notification_SOP.md` |

### Data Minimization

- `password_hash` is excluded from all API responses via object destructuring (`const { password_hash, ...safeUser } = user`)
- PII is not logged to frontend console in production (gated behind `import.meta.env.DEV`)
- Audit logs store userId and action but do not store request/response bodies

**Source**: `backend/src/routes/auth.ts`, `backend/src/config/env.ts`

---

## 12. Vulnerability Management

### npm Audit Status

As of the last audit:

- **picomatch** high-severity ReDoS -- **fixed** via `npm audit fix`
- **Remaining**: 6 low + 5 moderate vulnerabilities, all in development tooling (`esbuild`, `vite`, `@google-cloud/storage`)
- **Impact**: None of the remaining vulnerabilities affect production runtime code. They exist only in build-time and development dependencies.
- **Plan**: Revisit when upgrading Vite or Google Cloud Storage to major versions that resolve these.

### Dependency Management

- `npm audit` is run periodically
- GitHub Actions CI pipeline runs `npm ci` (clean install from lockfile) on every push
- TypeScript strict mode is enabled on both backend and frontend for compile-time type safety

---

## 13. Penetration Test Results

### SECURITY-3: Black-Box Penetration Test (2026-06-15)

**Scope**: Production environment (`cpr.kpbc.ca`)
**Type**: Black-box (no source code access during testing)
**Tester**: Internal security review

#### What Was Tested

1. **IDOR (Insecure Direct Object Reference)**: Attempted to access resources belonging to other organizations by manipulating query parameters (`?orgId=X`) and path parameters (`/invoices/:id`).
2. **Cross-Role Escalation**: Used tokens from lower-privilege roles (organization, instructor) to access higher-privilege endpoints (sysadmin, admin, accounting).
3. **Mutation Attacks**: Attempted unauthorized POST, PUT, and DELETE operations across role boundaries.
4. **SQL Injection**: Injected SQL payloads in query parameters and request body fields.
5. **Cross-Site Scripting (XSS)**: Injected `<script>` tags and event handler attributes in input fields.
6. **JWT Forgery**: Modified JWT payloads (changed `userId`, `role`, `orgId`) without re-signing.
7. **Unauthenticated Access**: Accessed all protected endpoints without an Authorization header.
8. **CORS**: Sent requests from unauthorized origins.

#### Results

**All attacks were blocked.** No unauthorized data access or modification was achieved.

Key defenses that held:

- Org scoping is derived from the JWT (`request.userOrgId`), not from client-supplied query parameters
- `requireRole()` middleware enforces role checks before any route handler executes
- Parameterized SQL queries prevent injection
- Helmet CSP headers prevent inline script execution
- `jwt.verify()` rejects tokens with invalid signatures
- CORS configuration rejects requests from non-whitelisted origins

---

## 14. Security Improvement Roadmap

### Planned Items

| ID | Priority | Item | Description | Status |
|----|----------|------|-------------|--------|
| SEC-PENTEST-1 | High | External penetration test | Engage a freelance pentester or run Burp Suite against the production API before scaling to 5+ customers. Focus areas: auth bypass, IDOR across org boundaries, rate limit bypass, injection, session fixation. | Not started |
| BACKUP-2 | High | Offsite database backups | Daily `mysqldump` currently runs but both copies reside on the same TMD server. Push `cpr_*.sql.gz` to S3, B2, or FTP after each dump to protect against server failure. | Not started |
| HOSTING-1 | Medium | VPS upgrade | TMD shared hosting has LVE limits (100 processes, 2GB RAM, 2 CPU cores). Upgrade to TMD Managed VPS before onboarding multiple concurrent paying customers. VPS provides dedicated resources and root access. | Not started |
| LEGAL-3 | High | PIPEDA breach notification SOP | Define detection, assessment, and notification steps. Identify responsible parties. Must notify Privacy Commissioner and affected individuals within ~72 hours. | Documented (SOP exists) |
| EMAIL-2 | Low | Dedicated noreply mailbox | Switch production SMTP from `michaela@kpbc.ca` to dedicated `noreply@kpbc.ca` (staging already uses Resend API with this sender). | Staging complete |
| R-2 | Medium | Backup verification | Implement automated backup restore testing. Document RTO/RPO targets. | Not started |

### Completed Security Work

- SECURITY-2: Org data isolation audit -- 9 issues fixed across 67 routes
- SECURITY-3: Multi-tenant penetration test -- all attacks blocked
- Rate limiting: All three limiters active (auth, register, global API)
- Input validation: Zod schemas on all auth and critical mutation endpoints
- Security headers: Helmet with CSP, HSTS, X-Frame-Options
- Audit logging: Full audit trail for auth events and user CRUD
- Account lockout: 5 failed attempts triggers 15-minute lockout
- Token blacklist: Password changes invalidate all existing sessions
- Sentry: Error tracking active in production
- PIPEDA: Privacy policy, ToS, right-to-access, right-to-deletion implemented

---

*This document consolidates the security posture of the CPR Training Management System as of 2026-06-28. It should be updated whenever security controls are added, modified, or when new penetration tests are conducted.*
