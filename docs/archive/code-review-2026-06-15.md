# Comprehensive Code Review Report
## CPR Training App — Fastify 5 / React 18

**Review Date**: 2026-06-15
**Reviewer**: Senior Full-Stack Engineer & Software Architect
**Codebase**: `cpr-jun132026-dev` (Fastify 5 backend, React 18 frontend)
**Scope**: Architecture, security, performance, code quality, testing, DevOps, reliability

---

## 1. High-Level Summary

The CPR Training App is a **multi-portal SaaS application** managing CPR course scheduling, billing, instructor management, and certification tracking. It serves 8 user roles (admin, sysadmin, instructor, accountant, organization, vendor, HR, course admin) across distinct React portals backed by a Fastify 5 REST API with MySQL.

**Overall Assessment**: The application is **functional and deployed in production** with solid foundational architecture. Recent Phase 1-4 security and performance fixes addressed major vulnerabilities. However, several critical and high-priority issues remain that must be resolved before commercial sale.

---

## 2. Prioritized Issues

### CRITICAL (Must fix before commercial release)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| C-1 | **SQL injection via dynamic column name** | `backend/src/services/HRService.ts:131` | `UPDATE users SET \`${change.field_name}\`` interpolates a DB-sourced value into SQL. While guarded by an allowlist on line 127, the value comes from the `profile_changes` table — if that table is compromised (e.g., direct DB access, another SQLi), the allowlist is bypassed. Use a `CASE` statement or parameterized column mapping instead. |
| C-2 | **In-memory account lockout & token blacklist lost on restart** | `backend/src/services/AuthService.ts` | Both `loginAttempts` (Map) and `tokenBlacklist` (Map) are in-memory. Any server restart clears all lockouts and un-revokes all blacklisted tokens. On shared hosting with Passenger, worker recycling makes this especially unreliable. Must use Redis or DB-backed storage. |
| C-3 | **No CSRF protection on cookie-based auth** | `backend/src/app.ts` | Refresh tokens are stored in HTTP-only cookies. No CSRF token is generated or validated. An attacker on another origin could trigger refresh-token rotation via cross-site request. |

### HIGH (Fix soon — significant risk)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| H-1 | **Zero backend unit/integration tests** | `backend/` | No `*.test.ts` or `*.spec.ts` files exist in the backend. All business logic (billing, invoicing, HR, auth, email) is completely untested. A single regression could corrupt financial data. |
| H-2 | **InvoiceRepository.getDashboard() has no org_id filter** | `backend/src/repositories/InvoiceRepository.ts:59-80` | Dashboard queries aggregate ALL invoices across all organizations. This is presumably for admin/accountant, but there's no guard — if called from an org-scoped context, it leaks cross-org financial data. |
| H-3 | **Race condition on payment submission** | `backend/src/routes/org-billing.ts` | Payment submission reads balance, then inserts. Two simultaneous payments could both succeed, causing overpayment. Needs `SELECT ... FOR UPDATE` or a DB constraint. |
| H-4 | **taxConfig.ts still reads raw process.env** | `backend/src/utils/taxConfig.ts:5` | Uses `process.env.HST_RATE` directly instead of the validated `env` object. While there's a NaN guard, this bypasses the centralized env validation pattern. |
| H-5 | **Vendor invoice download: auth check after file read** | Vendor invoice routes | File is read from disk before verifying the requesting user owns it. Should verify ownership first, then stream the file. |
| H-6 | **useEffect missing dependencies in AuthContext** | `frontend/src/contexts/AuthContext.tsx` | Missing dependencies in useEffect hooks can cause stale closures, leading to auth state bugs (e.g., token refresh using outdated values). |
| H-7 | **Hardcoded HST rate in SQL** | `backend/src/repositories/InvoiceRepository.ts:114` | `getBillingQueue()` hardcodes `* 1.13` in SQL instead of using `taxConfig.HST_RATE`. If the rate changes, billing queue totals will be silently wrong. |
| H-8 | **Correlated subqueries in billing reports (3x per row)** | `backend/src/routes/billing.ts:243-306` | AR aging and aging report queries run `(SELECT SUM(p.amount) FROM payments WHERE invoice_id = i.id)` three times per invoice row. For 500 invoices = 1,500 sub-selects per request. Should use `LEFT JOIN ... GROUP BY` (pattern already used in `InvoiceRepository.findAllWithDetails()`). |
| H-9 | **No file upload MIME type validation** | `backend/src/routes/vendors.ts` | Vendor invoice upload accepts any file type — only the 10MB size limit is enforced. No MIME validation, no file type whitelist, no content scanning. |
| H-10 | **Production sourcemaps enabled** | `frontend/vite.config.ts:30` | `sourcemap: true` in production build exposes full source code to anyone with browser devtools. Should be `false` or `'hidden'` for production. |

### MEDIUM (Should fix — quality/maintainability)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| M-1 | **Inconsistent API call patterns in frontend** | Multiple portal components | Some components use React Query (`useQuery`/`useMutation`), others use raw `useEffect` + `api.get()` with manual state management. The accounting portal is especially inconsistent — no retry, no caching, no dedup. |
| M-2 | **Ungated console.log in production** | `frontend/src/components/portals/vendor/`, `accounting/AccountingDashboard.tsx:259` | Several `console.error` and `console.log` calls not gated behind `isDev`. Leaks debug info in production. |
| M-3 | **Duplicate ErrorBoundary components** | `frontend/src/components/ErrorBoundary.tsx` and `frontend/src/components/common/ErrorBoundary.tsx` | Two ErrorBoundary implementations exist. Only the `common/` one is used in `App.tsx`. The other is dead code. |
| M-4 | **WebSocket code loaded but disabled** | `frontend/src/contexts/RealtimeContext.tsx` | Socket.IO client is imported and instantiated with `autoConnect: false`. Still pulls socket.io-client (~200KB) into the bundle for zero benefit. Should be removed or lazy-loaded behind a feature flag. |
| M-5 | **No database migration system** | `backend/` | No migration files, no migration runner. Schema changes are applied manually. This makes rollbacks impossible and multi-developer workflows risky. |
| M-6 | **`readFileSync` in app.ts blocks event loop** | `backend/src/app.ts:89` | `readFileSync` is called at startup (acceptable) but the index.html is cached once — if it's updated on disk, a restart is required. Minor issue. |
| M-7 | **Global rate limit too generous for auth endpoints** | `backend/src/app.ts:43-46` | 100 req/min globally. Auth endpoints (login, refresh) should have stricter limits (e.g., 10/min) to prevent credential stuffing. The account lockout helps but is in-memory (see C-2). |
| M-8 | **Unbounded queries without LIMIT** | Multiple files | `admin.ts:226` (`SELECT * FROM organizations`), `admin.ts:325` (system_configurations), `InvoiceRepository.findAllWithDetails()`, `getBillingQueue()`, `findPendingApproval()`, `findRejected()`, `CourseRequestRepository.findByStatus()` — all return full result sets with no pagination. `BaseRepository.findAll()` defaults to 50, but custom query methods bypass this. |
| M-9 | **ErrorBoundary only at app root** | `frontend/src/App.tsx:47` | One `<ErrorBoundary>` wraps the entire app. Individual portals have no boundaries. A render error in any portal crashes the whole app instead of just that section. |
| M-10 | **No MySQL query timeout** | `backend/src/config/database.ts` | No `queryTimeout` in pool config. A slow query holds a connection indefinitely, potentially exhausting the 10-connection pool. |
| M-11 | **Monaco Editor not lazy-loaded** | `frontend/src/components/portals/courseAdmin/` | `@monaco-editor/react` (~2MB) is a production dependency used only in `EmailTemplateManager.tsx`. It loads for all CourseAdmin users even if they never open the template editor. Should be dynamically imported. |
| M-12 | **SessionWarning polls every 1 second** | `frontend/src/components/common/SessionWarning.tsx:59` | Runs `setInterval` at 1s across all authenticated sessions. Should use a single `setTimeout` to the expiry boundary, then switch to high-frequency polling only when close to expiry. |
| M-13 | **Old API stubs with misleading comments** | `frontend/src/api.ts` | Contains placeholder functions (`getInvoices`, `getInvoiceDetails`, etc.) that return empty arrays with comments like "This endpoint doesn't exist yet" — but the real endpoints do exist. If imported by mistake, silently returns no data. |

### LOW (Nice to have — polish)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| L-1 | **Frontend test files are stale/placeholder** | `frontend/src/basic.test.ts`, `frontend/src/example.spec.ts` | Placeholder test files with trivial assertions. Some use `jest.mock` which will fail under Vitest without a compat shim. The ~20 frontend test files may not pass against current code. |
| L-2 | **No structured frontend error tracking** | Frontend | ErrorBoundary exists but logs to console only. No Sentry/equivalent on the frontend. |
| L-3 | **`connectionLimit: 10` may be too low under load** | `backend/src/config/database.ts:15` | With `queueLimit: 100`, up to 110 requests can pile up. For a commercial app with concurrent users across 8 portals, 10 connections may bottleneck. |
| L-4 | **Health check returns 200 even when DB is DOWN** | `backend/src/app.ts:73-83` | Returns `{ status: "DEGRADED" }` with HTTP 200. Load balancers won't detect the failure. Should return 503 when DB is down. |
| L-5 | **No request correlation IDs** | `backend/src/app.ts` | No `X-Request-Id` header generated or logged. Makes tracing individual requests through logs difficult for debugging production issues. |
| L-6 | **React Query cache not optimized** | Frontend | Default `staleTime: 0` means every tab switch triggers a new fetch. High-read, low-change data (course types, org lists, pricing) should have longer stale times. |
| L-7 | **CSP `unsafe-inline` for scripts and styles** | `backend/src/app.ts:27-28` | Defeats much of CSP's XSS protection. Required by MUI/styled-components, but consider nonce-based approach long-term. |
| L-8 | **No application-level caching** | Backend | Every request hits MySQL. Course types, org lists, pricing tables are re-fetched every time. Even a simple 60s in-memory cache for read-heavy reference data would help. |

---

## 3. Specific Code-Level Recommendations

### Security Fixes

**C-1 Fix** — Replace dynamic column interpolation with a safe mapping:
```typescript
// Instead of: UPDATE users SET `${change.field_name}` = ?
const COLUMN_MAP: Record<string, string> = {
  first_name: 'first_name', last_name: 'last_name', /* ... */
};
const col = COLUMN_MAP[change.field_name];
if (!col) throw new HRError('Invalid field');
await conn.query(`UPDATE users SET \`${col}\` = ? WHERE id = ?`, [change.new_value, change.user_id]);
```

**C-2 Fix** — Move lockout/blacklist to DB:
```sql
CREATE TABLE login_attempts (username VARCHAR(255), attempt_at DATETIME, INDEX(username, attempt_at));
CREATE TABLE token_blacklist (user_id INT, invalidated_at DATETIME, INDEX(user_id));
```

**H-4 Fix** — Add `HST_RATE` to `env.ts` schema, remove `process.env` access from taxConfig.

**L-4 Fix** — Return proper status code:
```typescript
const httpStatus = dbStatus === 'UP' ? 200 : 503;
reply.status(httpStatus).send({ status, database: dbStatus, timestamp: new Date().toISOString() });
```

### Performance Fixes

**H-3 Fix** — Wrap payment in transaction with row lock:
```typescript
await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]);
// Then validate balance and insert payment within same transaction
```

**H-7 Fix** — Replace hardcoded `* 1.13` in InvoiceRepository with parameterized HST_RATE:
```typescript
import { HST_RATE } from '../utils/taxConfig.js';
// In query: `* ? as total_amount`, [...params, 1 + HST_RATE]
```

**H-8 Fix** — Replace correlated subqueries with LEFT JOIN in billing reports:
```sql
-- Instead of 3x (SELECT SUM(amount) FROM payments WHERE invoice_id = i.id) per row:
LEFT JOIN (
  SELECT invoice_id, SUM(amount) as total_paid
  FROM payments WHERE status = 'verified' AND deleted_at IS NULL
  GROUP BY invoice_id
) p ON p.invoice_id = i.id
```

**M-10 Fix** — Add query timeout to pool config:
```typescript
// In database.ts pool options:
queryTimeout: 30000,  // 30s max query time
```

---

## 4. Architectural Recommendations

### Good Decisions (Keep)
- **Fastify 5 with Zod validation** — Modern, type-safe, fast
- **Repository pattern** with BaseRepository — Clean separation of concerns
- **Pino structured logging** — Production-grade
- **Role-based route guards** (`requireRole`) — Clear authorization model
- **HTTP access logging** via `onResponse` hook — Essential for audit
- **HST tax config externalized** — Business-rule flexibility
- **ErrorBoundary in React** — Graceful failure handling
- **`@fastify/helmet`** with CSP in production — Good security headers

### Architecture Gaps to Address
1. **Add a database migration system** — Use `dbmate`, `knex migrations`, or custom SQL scripts with version tracking. Critical for commercial deployment where schema changes must be reproducible and rollback-safe.
2. **Standardize frontend data fetching** — Adopt React Query universally. Remove all raw `useEffect` + `api.get()` patterns. This gives you retry, caching, dedup, and background refresh for free.
3. **Add Redis** (or SQLite for single-server) — For session state, token blacklist, account lockout, rate limiting. In-memory state is unacceptable for a commercial product.
4. **Implement CI/CD pipeline** — Currently no `.github/workflows`, no Jenkinsfile, no automated testing before deploy. Cron-based deploy from git pull is fragile.
5. **Add API versioning strategy** — `/api/v1` prefix exists but there's no strategy for breaking changes. Important for a commercial product with external integrations.

---

## 5. Production Readiness Score

| Category | Score | Notes |
|----------|-------|-------|
| **Security** | 6.5/10 | Zod validation, helmet, CORS, rate limiting, role guards. Loses points for in-memory lockout/blacklist, no CSRF, and the SQL interpolation pattern. |
| **Code Quality** | 7/10 | Clean TypeScript, good separation of concerns, consistent patterns. Loses points for inconsistent frontend patterns and dead code. |
| **Performance** | 6.5/10 | Revenue report optimized, batch inserts, connection pool tuned, AbortController timeouts. Loses points for correlated subqueries in billing reports, unbounded queries, hardcoded tax rate in SQL, no query timeout, no caching layer. |
| **Testing** | 2/10 | 36 E2E tests (Playwright) cover login flows. Zero backend tests. Frontend unit tests are stale. No integration tests for billing/payment logic. |
| **DevOps** | 3/10 | No CI/CD, no automated testing pre-deploy, cron-based deploy, no rollback strategy beyond git revert, no containerization. |
| **Reliability** | 6/10 | Graceful shutdown, error handler with Sentry, structured logging, health check. Loses points for in-memory state, no backup strategy, no monitoring/alerting. |
| **Documentation** | 5/10 | TODO.md tracks work well. No API documentation, no developer onboarding guide, no architecture decision records. |

### Overall: 5.1/10 — Functional MVP, not yet commercial-grade

---

## 6. Refactor Plan (Prioritized)

### Phase A: Critical Security (1-2 days)
1. Fix C-1: Replace SQL column interpolation with safe mapping in HRService
2. Fix C-2: Move lockout + token blacklist to MySQL tables
3. Fix C-3: Add CSRF protection (double-submit cookie or `@fastify/csrf-protection`)
4. Fix L-4: Health check returns 503 when DB is down
5. Fix H-4: Route HST_RATE through env.ts validation
6. Fix H-9: Add MIME type validation and file type whitelist to vendor invoice upload
7. Fix H-10: Disable production sourcemaps (`sourcemap: false` or `'hidden'`)

### Phase B: Data Integrity & Performance (1-2 days)
1. Fix H-3: Transaction + `FOR UPDATE` on payment submission
2. Fix H-2: Add org_id scoping guard to InvoiceRepository.getDashboard()
3. Fix H-5: Verify ownership before reading vendor invoice files
4. Fix H-7: Replace hardcoded `* 1.13` in InvoiceRepository with taxConfig.HST_RATE
5. Fix H-8: Replace correlated subqueries with LEFT JOIN in billing reports
6. Fix M-8: Add LIMIT to all unbounded queries
7. Fix M-10: Add `queryTimeout: 30000` to database pool config
8. Add stricter rate limits for auth endpoints (M-7)

### Phase C: Testing Foundation (3-5 days)
1. Add backend unit tests for AuthService (login, lockout, token blacklist)
2. Add backend integration tests for BillingService (invoice creation, payment, balance)
3. Add backend integration tests for HRService (profile change approval flow)
4. Fix/update stale frontend test files (fix jest.mock → vi.mock)
5. Set up vitest with test database config

### Phase D: DevOps & Reliability (2-3 days)
1. Add GitHub Actions CI: lint + typecheck + test on push
2. Add database migration system (dbmate or custom)
3. Add monitoring/alerting (Sentry on frontend, uptime checks)
4. Document rollback procedure
5. Add request correlation IDs (L-5)

### Phase E: Frontend Polish (ongoing)
1. Standardize all data fetching to React Query (M-1)
2. Remove dead code: duplicate ErrorBoundary (M-3), disabled WebSocket (M-4), old API stubs (M-13), stale tests (L-1)
3. Add per-portal ErrorBoundary wrappers (M-9)
4. Lazy-load Monaco Editor in EmailTemplateManager (M-11)
5. Optimize SessionWarning polling to setTimeout-based (M-12)
6. Gate remaining console.log calls behind isDev (M-2)
7. Fix useEffect dependency arrays in AuthContext (H-6)
8. Configure React Query staleTime per endpoint (L-6)
9. Add API documentation (OpenAPI/Swagger)
10. Increase connection pool limit for production scale (L-3)

---

**Issue Totals**: 3 Critical, 10 High, 13 Medium, 8 Low = **34 findings**

**Bottom line**: The app works and handles the core business logic well. The architecture is sound. The main gaps are **testing** (nearly zero), **DevOps** (manual everything), **stateful security mechanisms stored in volatile memory**, and **performance issues in billing reports**. Phases A and B should be done before any commercial release. Phase C is essential for long-term maintainability of a product you intend to sell.
