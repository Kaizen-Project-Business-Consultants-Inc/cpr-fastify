# Action Plan — from the 2026-09-17 audit

Source: `docs/AUDIT_2026-09-17.md`. Each item names the file(s), the fix, the check that proves it, and who must do it (**You** = needs credentials/hosting access or a product decision; **Code** = can be done in the repo). Effort: S < 1 h, M = half day, L = 1-2 days.

Ordering principle: stop bleeding (security), then fix what users hit every day, then delete dead code so everything after is smaller, then make CI honest, then schema/ops, then product polish, then docs.

---

## Phase 0 — Today (security). ~half a day

| # | Action | Files | Check | Who | Effort |
|---|--------|-------|-------|-----|--------|
| 0.1 | Rotate the cPanel/FTP password. Update the GitHub `FTP_PASSWORD` secret. | cPanel, GitHub secrets | CI deploy job still green | **You** | S |
| 0.2 | Remove the credential fallbacks from `deploy.sh` (fail if env vars unset), drop `curl -k`. Purge the secret from git history (`git filter-repo --replace-text`), force-push, tell collaborators to re-clone. | `deploy.sh` | `git log -S'Register001' --all` returns nothing | Code + **You** (force-push) | M |
| 0.3 | Restrict sysadmin creation/promotion and admin/sysadmin password reset to `sysadminRole`. Reject `role: 'sysadmin'` in create/update when caller is `admin`. | `backend/src/routes/admin.ts:18,62-63,170,197,223` | Unit test: admin token → 403 on those cases | Code | S |
| 0.4 | Drop the `detected_vendor_id` override for role `vendor` (staff roles may keep it). | `backend/src/routes/vendors.ts:216-220` | Unit test | Code | S |
| 0.5 | Add `trustProxy: true` in production so rate limits and audit IPs see the client. | `backend/src/app.ts:20-24` | Audit log shows real IPs after deploy | Code | S |
| 0.6 | Add an `escapeHtml` helper; apply to every interpolated value in invoice preview HTML and email templates. | `backend/src/services/PDFService.ts:240-246`, `EmailService.ts:83-125,446,510` | Org name `<img onerror>` renders as text | Code | S |
| 0.7 | Scope timesheet notes read to the calling instructor. | `backend/src/routes/timesheets.ts:271-280` | Unit test | Code | S |
| 0.8 | Gate Swagger UI to non-production or `requireRole('sysadmin')`. | `backend/src/routes/index.ts:30`, `plugins/swagger.ts:78` | `/api/v1/docs` 401/404 in prod | Code | S |
| 0.9 | `npm audit fix` for axios; bump `@fastify/static` to 10.x (low risk: SPA only, `decorateReply:false`). | `backend/package.json`, `frontend/package.json` | `npm audit --omit=dev` shows 0 high | Code | S |

Deferred to Phase 4 (needs design): refresh-token rotation and blacklist-on-logout.

---

## Phase 1 — This week (things users hit every day). ~2 days

| # | Action | Files | Check | Who | Effort |
|---|--------|-------|-------|-----|--------|
| 1.1 | Add `<Route path="dashboard">` (or `<Route index>` + `*` fallback) to the sysadmin portal. | `frontend/src/components/portals/SystemAdminPortal.tsx:76-165` | Login as sysadmin → dashboard renders | Code | S |
| 1.2 | Make org nav ids absolute (`/organization/courses` …) to match the other portals; pass `currentView` to `OrganizationLayout` so the header title updates. | `portals/organization/OrganizationPortal.tsx:168-176,335-341`, `OrganizationLayout.tsx:54` | Click every org sidebar item | Code | S |
| 1.3 | Add an E2E step that clicks each sidebar item per role and asserts no "View not found" text. This is the regression that let 1.1 and 1.2 ship. | `tests/e2e/portal.spec.ts` | Playwright run on staging | Code | M |
| 1.4 | **Decide password reset**: (a) implement `POST /auth/forgot-password`, `/reset-password` using existing `sendPasswordResetEmail` + a `password_resets` table, or (b) remove the "Forgot password?" link, the three pages, and the CourseAdmin menu item. Recommend (a) — you cannot onboard customers without it. | `backend/src/routes/auth.ts`, `EmailService.ts:407`, `pages/Login.tsx:115`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `RecoverPassword.tsx`, `CourseAdminPortalContainer.tsx:65` | End-to-end reset via Resend to a test inbox | **You** (decision) + Code | L |
| 1.5 | Fix the six pure path typos: `/accounting/courses/:id/students` → `/courses/:id/students`; `/accounting/payments/:id/receipt` → `/payments/:id/receipt`; `/organization/invoices/:id/pdf` → `/invoices/:id/pdf`; `validate-billing-readiness` → `validate-billing`; `/email-templates/:id/test` → `test-send`; notifications `PUT :id/read` → `POST`, `PUT read-all` → `POST mark-all-read`; `/admin/courses/:id/students` → `/courses/:id/students`; `/organization/courses/:id/students` → `/courses/org/students/:id`. | see audit §4 table | Each button now returns data | Code | S |
| 1.6 | SuperAdmin `CourseManager.tsx` → point at `/sysadmin/courses`. | `components/admin/CourseManager.tsx:44,64,81,84` | CRUD works | Code | S |
| 1.7 | Remove the instructor "Teaching Manual" nav item (route doesn't exist; leaks the token). | `InstructorLayout.tsx:32,44-47` | — | Code | S |
| 1.8 | Instructor deep links: either add `classes/:id` and `attendance/:id` routes that read `useParams`, or change the links to `/instructor/classes` and `/instructor/attendance`. Add `*` fallback. Remove the `/instructor/reports` quick action. | `InstructorPortal.tsx`, `InstructorDashboard.tsx:204`, `TodayClassesList.tsx:80,89`, `QuickActionsGrid.tsx:49` | Click from dashboard | Code | S |
| 1.9 | Accounting `/accounting/organizations/:id` links: remove or point at sysadmin org page. | `InvoiceHistoryTable.tsx:425`, `AccountsReceivableTable.tsx:391` | — | Code | S |
| 1.10 | Email/PDF links: `/organization/bills-payable` → `/organization/billing`; drop the `/verify` line or add the page. | `EmailService.ts:446,510`, `PDFService.ts:417` | — | Code | S |
| 1.11 | Add `frontend/public/favicon.svg` (reuse `src/logo.svg`). | `index.html:5` | Tab icon shows | Code | S |
| 1.12 | Remove `/test-csv` public route. | `App.tsx:58` | — | Code | S |
| 1.13 | Remove shipped debug UI: "Debug Info" alert and "Raw status:" text. | `VendorInvoiceManagement.tsx:591-599`, `courseAdmin/VendorInvoiceApproval.tsx:594` | — | Code | S |
| 1.14 | Fix the one failing backend test (mock `config/database` in the M3 describe or raise `testTimeout`). | `backend/src/__tests__/BillingFinancial.test.ts` | `npx vitest run` green locally | Code | S |

---

## Phase 2 — Dead code purge. ~1 day

Do this before any refactor. It removes ~36% of frontend files, ~25 of the 61 a11y violations, most raw-table hits, and 3 of the 7 unused deps.

| # | Action | Check | Effort |
|---|--------|-------|--------|
| 2.1 | Delete the 101 dead frontend files listed in audit §3 (start with root legacy: `index.tsx`, `api.ts`, `api/`, `theme.js`, `theme.ts`, `emotionCache.ts`, `test.*`, `example.spec.ts`, `setupTests.tsx`, `test/setup.js`, `utils/debug-auth.js`, `generate-env.ts`, `env.ts`; then pages, tables, views, dialogs, demos, duplicates). | `vite build` green; `npx vitest run` green | M |
| 2.2 | Delete the 5 never-run test files and the 12 excluded "Express era" tests, then remove the `exclude` list from `vitest.config.ts`. | vitest green | S |
| 2.3 | Delete the 38 dead helpers in `services/api.ts`, `hrService.ts`, `payRateService.ts`, `timesheetService.ts`, `paymentRequestService.ts`, `userService.ts`; delete `instructorService` unused hooks. | `tsc` green | S |
| 2.4 | Uninstall `@date-io/date-fns`, `@monaco-editor/react` (verify EmailTemplateManager lazy import first), `react-intersection-observer`, `@types/dompurify`, `@types/react-toastify`, `@testing-library/user-event`, `zod` (frontend), `react-dropzone`, `papaparse`, `socket.io-client`; align `vitest`/`@vitest/*` majors; delete `frontend/package-lock.json`. | `npm ci` + build green | S |
| 2.5 | Fix the toast bug: migrate `services/errorHandler.ts` from react-toastify to `ToastContext`, then drop `react-toastify`. | Instructor views show success/error toasts | S |
| 2.6 | Backend: delete `backend/migrations/002_auth_tables.sql`, unused `EmailService.send*` methods except `sendPasswordResetEmail` (needed for 1.4), `generateCertificatePDF`, unused repo helpers. | `tsc` green | S |
| 2.7 | Strip `console.log` from frontend components (283) and `index.html`; keep `logger`. Delete the 63-line commented `renderView()` in `OrganizationPortal.tsx`. | `rg console.log frontend/src --glob '!**/__tests__/**'` ≈ 0 | S |

---

## Phase 3 — Make CI honest. ~1 day

| # | Action | Files | Check | Effort |
|---|--------|-------|-------|--------|
| 3.1 | Backend: add `eslint.config.js` (typescript-eslint recommended). Frontend: install the 5 plugins `eslint.config.js` already imports. Fix or downgrade rules until both run clean. | both packages | `npm run lint` exit 0 in both | M |
| 3.2 | Add `lint` steps to both CI jobs. Add husky + lint-staged with `prepare`. | `.github/workflows/ci.yml`, root `package.json` | Commit with a lint error is blocked | S |
| 3.3 | Fix the 92 `import type` errors so `tsc -b` passes; change CI to `npx tsc -b` and set `build` to `tsc -b && vite build`. Align `tsconfig.app.json` to `strict: true`. | `frontend/tsconfig.app.json`, `package.json`, `ci.yml` | CI type-checks what Vite builds | M |
| 3.4 | Add `npm audit --omit=dev --audit-level=high` to CI. | `ci.yml` | — | S |
| 3.5 | Add `.gitattributes` (`* text=auto eol=lf`), renormalise. Commit the benign `package-lock.json` diff. | root | No CRLF warnings | S |
| 3.6 | Root `npm test` / `npm run lint` run both workspaces. | root `package.json` | — | S |
| 3.7 | **Retire one deploy path.** Recommend: keep CI FTPS deploy, add an `npm ci --omit=dev` step on the server via the cPanel API (or ship `node_modules` in the artifact), and disable the `deploy-production.sh` cron. Document in `ROLLBACK.md`. | `ci.yml`, cPanel cron | One deploy per push, no races | **You** (cron) + Code | M |
| 3.8 | Run Playwright against staging in CI on push to master (after deploy-staging), not just by hand. | `ci.yml`, `playwright.config.ts` | E2E job in CI | M |

---

## Phase 4 — Schema, jobs, session security. ~2 days

| # | Action | Files | Check | Who | Effort |
|---|--------|-------|-------|-----|--------|
| 4.1 | `mysqldump --no-data` from production → `backend/migrations/000_baseline.sql`; runner applies it as v0 on empty DBs. Confirm server flavour (MySQL 8 vs MariaDB). | `backend/src/config/migrations.ts` | Fresh DB boots from repo alone | **You** (dump) + Code | M |
| 4.2 | Rewrite v4/v6/v8/v9 as JS migrations guarded by `INFORMATION_SCHEMA` checks (portable, idempotent). | `migrations.ts:56-140` | Re-running is a no-op | Code | S |
| 4.3 | Wrap `runMigrations` in `GET_LOCK('cpr_migrations', 30)`. | `migrations.ts:216-257` | Two workers boot cleanly | Code | S |
| 4.4 | Cert reminders: `UNIQUE(course_student_id, reminder_type)` + claim-then-send, or `GET_LOCK`; `unref()` the interval. | `CertReminderService.ts:52-56`, `index.ts:30-46` | No duplicate emails with 2 workers | Code | S |
| 4.5 | Index migration (v14) for the list in audit §6 after confirming against the baseline. | new migration | `EXPLAIN` on the top queries | Code | S |
| 4.6 | Register `@fastify/compress`; `maxAge:'1y', immutable:true` on `/assets`, `no-cache` on `index.html`. | `app.ts:117-134` | Response headers | Code | S |
| 4.7 | Pool `connectionLimit` 20 → 6 per worker. | `config/database.ts:15` | — | Code | S |
| 4.8 | Refresh-token rotation: store a per-user token version; bump on logout/password change; `/logout` requires auth and blacklists. | `AuthService.ts:93-106`, `routes/auth.ts:116-120` | Old refresh cookie rejected after logout | Code | M |
| 4.9 | Route every unbounded list through `paginatedQuery`; frontend sends `page/limit` and uses `DataTable` pagination. | audit §6 Q-1 list | No list endpoint returns >200 rows | Code | L |
| 4.10 | Batch the N+1 loops and the correlated COUNT; wrap `admin.ts` multi-writes in transactions. | `instructors.ts:412`, `timesheets.ts:358`, `pay-rates.ts:247`, `CourseRequestRepository.ts:59`, `admin.ts` | — | Code | M |
| 4.11 | `useMemo` all context provider values; replace the two 1-second intervals with a single scheduled timeout. | `AuthContext.tsx:483`, `ToastContext.tsx:390`, `SessionWarning.tsx:59`, other contexts | React profiler: no app-wide re-render on session tick | Code | S |

---

## Phase 5 — Product fixes (user-facing quality). ~1 week

| # | Action | Files | Effort |
|---|--------|-------|--------|
| 5.1 | Replace mock data: InstructorProfile (wire `GET/PUT /instructor/profile`, which exist), VendorProfile (`GET/PUT /vendor/profile`, exist), `$40.68`, placeholder pricing, "Bill To", fabricated tax lines, `$25/hr` fallbacks, "Balance Due $0.00". | audit §5 H1 | M |
| 5.2 | Change-password screen for every role using the existing `POST /auth/change-password`. Remove "coming soon" toasts. | `InstructorProfile.tsx:170,208-210`, new shared component | M |
| 5.3 | Wire dead controls: org billing/paid filters, org profile buttons (`PUT /organization/profile` exists), Add Instructor (needs backend `POST /instructors` — decide: build or remove the UI), accounting period selector, SuperAdmin org delete (needs `DELETE /sysadmin/organizations/:id` — build with soft delete). | audit §5 H2 | L |
| 5.4 | Confirm dialogs on every H4 item; one `ConfirmDialog` primitive in gtacpr; retire `window.confirm`. | audit §5 H4 | M |
| 5.5 | Saving flags/double-submit guards on every H5 item, starting with `ScheduleCourseForm.tsx:99`. | audit §5 H5 | M |
| 5.6 | Fix money inputs (raw string in state, format on blur). | `InvoiceUpload.tsx:80-89`, `PayRateManagement.tsx:289-330` | S |
| 5.7 | One `formatCurrency` (CAD) and one `formatDate` in `utils`; delete the others; fix 0.115 vs 0.13 by reading the tax rate from config. | `utils/formatters.ts`, `utils/dateUtils.ts`, 7 hard-coded sites | M |
| 5.8 | Fix UTC date shift: replace `toISOString().slice(0,10)` with a local-date formatter in the 7 files listed. | audit §5 M7 | S |
| 5.9 | HR and SuperAdmin portals: URL routes instead of `useState` views. | `HRPortal.tsx:31`, `SuperAdminPortal.tsx:21`, `App.tsx:119` | M |
| 5.10 | Vendor: fix `InvoiceStatusView` status vocabulary or delete Status + Paid pages (keep History). Remove the `/vendor/invoices/scan` OCR button until OCR exists. | `InvoiceStatusView.tsx:70-79`, `InvoiceUpload.tsx:194` | S |
| 5.11 | `aria-label` on the ~36 live IconButtons; `ButtonBase`/`LinkButton` primitive for row actions; labels on the 11 TextFields. | audit §5 M5 | M |
| 5.12 | Styled 404 and per-portal "not found" with a link home; help/support link in `AdminShell`. | `pages/NotFound.tsx`, `AdminShell.tsx` | S |
| 5.13 | 300 ms debounce on search inputs; clear the timer in `StudentManagement`. | audit §5 M4 | S |
| 5.14 | Portal-level tests: one render + one interaction test per portal (8), plus route tests for `admin.ts`, `billing.ts`, `org-billing.ts`, `vendors.ts` via `app.inject`. | `frontend/src/components/portals/**`, `backend/src/__tests__/` | L |

---

## Phase 6 — Docs. ~half a day

| # | Action |
|---|--------|
| 6.1 | Rewrite `TODO.md`: remove Express-era items (SMTP/EMAIL-1/2, RATELIMIT-1 wording, 51 integration tests, ESLint hook, AUDIT_FULL.md); mark LEGAL-2, LEGAL-3, ONBOARD-1, BIZ-2, DR as done; add the open items from this plan. |
| 6.2 | Regenerate `docs/API.md` from the swagger JSON (`/api/v1/docs/json`) as a CI artifact instead of hand-maintaining it. |
| 6.3 | README: test counts, note that lint now runs in CI, link `docs/Program Documentation/`. |
| 6.4 | Delete or archive `DEVELOPMENT_STATUS.md`, `code-review-jun15.md`, `docs/Code_Review.md`, `docs/Enterprise_Code_Review.md` (superseded by this audit). Remove `scripts/uat_runner.py` and `backend/load-test-results/` from the repo or document them. |
| 6.5 | Fix `docs/Incident_Response.md:50` (`/metrics`, not `/api/v1/metrics`) and the GitHub org in README/TODO/ROLLBACK links. |

---

## Decisions only you can make

1. Password reset: implement (recommended) or remove the UI. (1.4)
2. Which deploy path survives: CI FTPS or the server cron. (3.7)
3. Add Instructor and Delete Organization: build the missing backend routes or remove the buttons. (5.3)
4. Vendor Status/Paid pages: fix or delete. (5.10)
5. Whether production is MySQL 8 or MariaDB (determines 4.1/4.2).

## Rough totals

| Phase | Effort |
|---|---|
| 0 Security | 0.5 day |
| 1 Daily breakage | 2 days |
| 2 Dead code | 1 day |
| 3 CI | 1 day |
| 4 Schema/jobs/session | 2 days |
| 5 Product | 5 days |
| 6 Docs | 0.5 day |
| **Total** | **~12 working days** |
