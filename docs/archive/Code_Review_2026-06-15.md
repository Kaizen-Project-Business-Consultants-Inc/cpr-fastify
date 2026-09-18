# CPR Training App - Full Code Review

**Date**: 2026-06-15
**Reviewer**: Claude Opus 4.6
**Scope**: Entire codebase (backend routes, services, repositories, config, plugins, frontend portals, auth, API clients)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 12 |
| HIGH | 21 |
| MEDIUM | 29 |
| LOW | 24 |
| **Total** | **86** |

---

## CRITICAL (12)

### C-1: SQL Injection via Dynamic Column Name in Profile Change Approval
- **File**: `backend/src/services/HRService.ts:131`
- **Issue**: `UPDATE users SET \`${change.field_name}\` = ?` interpolates a value from the `profile_changes` table. An allowlist check exists at approval time (`PROFILE_CHANGE_ALLOWED_FIELDS`), but the pattern is dangerous — if someone inserts a malicious `field_name` via another bug or direct DB access, this allows SQL injection through the column name.

### C-2: SSE Endpoint Has No Authentication
- **File**: `backend/src/routes/index.ts:27-42`
- **Issue**: `GET /api/v1/events` (Server-Sent Events) has no `preHandler` for authentication. Any unauthenticated client can connect and hold a server connection open indefinitely, consuming resources. This is a DoS vector given the server's 100-process LVE limit.

### C-3: Vendor Profile Update Uses Wrong Column Names
- **File**: `backend/src/routes/vendors.ts:78-85`
- **Issue**: The UPDATE query writes to `vendor_name`, `contact_first_name`, `contact_last_name` — columns that don't match the actual table schema (`name`, `contact_email`, `contact_phone`, `address` as used in `admin.ts`). Vendor profile updates silently fail or error.

### C-4: Vendor Invoice Detail/Download Endpoints Lack Org Scoping
- **File**: `backend/src/routes/vendors.ts:210-254`
- **Issue**: `GET /vendor/invoices/:id` and `GET /vendor/invoices/:id/details` only require `requireAuth` (any authenticated user), not `requireRole('vendor')`. No `vendor_id` scoping check. Any authenticated user can read any vendor invoice by ID.

### C-5: UserRepository.findByRole() Ignores the Role Parameter
- **File**: `backend/src/repositories/UserRepository.ts:42-47`
- **Issue**: The `role` parameter is accepted but never used in the query. `findAll()` returns ALL users regardless of role. Any caller expecting role-filtered results gets all users — a data leakage bug.

### C-6: No Refresh Token Revocation / Rotation
- **File**: `backend/src/services/AuthService.ts:36-49`
- **Issue**: Refresh tokens are stateless JWTs with no server-side tracking (no `refresh_tokens` table, no single-use enforcement). A stolen refresh token is valid for 7 days. No way to revoke on password change. Token reuse (replay attack) is undetectable.

### C-7: BaseRepository.count() Accepts Raw SQL String
- **File**: `backend/src/repositories/BaseRepository.ts:106-113`
- **Issue**: The `where` parameter is interpolated directly into SQL (`AND ${where}`). No current callers use untrusted input, but the method signature is an open injection vector for future callers.

### C-8: findByUsername() Returns Inactive/Deleted Users
- **File**: `backend/src/repositories/UserRepository.ts:26-31`
- **Issue**: No `status = 'active'` filter. Login is mitigated (AuthService checks status after retrieval), but `findByEmail()` has the same gap with no downstream guard. Future code using these methods for password reset or account lookup will return inactive users.

### C-9: Three Competing Axios Instances with Different Auth Behavior
- **Files**: `frontend/src/api/index.ts`, `frontend/src/api.ts`, `frontend/src/services/api.ts`
- **Issue**: Three separate axios instances exist. `api.ts` (root) has `withCredentials: true` but NO auth token interceptor — requests go out unauthenticated. `api/index.ts` has a 401 interceptor that does hard navigation with no token refresh. `services/api.ts` has proper token refresh queue. Components importing from the wrong client get different auth behavior.

### C-10: Double Bearer Prefix on Authorization Header
- **File**: `frontend/src/services/tokenService.ts:85-99`
- **Issue**: `setAccessToken` prepends `Bearer ` before storing in sessionStorage. The request interceptor in `api/index.ts:17` ALSO adds `Bearer `. This creates `Bearer Bearer <jwt>` on requests using that client. The `services/api.ts` interceptor does NOT add the prefix, creating inconsistency.

### C-11: Password Reset Token Exposed in URL
- **File**: `frontend/src/components/auth/PasswordReset.tsx:22`
- **Issue**: Reset token is in a URL query parameter, logged in browser history, proxy logs, and Referer header. The form renders even without a token (non-null assertion `token!` at line 39).

### C-12: Duplicate Bearer Prefix Race Between Default Header and Interceptor
- **File**: `frontend/src/services/authService.ts:87-88`
- **Issue**: After login, `tokenService.setAccessToken(accessToken)` (prepends Bearer) AND `api.defaults.headers.common['Authorization'] = accessToken` (raw token) are both called. The interceptor reads the Bearer-prefixed version. If the interceptor doesn't trigger (e.g., on retry), the default header sends a raw token without prefix.

---

## HIGH (21)

### H-1: Admin PUT /users/:id Returns password_hash
- **File**: `backend/src/routes/admin.ts:184`
- **Issue**: Response after updating a user returns `SELECT *` which includes `password_hash`. Bcrypt hash leaked to client.

### H-2: fixCalculations Does Not Update base_cost or tax_amount
- **File**: `backend/src/services/BillingService.ts:287-289`
- **Issue**: Recalculates `baseCost` and `totalAmount` but only updates `amount` and `rate_per_student`. Does NOT update `base_cost` or `tax_amount` columns. Org billing routes use `base_cost + tax_amount` for balance calculations — these remain at old values.

### H-3: Double Invoice Creation Race Condition
- **File**: `backend/src/services/BillingService.ts:67-139`
- **Issue**: Checks `ready_for_billing = true` and sets `invoiced = TRUE` after insert, but no `SELECT FOR UPDATE` or unique constraint on `course_request_id`. Two concurrent requests can create duplicate invoices.

### H-4: Unbounded Queries Without LIMIT
- **Files**: `admin.ts:201`, `vendor-admin.ts:25,93,202`, `vendors.ts:128`, `misc.ts:17`, `billing.ts:100`
- **Issue**: ~7 queries return unbounded result sets with no LIMIT clause. Will degrade as data grows.

### H-5: org-billing.ts Depends on invoice_with_breakdown View
- **File**: `backend/src/routes/org-billing.ts:52`
- **Issue**: ~10 queries reference `invoice_with_breakdown` database view. If the view is dropped or broken, ALL org billing endpoints fail simultaneously. Single point of failure.

### H-6: Revenue Report N+1 Query Pattern
- **File**: `backend/src/routes/billing.ts:196-221`
- **Issue**: Iterates 12 months, runs 2 queries per month (24 total). Should be 2 queries with `GROUP BY MONTH()`.

### H-7: Admin User Listing Includes Anonymized/Deleted Users
- **File**: `backend/src/routes/admin.ts:110-143`
- **Issue**: No `status = 'active'` filter. Anonymized records from PIPEDA erasure (`deleted_xxx@deleted.invalid`) appear in user list. Privacy concern.

### H-8: Attendance Endpoint Unreliable JOIN
- **File**: `backend/src/routes/instructors.ts:407-423`
- **Issue**: JOIN between `classes` and `course_requests` matches on instructor_id + date. Two courses on the same day produce a cross-product that inflates student counts.

### H-9: CourseStudentRepository hasSoftDelete=false but Table Has deleted_at
- **File**: `backend/src/repositories/CourseStudentRepository.ts:17`
- **Issue**: Constructor passes `hasSoftDelete=false`, but the `CourseStudent` interface declares `deleted_at: Date | null`. Soft-deleted students appear in all query results.

### H-10: Invoice Payment Status Inconsistency (verified vs completed)
- **File**: `backend/src/repositories/InvoiceRepository.ts`
- **Issue**: `getDashboard()` filters `status = 'verified'`. `findPendingApproval()` filters `status = 'completed'`. `findAllWithDetails()` omits `deleted_at IS NULL`. These inconsistencies produce wrong financial calculations.

### H-11: addStudents() Loops Individual INSERTs Without Transaction
- **File**: `backend/src/repositories/CourseStudentRepository.ts:31-41`
- **Issue**: Individual INSERTs in a loop. If the 5th of 10 fails, you get partial insertion with no rollback. Also poor performance (N round trips).

### H-12: Billing Queue Hardcodes Tax Rate * 1.13
- **File**: `backend/src/repositories/InvoiceRepository.ts:114`
- **Issue**: SQL hardcodes `* 1.13` instead of using `taxConfig.HST_RATE`. If tax rate changes, billing queue totals are wrong while other parts use the correct rate.

### H-13: BaseRepository.forOrg() Uses Object.create() — Shared Mutable State
- **File**: `backend/src/repositories/BaseRepository.ts:25-29`
- **Issue**: `Object.create(this)` creates a prototype-chained object. Mutation of the original instance affects all scoped copies. TypeScript `private` is compile-time only.

### H-14: AuthService Instantiated at Module Scope Before Database Connection
- **File**: `backend/src/plugins/auth.ts:14`
- **Issue**: Creates singleton `AuthService` + `UserRepository` at import time, outside Fastify lifecycle. If imported before `connectDatabase()`, any method call will throw.

### H-15: React Rules of Hooks Violation — VendorPortal
- **File**: `frontend/src/components/portals/VendorPortal.tsx:26-45`
- **Issue**: Early returns (Navigate, loading spinner) BEFORE `useEffect` on line 43. Violates Rules of Hooks — can cause runtime errors.

### H-16: React Rules of Hooks Violation — AccountingPortal
- **File**: `frontend/src/components/portals/AccountingPortal.tsx:845`
- **Issue**: `useState` called AFTER early returns on lines 811-842. Hook call order changes depending on conditions.

### H-17: Extensive console.log of Auth Data in Production
- **Files**: `services/authService.ts`, `services/api.ts`, `contexts/AuthContext.tsx`, `pages/Login.tsx`
- **Issue**: Raw `console.log` calls log usernames, token presence, session IDs, `[DEEP TRACE]` auth flow. Not gated by `isDev`. Visible in production browser consoles.

### H-18: 401 Interceptor Triggers forceLogout During Token Refresh
- **File**: `frontend/src/services/api.ts:157-165`
- **Issue**: If a refresh request returns 401 with `AUTH_1003`, `forceLogout` navigates away while refresh promise is still processing. Can leave `isRefreshing` flag stuck and `failedQueue` unprocessed.

### H-19: Two PasswordReset Components with Different Min Lengths
- **Files**: `frontend/src/components/auth/PasswordReset.tsx:33` (8 chars), `frontend/src/components/PasswordReset.tsx:45` (6 chars)
- **Issue**: Different minimum password lengths. The 6-char version could allow passwords that fail backend validation (min 8).

### H-20: validateTokenOnPageLoad Uses Stale Closure
- **File**: `frontend/src/contexts/AuthContext.tsx:69-196`
- **Issue**: Captures `user` from outer closure. Called on every route change via context. Multi-tab logout scenarios can read stale state.

### H-21: Inconsistent Password Min Length Between Frontend and Backend
- **Issue**: Backend requires min 8 chars. One frontend PasswordReset component allows 6. Users can set passwords that fail backend validation.

---

## MEDIUM (29)

### M-1: Balance Calculation Inconsistency Between Endpoints
- **File**: `backend/src/routes/org-billing.ts:157-161 vs 200-205`
- **Issue**: `/organization/invoices/:id/balance-calculation` calculates outstanding as `totalAmount - verified` (ignores pending). `/invoices/:id/calculate-balance` calculates as `total - verified - pending`. Same user gets different amounts.

### M-2: Timesheet Month Filter Ignores Year
- **File**: `backend/src/routes/timesheets.ts:66`
- **Issue**: `MONTH(t.week_start_date) = ?` matches the month of ANY year.

### M-3: Organization Course Request Has No Zod Validation
- **File**: `backend/src/routes/organizations.ts:99-116`
- **Issue**: Uses `request.body as any` with manual field checks. `courseTypeId` and `registeredStudents` not type-checked.

### M-4: Vendor Invoice Download Uses Wrong Role String
- **File**: `backend/src/routes/vendors.ts:271`
- **Issue**: Checks for `'accounting'` but the actual role is `'accountant'`. Accountant users fail this check and get 403.

### M-5: courseadmin Can Re-confirm Completed/Cancelled Courses
- **File**: `backend/src/routes/courseadmin.ts:26-41`
- **Issue**: Sets `status = 'confirmed'` without checking current status. Completed, cancelled, or already-confirmed courses can be re-confirmed.

### M-6: Invoice Number Collision Possible
- **File**: `backend/src/services/BillingService.ts:107`
- **Issue**: `INV-${year}-${String(Date.now()).slice(-6)}` — last 6 digits of timestamp. Only 1M unique values/year. Same-millisecond requests collide.

### M-7: Payroll Uses Hardcoded Default Rates
- **File**: `backend/src/routes/payroll.ts:110-111`
- **Issue**: Default $25/hr and $50 course bonus hardcoded instead of from system configuration.

### M-8: HR Returned Payment Matches on Amount Instead of FK
- **File**: `backend/src/services/HRService.ts:240-248`
- **Issue**: Matches `payroll_payments` on `instructor_id + amount + status` instead of a direct FK. Two payments for same instructor and amount — wrong one could be approved.

### M-9: Swallowed Error in Timesheet Reminders
- **File**: `backend/src/routes/timesheets.ts:356-358`
- **Issue**: `catch { // Notification table may not exist }` — reports success to user ("Reminders sent") when nothing happened.

### M-10: SPA Fallback Reads index.html at Startup Only
- **File**: `backend/src/app.ts:59-67`
- **Issue**: `readFileSync` at startup, cached in memory. New frontend deploys require backend restart.

### M-11: Double Invoice Creation — No Unique Constraint
- **File**: `backend/src/services/BillingService.ts:67-139`
- **Issue**: No unique constraint on `course_request_id` in invoices table. Concurrent requests bypass the `ready_for_billing` check.

### M-12: Error Messages Leak on Staging
- **File**: `backend/src/plugins/errorHandler.ts:38-43`
- **Issue**: Staging is publicly accessible (`stagecprapp.kpbc.ca`). Raw error messages including stack traces sent to clients.

### M-13: taxConfig.ts Bypasses Zod Validation
- **File**: `backend/src/utils/taxConfig.ts:5-7`
- **Issue**: Reads `process.env.HST_RATE` directly. `parseFloat` on invalid string returns `NaN`, silently corrupting tax calculations. Not declared in `env.ts` schema.

### M-14: CoursePricingRepository.upsert() Race Condition
- **File**: `backend/src/repositories/CoursePricingRepository.ts:51-73`
- **Issue**: Check-then-act without transaction or `INSERT ON DUPLICATE KEY UPDATE`. Concurrent requests can create duplicate pricing rows.

### M-15: env.ts Calls process.exit(1) on Validation Failure
- **File**: `backend/src/config/env.ts:36`
- **Issue**: Kills process immediately without graceful shutdown. Makes invalid-env scenarios impossible to test.

### M-16: BaseRepository Table Name Not Escaped in SQL
- **File**: `backend/src/repositories/BaseRepository.ts:50-109`
- **Issue**: `${this.table}` interpolated without backtick escaping. Safe now (trusted input) but defensive escaping would be safer.

### M-17: JWT Payload Includes orgId
- **File**: `backend/src/services/AuthService.ts:71`
- **Issue**: JWTs are base64-visible to clients. `orgId` reveals internal database IDs.

### M-18: BaseRepository.query() Bypasses Org-Scoping and Soft-Delete
- **File**: `backend/src/repositories/BaseRepository.ts:117-125`
- **Issue**: Escape-hatch methods used extensively in specialized repos. Caller must manually add org-scoping and `deleted_at IS NULL` — some forget.

### M-19: calculate-balance Uses Wrong Property for Role Check
- **File**: `backend/src/routes/org-billing.ts:188`
- **Issue**: `(request as any).role` instead of `request.userRole`. `isOrgUser` is always `false` — org-scoping filter never applies. Any authenticated user can calculate any invoice's balance.

### M-20: HRPortal Route Missing /* Wildcard
- **File**: `frontend/src/App.tsx:119`
- **Issue**: `/hr` without `/*` — only matches exact path. HR portal uses state-based navigation, so state lost on refresh and URLs not bookmarkable.

### M-21: Duplicate PasswordReset Components
- **Files**: `frontend/src/components/auth/PasswordReset.tsx`, `frontend/src/components/PasswordReset.tsx`
- **Issue**: Two separate components with different validation, navigation, and UI. Unclear which route uses which.

### M-22: No Pagination on UserManager, CourseManager, Billing Queue
- **Files**: `frontend/src/components/admin/UserManager.tsx:55`, `CourseManager.tsx:51`, `AccountingPortal.tsx:94,166`
- **Issue**: Fetch ALL records with no pagination. Performance degrades as data grows.

### M-23: Client-Side Invoice Filtering in AccountingPortal
- **File**: `frontend/src/components/portals/AccountingPortal.tsx:168-173`
- **Issue**: Fetches ALL invoices, filters client-side by approval_status, balanceDue, paymentStatus. Should be server-side.

### M-24: Stale API Module Returns Mock Data
- **File**: `frontend/src/api.ts:76-134`
- **Issue**: Functions like `getInvoices`, `getBillingQueue`, `createInvoice` return hardcoded empty arrays or mock data. Comments say "endpoint doesn't exist yet." If imported by any component, silently returns no data.

### M-25: Missing useEffect Dependencies in InstructorPortalContainer
- **File**: `frontend/src/components/portals/InstructorPortalContainer.tsx:52`
- **Issue**: `getCurrentView()` called inside useEffect but not in dependency array.

### M-26: Missing useEffect Dependencies in AuthContext
- **File**: `frontend/src/contexts/AuthContext.tsx:292-293`
- **Issue**: `checkAuth` is not stable (no useCallback) but used in `useEffect([], [])`. Captures stale `user`, `justLoggedIn`, `location`.

### M-27: Token Non-Null Assertion in PasswordReset
- **Files**: `frontend/src/components/auth/PasswordReset.tsx:39`, `frontend/src/components/PasswordReset.tsx:53`
- **Issue**: `token!` used without null check. Race condition or re-render could reach this with null token.

### M-28: setTimeout in Logout Handlers Creates Race Condition
- **Files**: `AccountingPortal.tsx:866`, `SuperAdminPortal.tsx:62`, `SystemAdminPortal.tsx:64`, `OrganizationPortalContainer.tsx:216`
- **Issue**: `setTimeout(() => { logout(); navigate('/'); }, 1500)` — user can interact during 1.5s delay. Component may unmount before timeout fires.

### M-29: OrganizationRepository Returns any[]
- **File**: `backend/src/repositories/OrganizationRepository.ts:78,87`
- **Issue**: `getOrgCourses` returns `{ rows: any[]; total: number }` — defeats TypeScript type safety.

---

## LOW (24)

### L-1: Dead requireAuth Import
- **File**: `backend/src/routes/timesheets.ts:4`, `pay-rates.ts`

### L-2: Vendor/Org Routes Registered Without Prefix
- **File**: `backend/src/routes/index.ts:57,59,65`
- **Issue**: `vendorAdminRoutes`, `orgBillingRoutes`, `miscRoutes` define their own prefixes inline. Inconsistent with other routes.

### L-3: Instructor Timesheet Summary Has No Self-Scoping
- **File**: `backend/src/routes/timesheets.ts:210-230`
- **Issue**: Any instructor can view any other instructor's summary by passing their instructorId.

### L-4: email-templates.ts Uses process.env Directly
- **File**: `backend/src/routes/email-templates.ts:168-169`
- **Issue**: Bypasses validated env config. All other email sending uses EmailService singleton.

### L-5: AuthService.refreshToken Catches All Errors as AuthError
- **File**: `backend/src/services/AuthService.ts:36-49`
- **Issue**: DB connection timeout caught and re-thrown as "Invalid refresh token" — masks real error.

### L-6: courses.ts Uses Non-existent Role 'superadmin'
- **File**: `backend/src/routes/courses.ts:105`
- **Issue**: `requireRole('admin', 'sysadmin', 'superadmin')` — `superadmin` not in the role enum. Dead reference.

### L-7: PDFService Hardcodes Placeholder Business Information
- **File**: `backend/src/services/PDFService.ts:108-112`
- **Issue**: "GTA CPR TRAINING SERVICES", "123 Training Way", "(416) 555-0123", HST# "123456789RT0001", "billing@gtacpr.com" — placeholder values, not real business details. Production invoices have incorrect contact info.

### L-8: Student Routes Query Tables That May Not Exist
- **File**: `backend/src/routes/students.ts:16-82`
- **Issue**: Queries `classes.student_id` and `enrollments` table — may be legacy/planned tables that don't exist.

### L-9: organization-pricing.ts calculate-cost Has No Input Validation
- **File**: `backend/src/routes/organization-pricing.ts:64-85`
- **Issue**: `request.body as any` — `studentCount` could be NaN, negative, or string.

### L-10: Database Connection Pool May Be Too Small
- **File**: `backend/src/config/database.ts:15`
- **Issue**: `connectionLimit: 10` with `queueLimit: 0` (unlimited). Dashboard fires 5 parallel queries. Under load, pool saturates.

### L-11: Unlimited Queue on DB Pool
- **File**: `backend/src/config/database.ts:16`
- **Issue**: If DB is slow, requests queue indefinitely instead of failing fast.

### L-12: InvoiceRepository Uses any[] Return Types
- **File**: `backend/src/repositories/InvoiceRepository.ts:104,204,218`
- **Issue**: `getBillingQueue()`, `findRejected()`, `getPayments()` all return `Promise<any[]>`.

### L-13: ProfileChangeRepository.updateStatus() Doesn't Verify Record Exists
- **File**: `backend/src/repositories/ProfileChangeRepository.ts:84-89`
- **Issue**: Returns void, doesn't check `affectedRows`. Non-existent ID silently succeeds.

### L-14: CourseRequestRepository.findDuplicate() Type Mismatch
- **File**: `backend/src/repositories/CourseRequestRepository.ts:151`
- **Issue**: SELECT returns only `id, status` but typed as `Promise<CourseRequest | null>` (all fields).

### L-15: CoursePricingRepository Returns Extra Columns Not in Interface
- **File**: `backend/src/repositories/CoursePricingRepository.ts:20-29`
- **Issue**: Adds `organization_name`, `course_type_name` via JOINs but typed as `CoursePricing[]` which doesn't include them.

### L-16: No Double-Submit Prevention on PasswordReset
- **File**: `frontend/src/components/auth/PasswordReset.tsx:108-116`

### L-17: SuperAdminPortal Uses State-Based Navigation
- **File**: `frontend/src/components/portals/SuperAdminPortal.tsx`
- **Issue**: Uses `useState` instead of React Router. Refresh resets view, back/forward broken.

### L-18: Unused State Variables
- **File**: `frontend/src/components/portals/SuperAdminPortal.tsx:50`
- **Issue**: `const [data, setData] = useState([])` — never used.

### L-19: Excessive Debug Logging in VendorPortal
- **File**: `frontend/src/components/portals/VendorPortal.tsx`
- **Issue**: 18 console.log statements with emoji prefixes, not gated by dev mode.

### L-20: test-csv Route Publicly Accessible
- **File**: `frontend/src/App.tsx:58`
- **Issue**: `<Route path='/test-csv' element={<TestCSV />} />` — no auth guard. Should be removed or protected.

### L-21: ErrorBoundary Retry Reads Pre-Update State
- **File**: `frontend/src/components/common/ErrorBoundary.tsx:368-371`

### L-22: Inconsistent BaseRepository Parameter Ordering
- **File**: `backend/src/repositories/BaseRepository.ts:62`
- **Issue**: `findAll` puts `orgParams` first, `findById` puts `id` first. Works but confusing.

### L-23: Top-Level await for Sentry Import
- **File**: `backend/src/plugins/errorHandler.ts:8`
- **Issue**: Empty catch hides any import errors beyond "not installed".

### L-24: Non-existent Role 'superadmin' in courses.ts
- **File**: `backend/src/routes/courses.ts:105`
- **Issue**: Duplicate of L-6.

---

## Top 10 Priorities

1. **C-9**: Consolidate three API clients into one
2. **C-10/C-12**: Fix Bearer double-prefix — pick one place to add it
3. **C-4**: Add vendor_id scoping to vendor invoice endpoints
4. **H-1**: Exclude password_hash from admin user update response
5. **C-2**: Add requireAuth to SSE endpoint or remove it
6. **H-15/H-16**: Fix React Rules of Hooks violations (move hooks before returns)
7. **C-6**: Add DB-backed refresh token tracking for revocation
8. **H-9/H-10**: Fix hasSoftDelete flags and payment status strings
9. **H-2**: Update fixCalculations to also set base_cost and tax_amount
10. **C-5**: Add WHERE clause to findByRole()
