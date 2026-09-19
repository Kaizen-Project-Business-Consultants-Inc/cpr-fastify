# CPR Training Management System — TODO

Rewritten 2026-09-18 against `docs/AUDIT_2026-09-17.md` and `docs/ACTION_PLAN_2026-09-17.md`.
Items that described the retired Express codebase were removed. Phases 0–5 of the action
plan are complete and deployed; this file lists only what is still open.

Legend: 🔴 before taking paying customers · 🟡 soon · 🟢 when convenient

## 🔴 Security & operations

- [ ] **Rotate the cPanel/FTP password** and update the `FTP_PASSWORD` GitHub secret. The old password was committed in `deploy.sh` (removed 2026-09-17) and remains in git history until rotated or the history is purged.
- [x] **Offsite database backup (BACKUP-2)**: `.github/workflows/backup.yml` runs nightly at 03:30 UTC — fetches the newest server dump, refuses it if older than 36h, test-restores it into MariaDB 11.4, mirrors `uploads/vendor-invoices/`, copies both to Backblaze B2 bucket `GTA-CPR-Backups` (90-day retention), emails on failure. First successful run 2026-09-18 (63 tables restored).
- [ ] **Durable uploads (S2)**: vendor PDFs are copied offsite nightly by the backup workflow (up to 24h exposure). Longer term, write them straight to the bucket at upload time.
- [ ] **Hosting process limit (HOSTING-1)**: TMD LVE cap is 100 processes / 2 GB / 2 CPU. On 2026-09-17 git/npm/FTP on the server failed for hours with "Resource temporarily unavailable". Check cPanel → Resource Usage; remove leftover cron jobs (`crontest.sh`, the three Moodle crons if unused); consider the managed VPS before onboarding several customers.
- [ ] **Baseline schema dump (4.1)**: 30 business tables have no DDL in the repo. Production is **MariaDB 11.4** (confirmed from the dump header 2026-09-18). Run `mysqldump --no-data` on production and add it as migration v0 so a fresh environment can be built from git.

## 🔴 Commercial / legal (no code)

- [ ] **SaaS pricing & billing model (BIZ-1)** — decide before the first paying customer.
- [ ] **Support channel (BIZ-4)** — the sidebar "Help & Support" link currently emails `admin@kpbc.ca`; confirm that mailbox and a response-time commitment.
- [ ] **Dedicated noreply mailbox (EMAIL-2)** — `EMAIL_FROM` is `noreply@kpbc.ca`; confirm SPF/DKIM for `kpbc.ca` and that password-reset mail is delivered (send one from the login page).
- [ ] **Demo / trial environment (BIZ-3)**; **per-org branding (BIZ-6)**; **self-serve onboarding (ONBOARD-1)** — product decisions.

## 🟡 Engineering debt (from the audit)

The audit's engineering-debt list was cleared on 2026-09-18. What is left:

- [x] **Repo-wide snake_case/camelCase audit (2026-09-18/19).** Four bugs found the same day
  (pending/confirmed course lists, the vendor invoice list on all three roles' screens, and
  the org's own "My Courses" list — see the bug log below) shared one root cause: a query
  doing `SELECT t.*, ...` with only snake_case aliases, silently leaving the camelCase
  property the frontend reads as `undefined`. Rather than pattern-match a fix everywhere,
  four parallel audits checked every one of the ~30 remaining raw `table.*` queries in the
  backend against what its actual frontend consumer reads, to avoid masking a *different*
  bug by blindly aliasing fields nothing uses. Result: 9 more confirmed live bugs fixed —
  `organization-pricing.ts` (all 4 endpoints), `CoursePricingRepository`, `pay-rates.ts`
  (instructor list + rate history), `payroll.ts`, `timesheets.ts` (list, detail, approve,
  notes), and `InvoiceRepository.findRejected`. One adjacent bug fixed in passing:
  `findPendingApproval` never joined to get the course type at all (a missing JOIN, not a
  casing issue) — the Pending Approvals screen's course-type column was blank regardless.
  `ProfileChangeRepository`'s three queries were fixed too but are currently unreachable —
  `HRDashboard.tsx` calls a `/hr-dashboard/*` path that doesn't exist (a separate,
  pre-existing routing bug, not fixed here; see below).
  Confirmed **not** bugs, left alone: `billing.ts`/`org-billing.ts`'s invoice PDF/preview
  and payment verify/reverse endpoints (feed a PDF generator or a hand-built JSON body,
  never a raw row); the rest of `InvoiceRepository.findPendingApproval`'s fields (frontend
  reads snake_case there on purpose, per its own code comment); `StudentRepository` +
  `admin.ts` `/sysadmin/students` (same, snake-case-first component);
  `CourseRequestRepository.findWithBillingDetails` (service already maps to camelCase
  before returning).
- [ ] **`HRDashboard.tsx` calls `/hr-dashboard/stats`, which doesn't exist** — only
  `/hr/dashboard` is registered. Found while auditing `ProfileChangeRepository` above; the
  dashboard has likely been 404ing since it was written. There's a second, unused
  `hrService.ts` whose `getDashboard()` correctly points at `/hr/dashboard`, but nothing
  calls it either — worth checking which of the two services the dashboard should actually
  use before just repointing the URL.
- [ ] **Two dead-code endpoints found in the same audit, no frontend caller at all:**
  `GET /student/upcoming-classes` and `/student/completed-classes` (students.ts), and
  `GET /classes` (misc.ts, superseded by `/courses/pending`/`/confirmed`/`/completed`).
  Confirm whether to wire them up or remove them.
- [ ] **`InstructorManagement.tsx` reads `validationData.validationErrors`** from
  `GET /courses/:id/validate-billing`, but the backend DTO field is named `errors` — found
  while auditing `CourseRequestRepository.findWithBillingDetails` above. The bulleted error
  list in the "can't mark ready for billing" confirm dialog is always empty.
- [ ] **E2E flakiness on the shared host**: a dashboard check occasionally needs a retry;
  consider extra `retries` scoped to the "dashboard loads" tests only. Test timeouts were
  raised to 20s in both packages after 5s proved too tight under load.
- [ ] **Backend route tests**: guard coverage exists (`routes.guards.test.ts`); add
  `app.inject` tests for the billing lifecycle, org-billing and vendor flows — faster than
  a browser test and would catch a field-name mismatch without needing staging. A real
  browser-driven equivalent now exists (see below) but only runs on request.
- [ ] **`tests/e2e/workflows.spec.ts`** (added 2026-09-18) drives real cross-role
  transactions — availability → course request → instructor assignment, and vendor
  invoice upload → admin approval → payment — against staging, tagging every record it
  creates so it's safe to leave. It found four of the bugs below in one run. It's
  excluded from the default CI run (`INCLUDE_WORKFLOWS=1 npx playwright test
  tests/e2e/workflows.spec.ts` to run it) because it's slower and shares the login rate
  limit with everything else; worth scheduling on a cadence (e.g. nightly) rather than
  running it only by hand.
- [ ] **CI action Node runtime**: `SamKirkland/FTP-Deploy-Action@v4.3.5` and
  `actions/*-artifact@v5` still target Node 20 (GitHub forces 24); update when new
  releases target 22+.
- [ ] **Frontend `set-state-in-effect` (29 warnings)**: mostly "reset form state when a
  dialog opens" and fetch-on-mount. Clearing them means adopting the query layer or
  remounting via `key` — both change behaviour, so each carries a scoped disable with a
  reason. Revisit if the query layer is adopted more widely.
- [ ] **Split context files so Fast Refresh works (8 warnings)**: seven contexts export a
  `useX()` hook beside their Provider. Mechanical, but rewrites 20–40 import sites each.

### Cleared 2026-09-18
Server-side pagination (20 screens, opt-in `?page`/`limit` so unpaginated callers are
unchanged) · vendor-invoice summary endpoint (approvals screen 7 requests → 2; the paid
screens no longer download the whole list to sum it) · transactions around every
multi-step write in `admin.ts` and `instructors.ts` · PIPEDA retention job (dry run unless
`RETENTION_ENFORCE=true`) · tax rate served from `GET /config` · backend bundling (host
packages 18 → 5; only `pdfkit` needed in production) · vendor PDFs mirrored to object
storage at upload · context providers memoised, `SessionWarning`'s per-second timer
removed · every native `alert()`/`window.confirm()` gone from the app · namespace
`import * as api` removed from 12 files · portal tests for all 8 portals · backend
`no-explicit-any` 0 and an error; frontend warnings 714 → 46, six rules promoted to error.

### Bugs this work uncovered and fixed
- **The 5-day instructor-cancellation rule didn't exist server-side at all**, and the one
  frontend UI lock suggesting it used 11 days, not 5, with no enforcement behind it —
  restored per the intended business rule, enforced on the server. A second, independent
  copy of the same stale 11-day check lived in `MyClassesView.tsx` and was missed on the
  first pass. The initial fix also had its own bug: it compared distance from today
  without checking direction, so a date months in the past was also treated as "5 days or
  less away" and blocked from removal with a misleading message — caught live on staging
  and fixed same day.
- **CSV student upload always failed with "Authentication required."** It read a
  `window.tokenService` global that nothing in the app ever set; the real token lives in
  the `tokenService` module every other API call already uses.
- **CSV student upload gave zero confirmation on success**, so a working upload and a
  silently-failed one looked identical — which is what led directly to the next bug.
- **Re-uploading a CSV (because the one above gave no confirmation) duplicated the entire
  roster** — `addStudents` did a raw INSERT with no duplicate check at all. Now skips
  anyone already on the course. There was also no way to remove a student from a roster
  anywhere in the app; added `DELETE /courses/org/students/:courseId/:courseStudentId`.
  Building that surfaced a second pre-existing bug: `course_students.deleted_at` was
  referenced by a live query in `instructor-admin.ts` (the instructor-schedule endpoint)
  but the column never actually existed, so that endpoint had likely been failing all
  along; added via migration v19.
- **"REG." on My Courses never updated after uploading the actual roster**, by design it
  should: the org's initial estimate should start there, then track the real headcount
  once names are uploaded. `registered_students` was set once at course-request time and
  never written again anywhere in the backend — also the exact figure billing calculates
  `students_billed` from, so an invoice could silently disagree with the real roster.
  `addStudents`/the new `removeStudent` now resync it from the live roster count. Fixing
  this also surfaced a *fourth* instance of the snake_case/camelCase bug below, in the
  org's own course list — `registeredStudents` would have stayed blank on screen even with
  the count correct in the database.
- **Admin could never assign an instructor to a newly requested course.** `GET
  /courses/pending` (and confirmed/completed/cancelled, sharing the same query)
  returned `scheduled_date`, `course_type_name`, `registered_students` etc. in
  snake_case only; the UI reads `course.scheduledDate` and friends, so the
  "Assign Instructor to Course" dialog always showed a blank name/org/date and
  0 students, and its `if (course.scheduledDate)` guard always failed — so it
  never even checked for an available instructor. Found and fixed 2026-09-18
  by a new end-to-end test that actually requests a course and assigns an
  instructor, not just loads the screen.
- **The vendor invoice list's "View"/"Download" buttons always read "invoice
  undefined."** Same class of bug in three more places: the vendor's own
  invoice history, the admin approval screen, and the accounting screen —
  each selected `vi.*` with no camelCase aliases.
- **Recording a payment on a vendor invoice has never worked.** Two stacked
  bugs: the request body was snake_case on the wire but the server required
  camelCase (fixed to match the app's convention), and even after that, the
  amount field was sent as a string while the server requires a number — every
  attempt threw "Expected number, received string" and no payment was ever
  recorded. Both found and fixed 2026-09-18.
- **Recording an invoice payment never worked.** `RecordPaymentDialog` sent
  `amount_paid`/`payment_method`/`reference_number`; the server's zod schema requires
  `amount`/`paymentMethod`/`reference`, so every submission threw before reaching the
  database. Loose typing (`Record<string, unknown>`) hid it.
- **Accounts Receivable showed only the newest 25 invoices.** `AccountingPortal` called
  `getInvoices()` with no arguments; that endpoint always paginates. Older unpaid invoices
  never appeared and nothing indicated the list was partial.
- **Organization billing showed only 10 invoices** — `/organization/invoices` defaults to
  `limit=10` and nothing asked for more. **Transaction history** totalled only 25 rows.
- **"Paid to date" in the payment dialog always read $0.00** (summed `amount_paid` from
  rows that carry `amount`, and read the envelope instead of `data`).
- **"Partially Paid" on the accounting vendor screen always read 0** — it tested
  `paymentStatus`, which only ORGANISATION invoices carry. Now derived from payments.
- **Payment Date and Notes in the payment dialog were collected and discarded.** The
  `payments` table already had both columns; the endpoint now accepts them.
- **`AuthContext`'s memoised value was defeated** by six callbacks rebuilt each render, so
  the 40+ consumers it was meant to protect re-rendered anyway.
- **Two render loops** (`InstructorDashboard`, `InvoiceStatsDashboard`): effects deriving
  state from a `= []` default whose identity changed every render.
- **Instructor dashboard Refresh wiped the whole query cache, including auth.**
- **20 latent temporal-dead-zone references** to functions declared below their use.
- **`useErrorHandler` held a stale closure** across four callbacks.

### Bugs found 2026-09-19 (real E2E verification of the 9-location snake/camelCase audit)
Auditing ~30 flagged snake_case/camelCase locations turned up 9 real bugs (fixed same day),
but "no SQL error" isn't proof a screen actually renders right — so each fix was re-verified
with Playwright driving the real screen against real seeded data (`tests/e2e/verify-fixes.spec.ts`).
That verification pass surfaced several more genuine, previously-undiscovered bugs, none of
which the original audit would have caught:
- **Setting an instructor's pay rate has never worked** and **adding a timesheet note has
  never worked** — both sent camelCase form fields to endpoints whose zod schemas require
  snake_case. Fixed in `payRateService.ts`/`timesheetService.ts`.
- **`instructor_pay_rates`' unique index (`uq_instructor_active`, `UNIQUE(instructor_id,
  is_active)`) broke every *second* rate change for the same instructor** — not a partial
  index, so it also capped each instructor at exactly one historical (inactive) row ever.
  Dropped via migration v22; the app already enforces "one active rate" correctly at the
  service layer.
- **Creating a payroll payment and submitting a timesheet have likely never worked, for
  anyone** — `payroll_payments.notes`, `timesheets.course_details`, and
  `timesheets.travel_time`/`prep_time`/`teaching_hours`/`is_late`/`hr_comment` were all
  columns the code always assumed existed but never actually did (migrations v20, v21).
  Only found because those two routes got real error surfacing instead of a swallowed 500 —
  see the `handleError`/`httpError` pattern below.
- **Approving or rejecting an invoice from the accounting UI has never worked.**
  `approveInvoice`/`rejectInvoice` (`api.ts`) and `InvoiceDetailDialog`'s approve-post-and-
  email flow all sent `approval_status`; the endpoint requires camelCase `approvalStatus` —
  same bug class as the pay-rate one, just missed by the original audit because it's a
  service-function call site, not a raw fetch.
- **Rejecting an invoice has never worked at the database level either**, on top of the
  above: `invoices.rejection_reason` was referenced by both the reject route and the
  Rejected Invoices screen but never actually existed as a column (migration v23). Only
  found after fixing the casing bug above got the request *past* validation.
- **Systemic finding: routes that `throw err` on anything but their own typed error class
  silently masked the real DB/logic error as "An unexpected error occurred."** This is what
  hid the missing-column bugs above behind a generic message with no way to diagnose them
  short of reading server logs. Fixed for pay-rates, payroll, timesheets, and all of billing.ts
  (`handleError` now uses the `httpError` utility and logs before responding) — worth
  auditing the remaining route files for the same `throw err;` pattern.
- **Architecture split, not a bug — needs a product decision:** `course_pricing` (backs the
  admin "Organization Pricing" manager at `/accounting/course-pricing`) and
  `organization_pricing` (backs the org's own read-only view at `/organization-pricing/*`)
  are two completely disconnected tables with no relationship between them — confirmed via
  direct API queries showing one had data the other didn't. Pricing set by an admin through
  one screen does not appear on the org's own pricing view, and vice versa. Not silently
  merged; needs a decision on which table is authoritative (or whether both are needed).

## 🟢 Features (unchanged from before; not started)

- Real-time dashboards (WebSocket/SSE beyond the current `/events` stream); predictive analytics
- OCR receipt scanning (OCR-1; the vendor UI button was removed until this exists)
- SMS notifications; calendar sync; document management; online payments; recurring courses
- LMS evaluation capture; student marketing emails (needs PIPEDA consent flow)
- Offline support; push notifications; i18n
- Cookie consent banner (only if analytics/tracking is added); signup consent checkbox (only if self-signup is added)

## ✅ Done (2026-09-17/18, see git history and the action plan)

Security hardening (admin→sysadmin escalation, vendor invoice IDOR, XSS escaping, trustProxy, Swagger hidden in prod, dependency CVEs) · password reset built · sysadmin/org navigation fixed · 44 broken API calls fixed · 101 dead frontend files and 10 unused packages removed · ESLint/type-checked builds/npm audit/E2E in CI · husky pre-commit · CI deploys staging and production and restarts them · self-contained backend bundle · MySQL-8-compatible guarded migrations with a startup lock · indexes · duplicate-safe cert reminders · rotated refresh tokens and real logout · compression and asset caching · mock data removed · change-password for all roles · confirmations on destructive actions · double-submit guards · one currency/date/tax formatter · UTC date-shift fix · HR/SuperAdmin URL routes · Add Instructor, Delete Organization, org locations, download-my-data endpoints · docs regenerated from the route table.
