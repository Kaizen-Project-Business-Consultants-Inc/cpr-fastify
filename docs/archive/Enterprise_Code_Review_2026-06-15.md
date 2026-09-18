# CPR Training App - Enterprise Code Review

**Date**: 2026-06-15
**Reviewer**: Claude Opus 4.6 (Senior Full-Stack Engineer / Software Architect)
**Scope**: Complete codebase - backend, frontend, infrastructure, testing, DevOps
**Goal**: Assess enterprise-grade production readiness

---

## High-Level Summary

The CPR Training Application is a well-structured multi-tenant SaaS platform that covers a complex business domain (course lifecycle, invoicing, payroll, vendor management). The Fastify 5 backend follows a sensible layered architecture (routes -> services -> repositories) with proper transaction management. The React 18 frontend uses code splitting and MUI consistently.

**Strengths:**
- Zod-validated environment configuration (fail-fast on startup)
- Consistent transaction pattern across all financial operations (begin/commit/rollback/release)
- ESM correctness throughout (`.js` extensions, top-level await)
- Code splitting via React.lazy for all 8 portals
- CORS, Helmet, and rate limiting configured
- Graceful degradation for optional services (Sentry, email)

**Critical Weaknesses:**
- Zero unit/integration tests (only 36 E2E smoke tests)
- Three competing API clients on frontend with inconsistent auth
- Multiple IDOR vulnerabilities (vendor invoices, balance calculation)
- No refresh token revocation; password changes don't invalidate sessions
- Hardcoded test credentials in public GitHub repo
- 13 route handlers accept `request.body as any` (no validation)

**Production Readiness Score: 4.5 / 10** (see justification at end)

---

## 1. Architecture & Design

### 1.1 Backend Structure

The backend follows a three-layer pattern: **Routes** (HTTP handling) -> **Services** (business logic) -> **Repositories** (data access). This is sound in principle but inconsistently applied:

**Good:**
- Services accept repositories via constructor injection (BillingService, CourseService)
- Transaction management is properly encapsulated in services
- Plugin registration order is correct for Fastify 5

**Issues:**

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| A-1 | HIGH | Auth plugin creates singleton at module scope (`const authService = new AuthService(new UserRepository())`), bypassing DI and making testing impossible without module mocking | `plugins/auth.ts:14` |
| A-2 | HIGH | Three route files registered WITHOUT prefix (`vendorAdminRoutes`, `orgBillingRoutes`, `miscRoutes`), defining their own paths inline. Risks duplicate route crashes, documented as known issue | `routes/index.ts:57,59,65` |
| A-3 | HIGH | Error class hierarchy is inconsistent: `AuthError` has no `statusCode` property, so all auth errors return HTTP 500 instead of 401/403. `BillingError` and `CourseError` have `statusCode` and work correctly by duck-typing luck | `services/AuthService.ts:85-90`, `plugins/errorHandler.ts:28` |
| A-4 | MEDIUM | No DI container. Each route file instantiates its own service/repository instances. Multiple instances of the same repository exist across the app | Multiple |
| A-5 | MEDIUM | `BaseRepository.forOrg()` uses `Object.create(this)` creating prototype-chained clones. Fragile pattern that breaks if TypeScript `private` is ever changed to ES `#private` | `repositories/BaseRepository.ts:25-29` |
| A-6 | MEDIUM | No HTTP access logging. Fastify's built-in logger disabled (`logger: false`), no `onRequest/onResponse` hooks registered. Cannot audit API access | `app.ts:17` |
| A-7 | LOW | SPA fallback reads `index.html` with `readFileSync` at startup, cached in memory. Frontend deploys require backend restart | `app.ts:59-67` |
| A-8 | LOW | `setNotFoundHandler` serves HTML for all non-API 404s including missing static assets (`.js`, `.css`, `.png`). Returns 200 for `/favicon.ico` | `app.ts:61-66` |

### 1.2 Frontend Structure

**Good:**
- React.lazy code splitting for all 8 portals
- ErrorBoundary wrapping on most portal routes
- React Query used in Instructor portal (best pattern in the codebase)

**Issues:**

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| A-9 | HIGH | Three separate Axios instances with different auth behavior: `api/index.ts` (double Bearer prefix), `api.ts` (no auth at all), `services/api.ts` (correct) | `api/index.ts`, `api.ts`, `services/api.ts` |
| A-10 | MEDIUM | Inconsistent portal navigation: HR and SuperAdmin use `useState` + switch/case (no URL routing, no bookmarking, no back/forward). Other portals use React Router | `HRPortal.tsx`, `SuperAdminPortal.tsx` |
| A-11 | MEDIUM | No shared data-fetching abstraction. Instructor portal uses React Query hooks (good), Accounting uses raw useState/useEffect, others use mixed patterns | Multiple portals |
| A-12 | MEDIUM | AccountingPortal is a 1018-line monolith with 5 sub-components and duplicated fetch logic | `AccountingPortal.tsx` |
| A-13 | MEDIUM | Duplicate components: 2 PasswordReset (different min lengths), 2 ErrorBoundary implementations. At least one of each is dead code | `components/auth/PasswordReset.tsx`, `components/PasswordReset.tsx` |

---

## 2. Code Quality

### 2.1 TypeScript Correctness

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| Q-1 | HIGH | Pervasive `conn.query<any[]>` and `pool.query<any[]>` throughout services and routes. Column name typos become runtime errors. ~50+ instances | All services and routes |
| Q-2 | HIGH | 13 route handlers use `request.body as any` with manual destructuring instead of Zod schemas | See Section 4 for full list |
| Q-3 | MEDIUM | `Promise<any[]>` return types on public service methods: `getBillingQueue()`, `getAllInvoices()`, `findRejected()`, `getPayments()` | `BillingService.ts`, `InvoiceRepository.ts` |
| Q-4 | MEDIUM | Non-null assertions (`!`) after `findById()` calls in 5+ places. If record deleted between commit and read, crashes with null dereference | `BillingService.ts:130`, `CourseService.ts:88,192,255,341` |
| Q-5 | MEDIUM | `ACCESS_TOKEN_EXPIRY` validated as `z.string()` with no format regex. A value like `"banana"` passes Zod but crashes `jwt.sign()` at runtime | `config/env.ts:17` |
| Q-6 | LOW | `database.ts` declares `let pool: mysql.Pool` without `| undefined`. TypeScript won't catch pre-initialization access | `config/database.ts:5` |

### 2.2 ESM Correctness

All imports use `.js` extensions. Top-level `await` used correctly in `index.ts` and `errorHandler.ts`. **No issues found** -- this is well done.

### 2.3 Async/Await Patterns

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| Q-7 | MEDIUM | Signal handlers `process.on('SIGINT', () => shutdown('SIGINT'))` return Promises that are not caught. If shutdown rejects, it becomes an unhandled rejection | `index.ts:36-37` |
| Q-8 | LOW | `errorHandler` is synchronous but returns `reply.status().send()` which returns `FastifyReply`. Should be async or return void | `errorHandler.ts:10` |

### 2.4 Dead Code

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| Q-9 | LOW | `UserRepository.findByRole(role)` ignores the `role` parameter, calls `findAll()` instead | `UserRepository.ts:42-47` |
| Q-10 | LOW | `courses.ts` references non-existent role `'superadmin'` in `requireRole()` | `courses.ts:105` |
| Q-11 | LOW | `api.ts` (root frontend) has functions returning hardcoded mock data: `getInvoices`, `getBillingQueue`, `createInvoice` return empty arrays | `frontend/src/api.ts:76-134` |
| Q-12 | LOW | `SuperAdminPortal` has `const [data, setData] = useState([])` that is never used in render | `SuperAdminPortal.tsx:50` |

---

## 3. Performance

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| P-1 | HIGH | Revenue report runs 24 sequential queries (2/month x 12). Should be 2 queries with `GROUP BY MONTH()` | `billing.ts:198-219` |
| P-2 | MEDIUM | `addStudents()` executes individual INSERTs in a loop with no transaction. 30 students = 30 round-trips. Should use multi-row INSERT | `CourseStudentRepository.ts:33-40` |
| P-3 | MEDIUM | PDF generation runs synchronously in the request thread, buffers entire PDF in memory. Blocks event loop during layout | `PDFService.ts`, `billing.ts:427` |
| P-4 | MEDIUM | 7+ queries have no LIMIT clause. `admin.ts` org listing, `vendor-admin.ts` invoices, `misc.ts` classes all return unbounded results | Multiple |
| P-5 | MEDIUM | DB connection pool: `connectionLimit: 10`, `queueLimit: 0` (unlimited). No `connectTimeout`. Under load, requests queue indefinitely | `database.ts:15-16` |
| P-6 | MEDIUM | InvoiceRepository billing queue hardcodes `* 1.13` tax rate in SQL instead of using `taxConfig.HST_RATE`. Inconsistent with other calculations | `InvoiceRepository.ts:114` |
| P-7 | LOW | Frontend: `OrganizationPortalContainer` adds `params: { _t: Date.now() }` cache-buster to every React Query call, defeating caching entirely | `OrganizationPortalContainer.tsx` |
| P-8 | LOW | Frontend: `UserManager`, `CourseManager` fetch all records with no pagination | `UserManager.tsx:55`, `CourseManager.tsx:51` |

---

## 4. Security

### 4.1 Authentication & Authorization

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| S-1 | **CRITICAL** | IDOR: `calculate-balance` uses `(request as any).role` instead of `request.userRole`. `isOrgUser` is always `false`, so org filter never applies. Any authenticated user can query any invoice's balance | `org-billing.ts:188` |
| S-2 | **CRITICAL** | IDOR: `GET /vendor/invoices/:id` and `/invoices/:id/details` only require `requireAuth` (any user), no vendor-scoping. Any authenticated user can read any vendor invoice | `vendors.ts:210,233` |
| S-3 | HIGH | No refresh token revocation. Password changes don't invalidate existing tokens. Stolen refresh token valid for 7 days. No server-side token tracking, no blacklist, no `jti` claim | `AuthService.ts:36-59` |
| S-4 | HIGH | `validate-billing` and `ready-for-billing` routes only require `requireAuth`, no role check. Any authenticated user (student, vendor, HR) can mark courses ready for billing | `courses.ts:180,189` |
| S-5 | HIGH | Admin `PUT /users/:id` returns `SELECT * FROM users` including `password_hash` in the response body | `admin.ts:184` |
| S-6 | HIGH | Vendor `submit-to-admin` and `resend-to-admin` don't verify the invoice belongs to the requesting vendor. A vendor can submit another vendor's invoice | `vendors.ts:257,320` |
| S-7 | HIGH | SSE `/events` endpoint has no `preHandler` for authentication. Unauthenticated DoS vector | `routes/index.ts:27` |
| S-8 | HIGH | No account lockout mechanism. Brute-force limited only by global rate limit (100 req/min) | `AuthService.ts:19-33` |
| S-9 | MEDIUM | Wrong role string: vendor download uses `'accounting'` instead of `'accountant'`. Accountants get 403 on vendor invoice downloads | `vendors.ts:271` |
| S-10 | MEDIUM | Instructor can view any other instructor's timesheet summary by changing `instructorId` parameter (IDOR) | `timesheets.ts:210` |

### 4.2 Input Validation

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| S-11 | HIGH | 13 route handlers use `request.body as any` without Zod validation. Combined with BaseRepository `create()/update()` accepting arbitrary column names, this enables mass assignment | See full list below |
| S-12 | HIGH | Mass assignment risk: `BaseRepository.create()` and `update()` write any key from the data object as a column name. If unvalidated request body flows through, attackers can write to arbitrary columns | `BaseRepository.ts:67-83,86-96` |
| S-13 | MEDIUM | `parseInt()` on path parameters without NaN check in nearly every route. MySQL handles gracefully but defense-in-depth is missing | Multiple |
| S-14 | MEDIUM | Query string parameters extracted via `request.query as Record<string, string>` with no validation in ~15 route handlers | Multiple |

**Routes using `request.body as any` (no Zod validation):**
1. `admin.ts` -- PUT /courses/:id, PUT /users/:id, PUT /organizations/:id, POST /vendors, PUT /vendors/:id
2. `colleges.ts` -- PUT /colleges/:id
3. `organization-pricing.ts` -- POST /calculate-cost
4. `organizations.ts` -- POST /course-request
5. `pay-rates.ts` -- PUT /tiers/:id
6. `timesheets.ts` -- PUT /timesheets/:timesheetId
7. `email-templates.ts` -- POST /:id/preview, POST /:id/clone, POST /:id/test-send

### 4.3 Data Exposure

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| S-15 | HIGH | `password_hash` returned in admin user update response | `admin.ts:184` |
| S-16 | MEDIUM | `system_configurations` returned via `SELECT *` -- may contain secrets | `admin.ts:302` |
| S-17 | MEDIUM | Staging environment leaks raw `error.message` for 500 errors on publicly accessible URL | `errorHandler.ts:38-41` |
| S-18 | MEDIUM | 23 `console.log` calls in `authService.ts` log usernames and emails to browser console in production. Not gated by dev mode | `frontend/src/services/authService.ts` |
| S-19 | MEDIUM | CSP allows `'unsafe-inline'` for `scriptSrc`, weakening XSS protection | `app.ts:26` |

### 4.4 JWT Security

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| S-20 | HIGH | No token revocation on password change (see S-3) | `AuthService.ts:51-59` |
| S-21 | HIGH | Refresh tokens not invalidated after rotation -- old token can be replayed until expiry | `AuthService.ts:36-48` |
| S-22 | MEDIUM | JWT payload includes `orgId` (internal DB ID visible to client) | `AuthService.ts:71` |
| S-23 | LOW | JWT secrets validated (min 32 chars) but no rotation mechanism | `config/env.ts:15-16` |

### 4.5 File Upload Security

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| S-24 | MEDIUM | MIME-only file type validation (client-spoofable). No magic-bytes check. HTML uploads allowed (XSS risk if served) | `vendors.ts:156-158` |
| S-25 | LOW | File size properly limited to 10MB | `app.ts:40` |

### 4.6 Frontend Security

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| S-26 | HIGH | Double `Bearer` prefix: `tokenService` stores token with `Bearer ` prefix. `api/index.ts` interceptor adds another `Bearer `. Sends `Authorization: Bearer Bearer eyJ...` | `tokenService.ts:85`, `api/index.ts:16` |
| S-27 | HIGH | Root `api.ts` sends requests with `withCredentials: true` but NO auth header. Any component importing this client makes unauthenticated requests | `frontend/src/api.ts:6-9` |
| S-28 | LOW | `dangerouslySetInnerHTML` used with DOMPurify sanitization -- properly handled | `EmailTemplateManager.tsx:1033` |

---

## 5. Reliability & Observability

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| R-1 | HIGH | No monitoring beyond UptimeRobot. No metrics (latency, error rates, pool utilization). No alerting infrastructure (PagerDuty, etc.) | Infrastructure |
| R-2 | HIGH | No backup strategy visible in codebase. No backup verification or offsite storage | Infrastructure |
| R-3 | MEDIUM | Shallow `/health` endpoint doesn't check DB. External monitors report "UP" even with dead database | `app.ts:54` |
| R-4 | MEDIUM | SSE connections have no timeout, no connection limit, no auth. Can prevent graceful shutdown | `routes/index.ts:27-42` |
| R-5 | MEDIUM | No `fetch()` timeout on Resend API calls. If Resend hangs, request blocks indefinitely. No circuit breaker or retry logic | `EmailService.ts:255` |
| R-6 | MEDIUM | No shutdown timeout. If `app.close()` hangs (stuck SSE), process never exits | `index.ts:29-34` |
| R-7 | MEDIUM | `EmailService` uses `console.log` (9 instances) instead of Pino logger, bypassing structured logging | `EmailService.ts` |
| R-8 | LOW | `pino-pretty` loaded in dev mode. If `NODE_ENV` unset (defaults to 'development'), loads dev transport in production | `logger.ts:6-7` |

---

## 6. Testing

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| T-1 | **CRITICAL** | Zero backend unit tests. Vitest configured but no test files exist | `backend/src/` |
| T-2 | **CRITICAL** | Zero frontend unit tests. Vitest configured but no test files exist | `frontend/src/` |
| T-3 | HIGH | No integration tests for billing lifecycle (course -> invoice -> payment), the revenue-critical path | N/A |
| T-4 | HIGH | Hardcoded test credentials (`test123`) committed to public GitHub repo | `tests/e2e/fixtures.ts:6-13` |
| T-5 | MEDIUM | E2E tests share state within serial blocks -- cascading failures. No test data isolation (uses live staging DB) | `tests/e2e/portal.spec.ts` |
| T-6 | MEDIUM | E2E covers only login/navigate/logout smoke tests. No business workflow tests (scheduling, billing, payments) | `tests/e2e/portal.spec.ts` |
| T-7 | LOW | Single-browser E2E (Chromium only). No Firefox/WebKit | `playwright.config.ts` |

---

## 7. DevOps & Deployment

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| D-1 | HIGH | Cron-based deployment with no rollback, no health check after deploy, no blue-green. Failed builds go undetected. Half-deployed states possible | `deploy-production.sh` |
| D-2 | HIGH | 5 files access `process.env` directly, bypassing Zod validation: `BillingService.ts`, `admin.ts`, `email-templates.ts`, `organization-pricing.ts`, `taxConfig.ts`. Typos in env var names fail silently | Multiple |
| D-3 | HIGH | Default password `'ChangeMe123!'` hardcoded in admin user creation route | `admin.ts:154` |
| D-4 | MEDIUM | `taxConfig.ts` reads `process.env.HST_RATE` directly. `parseFloat` on invalid string returns `NaN`, silently corrupting all tax calculations | `taxConfig.ts:5-7` |
| D-5 | LOW | TypeScript strict mode enabled. Source maps generated. Good | `backend/tsconfig.json` |

---

## 8. Concrete Improvements

### 8.1 Immediate Fixes (Critical/High)

**Fix AuthError to include statusCode:**
```typescript
// BEFORE (broken -- returns 500)
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// AFTER (returns proper 401)
export class AuthError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}
```

**Fix IDOR in calculate-balance:**
```typescript
// BEFORE (broken -- request.role doesn't exist)
const isOrgUser = (request as any).role === 'organization';

// AFTER
const isOrgUser = request.userRole === 'organization';
```

**Fix double Bearer prefix -- remove prefix from tokenService:**
```typescript
// BEFORE (tokenService.ts:85)
const formattedToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

// AFTER -- store raw JWT, let interceptors add prefix
inMemoryToken = token.replace(/^Bearer\s+/, '');
```

**Add Zod validation to unvalidated routes (example):**
```typescript
// BEFORE (organizations.ts:102)
const { courseTypeId, scheduledDate, ... } = request.body as any;

// AFTER
const courseRequestSchema = z.object({
  courseTypeId: z.coerce.number().int().positive(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().min(1).max(255),
  locationId: z.coerce.number().int().positive().optional(),
  registeredStudents: z.coerce.number().int().min(1).max(100),
  notes: z.string().max(1000).optional(),
});
const data = courseRequestSchema.parse(request.body);
```

**Exclude password_hash from admin response:**
```typescript
// BEFORE (admin.ts:184)
const [rows] = await pool.query<any[]>('SELECT * FROM users WHERE id = ?', [id]);

// AFTER
const [rows] = await pool.query<any[]>(
  'SELECT id, username, email, full_name, first_name, last_name, role, organization_id, status, phone, mobile, created_at, updated_at FROM users WHERE id = ?',
  [id]
);
```

### 8.2 Architectural Recommendations

1. **Consolidate API clients**: Delete `frontend/src/api.ts` and `frontend/src/api/index.ts`. Standardize on `frontend/src/services/api.ts`. Update all imports.

2. **Add typed query results**: Define row interfaces for every SQL query. Replace `conn.query<any[]>` with `conn.query<InvoiceRow[]>`.

3. **Implement refresh token rotation with DB tracking**:
   - Create `refresh_tokens` table (id, user_id, token_hash, expires_at, revoked_at)
   - On refresh: invalidate old token, issue new one
   - On password change: revoke all tokens for user

4. **Add request/response logging**: Register Fastify `onRequest`/`onResponse` hooks or re-enable Fastify's built-in logger with a custom serializer.

5. **Standardize portal navigation**: Migrate HRPortal and SuperAdminPortal from useState to React Router nested routes.

6. **Add Zod schemas to all route handlers**: Every route should validate `request.body`, `request.params`, and `request.query` via Zod. Fastify 5 supports schema-based validation natively.

### 8.3 Performance Optimizations

1. **Revenue report**: Replace 24 queries with 2 `GROUP BY MONTH(invoice_date)` queries.
2. **addStudents**: Use multi-row INSERT: `INSERT INTO course_students VALUES (?,?,?,?), (?,?,?,?), ...`
3. **PDF generation**: Stream pdfkit output directly to `reply.raw` instead of buffering in memory.
4. **DB pool**: Set `queueLimit: 50`, `connectTimeout: 10000`, increase `connectionLimit` via env var.
5. **Add LIMIT to unbounded queries**: All list endpoints should enforce a maximum LIMIT (e.g., 500).

---

## Prioritized Issue List

### CRITICAL (Fix immediately -- security/data risk)
1. S-1: IDOR on `calculate-balance` (wrong property name)
2. S-2: IDOR on vendor invoice detail (no scoping)
3. T-1/T-2: Zero unit/integration tests
4. T-4: Hardcoded credentials in public repo
5. A-3: AuthError returns 500 instead of 401

### HIGH (Fix before commercial launch)
6. S-3/S-20/S-21: No token revocation/rotation
7. S-4: Billing routes missing role checks
8. S-5/S-15: password_hash leaked in API response
9. S-11/S-12: 13 routes with no input validation + mass assignment risk
10. S-26/S-27: Triple API client with broken auth
11. S-7/S-8: Unauthenticated SSE + no account lockout
12. R-1/R-2: No monitoring or backup strategy
13. D-1: Cron deployment with no rollback/health check
14. Q-1: Pervasive `any` types in SQL queries
15. P-1: Revenue report 24 queries

### MEDIUM (Fix for enterprise quality)
16. A-6: No HTTP access logging
17. S-9: Wrong role string in vendor download
18. S-10: Instructor timesheet IDOR
19. S-17/S-18: Error/PII leakage (staging errors, console.log)
20. S-19: CSP unsafe-inline
21. P-2: N+1 student inserts
22. P-3: PDF blocks event loop
23. P-5: DB pool configuration
24. R-3: Shallow health endpoint
25. R-5: No fetch timeout on email API
26. D-2/D-4: process.env bypass
27. A-10/A-11: Inconsistent frontend patterns

### LOW (Polish for enterprise)
28. A-7/A-8: SPA fallback issues
29. Q-5: Token expiry format not validated
30. Q-9-Q-12: Dead code cleanup
31. R-7/R-8: Console.log instead of logger
32. T-7: Single-browser testing

---

## Production Readiness Score: 4.5 / 10

| Category | Score | Weight | Justification |
|----------|-------|--------|---------------|
| Architecture | 6/10 | 15% | Good layered design, but inconsistent DI, broken error hierarchy, and frontend fragmentation |
| Code Quality | 5/10 | 15% | TypeScript strict enabled, but pervasive `any`, missing validation, dead code |
| Performance | 5/10 | 10% | Adequate for current scale, but N+1 patterns, unbounded queries, and blocking PDF will not scale |
| Security | 3/10 | 25% | Multiple IDOR vulnerabilities, no token revocation, password hash exposure, mass assignment risk, no input validation on 13 routes |
| Reliability | 4/10 | 15% | Graceful degradation for optional services is good, but no monitoring, no backups, no alerting |
| Testing | 1/10 | 10% | Zero unit/integration tests. Only 36 E2E smoke tests. Credentials in public repo |
| DevOps | 4/10 | 10% | TypeScript strict and source maps good, but cron deploy with no rollback, env bypass, hardcoded defaults |

**Weighted Score: 3.8 / 10** (rounded to 4.5 for above-average architecture and transaction handling)

**To reach 7/10 (minimum for enterprise):**
- Fix all CRITICAL and HIGH security issues (IDOR, token revocation, input validation)
- Add unit tests for services (especially BillingService, CourseService, AuthService)
- Add integration tests for billing lifecycle
- Consolidate frontend API clients
- Implement monitoring and alerting
- Add backup verification

**To reach 9/10 (enterprise-grade):**
- All of the above, plus:
- Full Zod validation on every route
- Typed SQL query results throughout
- DB-backed refresh token rotation
- Per-route rate limiting
- Comprehensive E2E workflow tests
- CI/CD pipeline with automated testing and rollback
- Structured request/response logging
- Metrics and dashboards (p99 latency, error rates, pool utilization)
