# CPR Training Management System — TODO

Rewritten 2026-09-18 against `docs/AUDIT_2026-09-17.md` and `docs/ACTION_PLAN_2026-09-17.md`.
Items that described the retired Express codebase were removed. Phases 0–5 of the action
plan are complete and deployed; this file lists only what is still open.

Legend: 🔴 before taking paying customers · 🟡 soon · 🟢 when convenient

## 🔴 Security & operations

- [ ] **Rotate the cPanel/FTP password** and update the `FTP_PASSWORD` GitHub secret. The old password was committed in `deploy.sh` (removed 2026-09-17) and remains in git history until rotated or the history is purged.
- [x] **Offsite database backup (BACKUP-2)**: `.github/workflows/backup.yml` runs nightly at 03:30 UTC — fetches the newest server dump, refuses it if older than 36h, test-restores it into MariaDB 11.4, mirrors `uploads/vendor-invoices/`, copies both to Backblaze B2 bucket `GTA-CPR-Backups` (90-day retention), emails on failure. First successful run 2026-09-18 (63 tables restored).
- [ ] **Durable uploads (S2)**: vendor PDFs are copied offsite nightly by the backup workflow (up to 24h exposure). Longer term, write them straight to the bucket at upload time.
- [ ] **Hosting process limit (HOSTING-1)**: TMD LVE cap is 100 processes / 2 GB / 2 CPU. On 2026-09-17 git/npm/FTP on the server failed for hours with "Resource temporarily unavailable". On 2026-09-21, root cause found via SSH: `guyana-civic` and `kpbc.ca` each had duplicate/orphaned `lsnode` processes (3 and 2 copies respectively) left over from old restarts, driving the account from 33 to 82 threads. Killed the duplicates and stopped the then-unused `cpr.kpbc.ca` production app, back to 33 threads. Still open: cron jobs (`crontest.sh`, the three Moodle crons) haven't been checked/removed yet; consider the managed VPS before onboarding several customers; and watch for `guyana-civic`/`kpbc.ca` re-duplicating on future restarts — the underlying cause of the duplication itself wasn't identified.
- [ ] **Secrets in plaintext in a web-root `.htaccess` (found 2026-09-21)**: `stagecprapp.kpbc.ca`'s (and likely `cpr.kpbc.ca`'s) backend isn't managed through cPanel's Node.js Selector — it's configured via `SetEnv` directives directly in `/home/kaizenmo/stagecprapp.kpbc.ca/.htaccess`, which contains the live DB password, all JWT secrets, and the Resend API key in plaintext, sitting in the web root. Rotate these credentials and move them to a config location outside the document root (or re-register the app properly in cPanel's Node.js Selector, which manages env vars without exposing them in `.htaccess`).
- [x] **Money routes write no audit entries (found and fixed 2026-10-17)**: every money write (31 routes in `billing.ts`, `org-billing.ts`, `payroll.ts`, `pay-rates.ts`, `organization-pricing.ts`, `vendor-admin.ts`, `vendors.ts`, and timesheet approval) now records who changed what in `audit_logs`, inside the same transaction wherever there is one (`writeAudit`; BillingService methods take an `actor`). Tests: `moneyAudit.test.ts`, `auditLog.test.ts`, `BillingService.test.ts`.
- [ ] **Audit instructor timesheet submit/edit (optional)**: `POST /timesheets` and `PUT /timesheets/:id` change hours that feed payroll but write no audit entry. HR approval, the money decision, is audited.
- [ ] **Audit HR override of returned payment requests**: `processReturnedPaymentRequest` (override_approve) writes no audit entry (found by the code reviewer 2026-10-17).
- [ ] **Small error-handling follow-ups (code reviewer, 2026-10-17)**: PUT `/accounting/invoice-sequences` with an organization that doesn't exist now returns a generic 500 (was a 400 leaking SQL); check the org first and return 404. `utils/httpError.ts` reads `process.env.NODE_ENV` while `plugins/errorHandler.ts` reads `env.NODE_ENV`, which defaults to `development` when unset, so the global handler would expose 500 details if NODE_ENV were ever missing; confirm both hosts set `NODE_ENV=production`.
- [ ] **Baseline schema dump (4.1)**: 30 business tables have no DDL in the repo. Production is **MariaDB 11.4** (confirmed from the dump header 2026-09-18). Run `mysqldump --no-data` on production and add it as migration v0 so a fresh environment can be built from git.

## 🔴 Commercial / legal (no code)

- [ ] **SaaS pricing & billing model (BIZ-1)** — decide before the first paying customer.
- [ ] **Support channel (BIZ-4)** — the sidebar "Help & Support" link currently emails `admin@kpbc.ca`; confirm that mailbox and a response-time commitment.
- [ ] **Dedicated noreply mailbox (EMAIL-2)** — `EMAIL_FROM` is `noreply@kpbc.ca`; confirm SPF/DKIM for `kpbc.ca` and that password-reset mail is delivered (send one from the login page).
- [ ] **Demo / trial environment (BIZ-3)**; **per-org branding (BIZ-6)**; **self-serve onboarding (ONBOARD-1)** — product decisions.
- [ ] **Encrypt the offsite backups** — found 2026-10-19. `backup.yml` copies plain database dumps to Backblaze B2 (`GTA-CPR-Backups`); there is no encryption step and no bucket-encryption flag. Simplest fix: turn on B2's server-side encryption for the bucket (Backblaze dashboard → Buckets → Encryption). Then the privacy policy may say "encrypted backups" (it deliberately doesn't today).
- [ ] **Decide: turn on the closed-account clean-up (RETENTION_ENFORCE)** — reminder added 2026-10-19. The privacy policy promises that a closed account's personal details (name, email, username, phone) are anonymised 2 years after closure. The nightly job that does this (`RetentionService`) only runs in **test mode** on both sites, because `SetEnv RETENTION_ENFORCE true` was never added to either app's `.htaccess`. So nothing is actually anonymised yet. No account is old enough today, so there is no harm yet; decide before the first real customer account is 2 years closed. Turning it on = add that line to each `.htaccess` and restart the app (prod `.htaccess` changes need the owner's OK). The new course-request email clean-up (90 days) is separate and already runs for real.

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
  `ProfileChangeRepository`'s three queries were fixed too; the whole profile-change
  feature was later removed (2026-10-18, option B).
  Confirmed **not** bugs, left alone: `billing.ts`/`org-billing.ts`'s invoice PDF/preview
  and payment verify/reverse endpoints (feed a PDF generator or a hand-built JSON body,
  never a raw row); the rest of `InvoiceRepository.findPendingApproval`'s fields (frontend
  reads snake_case there on purpose, per its own code comment); `StudentRepository` +
  `admin.ts` `/sysadmin/students` (same, snake-case-first component);
  `CourseRequestRepository.findWithBillingDetails` (service already maps to camelCase
  before returning).
- [x] **`HRDashboard.tsx` called `/hr-dashboard/stats`, which doesn't exist (fixed
  2026-10-17, Round 4: it now calls `/hr/dashboard`).** Found while auditing
  `ProfileChangeRepository` above; the dashboard had likely been 404ing since it was written. There's a second, unused
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

## 🟡 After the 2026-10-17 code sweep

- [x] **Add screens for finished server features (done 2026-10-18).** Add a sysadmin "Reset password" button (`POST /sysadmin/users/:id/reset-password`) and an "Erase personal data" action (`DELETE /sysadmin/users/:userId/personal-data`, for privacy-law requests). Let Accounting reject a vendor invoice (`POST /accounting/vendor-invoices/:id/reject`). Let organizations remove a student from a roster (`DELETE /courses/org/students/:courseId/:courseStudentId`). Add download buttons for the student, WSIB training-history and invoice CSV exports.
- [x] **Course requests have no "Date Submitted": fixed 2026-10-20** (`3eb2970`, migration 28 backfilled prod's 24 rows from created_at in Toronto time).
- [x] **Course Admin's instructor availability table: fixed 2026-10-20** (`6d99619`, new `GET /instructors/overview`). On staging only; see the deploy item below.
- [x] **Field check of every screen: done and fixed 2026-10-21** (`6d99619`, `fdeec37`). 74 findings, all fixed or decided; report: https://claude.ai/artifact/1hYEU1jVjtX1dRuCcWVcvr. All 181 SQL statements the screens use were EXPLAINed against the staging DB with 0 errors.
- [ ] **🔴 Production is behind staging (since 2026-10-21).** Commits `6d99619`, `fdeec37` and `d8c03cc` are on staging only. **Production has two live bugs fixed only on staging:** organizations cannot submit any payment, and "Erase personal data" fails (hand-added DB CHECK constraints; migration 29 fixes both). Earlier note: commits, deployed by hand from a local build (backup on the server: `~/private/staging-before-deploy-20261021-1515.tgz`). They are NOT pushed to GitHub, because every push to master also deploys production. Before the next push, decide: (a) push as normal and let both sites update after UAT, or (b) change ci.yml so a push deploys staging only and production is a manual run (the auto-mode check blocked Claude from editing ci.yml; the owner can approve it).
- [x] **End-to-end flow test across roles: done 2026-10-21** (`tests/e2e/course-to-payment.spec.ts`; local copy only, `E2E_FULL_FLOW=1` and a localhost BASE_URL; passed 11/11). Still open: staging has 6 leftover "UAT Course 1776…" course types from old automated runs.
- [ ] **Booking notice rules (owner 2026-10-20; revisit after UAT before building).**
  1. Organizations (portal form) must request a course at least **7 calendar days** ahead (weekends count). Enforce on the server too, not just the date picker (`courseRequestSchema` in `organizations.ts` / `courses.ts`, `ScheduleCourseForm` minDate).
  2. Instructors cannot **add** availability for a date 5 days or less away (same window as the existing 5-day cancel lock). Server (`POST /instructor/availability`) and calendar (`AvailabilityView`). Also block past dates on the server, which today only the screen blocks.
  3. Email requests are **not blocked**: Course Admin handles those. But an email request less than 7 days ahead is **held** on Email Requests (reason e.g. "Less than 7 days' notice"), not auto-created, so an admin sees it (owner 2026-10-20). Course Admin adding availability for an instructor is not limited.
  4. Cut-off: today + 7 is the first allowed date (Mon 20th → Mon 27th) (owner 2026-10-20).
  5. The portal form shows a message for sooner dates, e.g. "For courses within 7 days, email us at …" (owner 2026-10-20). **Parked (owner 2026-10-20):** which address to show. The login page's "Request a course" uses admin@kpbc.ca.
- [x] **Instructors pick several availability dates at once: done 2026-10-21** (`d8c03cc`, staging).
- [x] **Email Requests hint for an unrecognised course: done 2026-10-21** (`d8c03cc`, staging).
- [x] **Email requests without a student count are booked as TBC (0): done 2026-10-21** (`d8c03cc`, staging).
- [ ] **Where a student comes from, when added at class attendance (owner 2026-10-21; decided, ON HOLD until the owner says go).** When an instructor adds a student on Class Attendance, they pick: **same school** (the organization that booked the class), **another college** (from the Colleges list; the form already has an unused "College/School" dropdown saved to `course_students.college`), or **GTA CPR web student**. Decisions (owner 2026-10-21):
  1. Billing: only same-school students go on the booking school's invoice. Other-college and web students are listed on the class but not billed to the school; GTA CPR collects from them separately.
  2. Web students: for now the instructor types them in and ticks "GTA CPR web student". Linking to the website's enrolment system comes later (first find out which system it is).
  3. The booking school sees only its own students (roster, certificates, reports). Admin sees everyone.
- [ ] **Invoice workflow review (2026-10-21; ON HOLD, owner will come back to it).** Flow today: Ready for Billing → Create Invoice (amount fixed: students present × org price + HST; due in 30 days) → Pending Approvals → Approve or Reject → Organization Receivables → View → Post to Organization (shows in the org portal, emails the billing contact, archives the course). Findings:
  1. **Bug: an invoice created in the evening is dated the next day.** `BillingService.createInvoice` uses `CURRENT_DATE` (UTC). The UAT invoice was created 9:57 pm Toronto on Oct 21 and is dated Oct 22, due Nov 21. Fix: use `torontoToday()`.
  2. **Bug: the server lets an unapproved invoice be posted.** `postToOrg` doesn't check `approval_status = 'approved'`; only the screen hides the button. Fix: refuse unless approved.
  3. **Receivables doesn't show what's posted.** Approved-not-posted looks the same as posted (caught the owner in UAT). Suggested: a "Not posted" label and a Post button on the row.
  4. **The 30 days to pay start at creation, not when the org sees it.** Suggested: set invoice date and due date when posted.
  5. **A rejected invoice can't be fixed.** Resubmit sends the same amounts back, and the course stays invoiced so a corrected one can't be created. Suggested: rejecting cancels the invoice and returns the course to Ready for Billing (fix attendance or price, then create again).
  6. **Two ways to approve.** Opened from another accounting screen, a pending invoice shows "Approve & Post Invoice", skipping Pending Approvals. Suggested: remove the shortcut (or drop the separate steps), not both.
  7. **No warning when the org has no billing email.** The invoice posts but nobody is told the email wasn't sent (only a server log line). Suggested: show a warning to the accountant.
- [ ] **Issue certificates to students (2026-10-21; ON HOLD, owner will come back to it).** Today the app only records certificate dates: Complete Class gives each student marked present an issue date (class day) and an expiry date (course validity, 24 months on staging), shown in Certification Tracking, WSIB, the student detail dialog and the org roster CSV, with reminder emails at 90/60/30 days. Missing: no certificate document reaches the student; `course_students.certificate_number` is never set (screens and reminders show "N/A"); organizations can't see or download their students' certificates in the portal; no way to check a certificate is genuine.
  - **Proposed flow:** on Complete Class, give each attended student a certificate number (e.g. GTACPR-2026-000123); generate a certificate PDF (student, course, class date, expiry, instructor, number, GTA CPR branding); email it to the student and let the organization download it in the portal; optionally a public check page where anyone enters a number and sees whether it's valid (employers, WSIB). Backfill numbers for certificates already issued.
  - **Owner decisions:** the certificate's look and wording (template or logo?); who signs it (instructor, GTA CPR, or both); issue on completion or only once the invoice is paid; whether to have the public check page; whether the certifying body (e.g. Red Cross, Heart & Stroke) issues its own card, which would make ours a record only or unnecessary.
- [ ] **Email on/off preferences never work (found 2026-10-22).** The code reads and writes `notification_preferences.notification_type`, but the table's column is `type` (both databases; the table is empty). So every preference query fails and the code falls back to "send", and `PUT /notifications/preferences/:type` can't save. No screen sets preferences, so nobody is affected. Fix the column name in `CourseService.shouldSendEmail`, `routes/instructors.ts` (course completed email) and `routes/notifications.ts`, or drop the feature. Note: commit `e34b973`'s message says switching off now works; it doesn't until this is fixed.
- [ ] **WhatsApp messages to instructors (owner 2026-10-22; ON HOLD).** Step 1 is done: instructors get an email when booked, rescheduled, cancelled or taken off a class. Step 2 adds WhatsApp next to the email, through Meta's WhatsApp Business Platform (directly, or via Twilio).
  - **Owner tasks:** create the Meta Business (or Twilio) account and verify the business; get a phone number used only for this (not one already on the WhatsApp app); put the keys in the server settings yourself, never in chat.
  - **Build:** Meta-approved message templates (e.g. "Hi {name}, you've been booked for {course} on {date}, {time} at {location}. Check your schedule in the CPR portal."); store instructor mobile numbers in international format (+1…) and record their consent; send next to the email, and fall back to email only. Small per-message fee (a few cents each).
  - **Owner decisions:** which moments send a message (booked, rescheduled, cancelled, reminder the day before); Meta directly (cheaper, more setup) or Twilio (simpler, a little more per message); whether instructors opt in themselves in their Profile, or it's on for everyone with a mobile number.
- [ ] **Upload the class list while booking (owner 2026-10-22; agreed, not started).** Organizations can already upload a class list (CSV) after a course is booked (Organization portal, `CSVUploadDialog`). Add an optional "Upload class list" step to the booking form, using the same CSV format and checks. When a list is uploaded, the number of students fills in from it, and the list is attached to the request as soon as it's created. Booking without a list still works, and the list can be added or changed later as today. If the request is cancelled or declined, delete its uploaded students (privacy). Show any rows that fail the checks before the booking is sent.
- [ ] **Accept Excel class lists, not just CSV (owner 2026-10-22; agreed, not started).** Class lists can only be uploaded as .csv today (`CSVUploadDialog`, `accept=".csv"`), so organizations must "Save as CSV" from Excel first. Accept .xlsx (and .xls if easy) in both places a list is uploaded: after booking and in the booking form (item above). Read the file in the browser and turn it into the same rows the CSV path gives, so the server and its checks don't change and the host needs no new package. Use a maintained library (ExcelJS, or SheetJS's own current release, not the old "xlsx" on npm, which has known security problems). Rules: first sheet only, read values not formulas, skip blank rows, size limit, reject files that aren't real spreadsheets. Offer a downloadable Excel template with the right headings.
- [ ] **Invoice adjustment line (owner 2026-10-21; ON HOLD until the owner says go).** The Ready for Billing "View" stays read-only: the invoice is worked out from attendance and the organization's course price plus HST. For one-off changes (discount, waived fee, no-show not charged), add an "Adjustment": Accounting enters an amount and a reason, it is audited (who and when), and it shows on the invoice, the PDF and the organization's billing pages. HST applies to the adjusted subtotal.
- [ ] **Correcting attendance after a class (found 2026-10-21; needs a decision).** Nobody can fix attendance once a class is completed. The instructor's Class Attendance screen lists only today's classes that aren't completed, so an instructor who forgets on the day can't mark it later either. Course Admin's roster dialog (`AdminViewStudentsDialog`) is view-only, and there is no admin attendance endpoint. Today the only fix is a direct database change. Suggested: Course Admin can mark present or absent (and add a missing student) on a completed class until it is invoiced, audited, and certificates follow automatically. After invoicing, use the adjustment line above. Also decide whether instructors can mark attendance for an earlier day that wasn't completed.
- [ ] **Public web enrolment for GTA CPR students (advised 2026-10-21; ON HOLD until the owner says go).** Build it into this app, not a separate booking system (WordPress plugin, Eventbrite, Shopify): one list of students and classes, no syncing. The GTA CPR website (still a draft, stagegtacpr.kpbc.ca) only links to it with a "Book now" button. Web students land on the class roster as "GTA CPR web student", so attendance, certificates, reminders and reports work unchanged. Ties in with the item above.
  - **Step 1, public booking, paid offline:** admin marks a class open to the public with public seats and a price; a public "Book a CPR course" page lists those classes (date, place, price, seats left); the student enters name, email, phone and accepts the terms; they go on the roster and get a confirmation email; they pay by e-transfer or at the door and admin ticks "paid".
  - **Step 2, online card payment:** Stripe Checkout or Square, so card numbers never touch our server; the seat is confirmed only once the payment goes through.
  - **Owner decisions before Step 1:** (1) who can open a class to the public (admin only, or instructors too); (2) price per course type or per class; (3) payment for now: e-transfer, at the door, or both; (4) cancellation and refund rules (e.g. full refund up to 48 hours before); (5) any waiver or health questions to tick; (6) the From address for confirmation emails, and who gets a copy of each booking.
  - **Owner tasks for Step 2:** open a Stripe or Square account in GTA CPR's name; update the privacy policy to list the payment company.
- [x] **Certificate dates are never set for new classes: fixed 2026-10-21** (staging). Complete Class now issues certificates to attended students, dated the class day and expiring after the course's validity period; changing a course's validity re-dates its completed classes; migration 30 backfilled. Owner set every staging course to 24 months (backup `~/private/staging-class_types-before-validity-20261022-0104.sql`); **production courses still have no validity set.**
- [x] **Certificate expiry flipped about 4 hours early: fixed 2026-10-21** (`68d9935`, staging). Expiry checks count Toronto days (`torontoTodaySql`); removed roster students are left out of certificate lists, counts and reminders. Still open: the WSIB report still includes removed students, and its "valid" filter also returns certificates its status column calls "expiring".
- [ ] **Drop `token_blacklist_legacy_20261017`** once migration 26 has run everywhere and nothing reads it (old, empty, replaced 2026-10-18).
- [x] **Colleges admin screen (done 2026-10-18, `fa90aa7`).** Sysadmin → Colleges: add, rename, hide/show, delete, all audited.
- [x] **Profile changes can't be submitted (removed (option B), 2026-10-18).** HR had a screen to approve profile changes, but nothing in the app let anyone submit one (`POST /profile-changes` had no caller), so the list was always empty. The HR approval screen, its endpoints (`/profile-changes`, `/hr/profile-changes*`) and the dashboard's Pending Approvals/Recent Activity were removed. People still edit their own details directly. The `profile_changes` table stays (old rows are still scrubbed by the personal-data erase).
- [x] **No browser test showed real payroll values (done 2026-10-18, `7e0ec7e`).** A read-only E2E now runs HR → Payroll → Calculate for the test instructor and checks the totals add up. Writing it found and fixed three bugs: Calculate ignored the instructor's own pay rate (flat $50 bonus), "Period" showed Invalid Date, and errors were swallowed.
- [ ] **Create payroll payments (for later).** Nothing in the app creates a `payroll_payments` row any more: the manual `POST /payroll/payments` was removed in Round 5d. HR can calculate pay and process payments, but there is never a payment to process. Decide how a payment should be created (for example a "Create payment from this calculation" button on HR → Payroll → Calculate, with audit), then build it with a test that creates → processes a payment. Ties in with the instructor payment requests item below.
- [x] **Public-page audit leftovers (done 2026-10-18).** Legal pages' Back uses history (`8b2bf70`); "Request a course" email link on login; og/twitter link-preview tags; signed-out visitors at `/` now reach login instead of an endless spinner (`656eadf`); react-router 6.30 → 7.18.4, closing two moderate advisories (`a365912`).
- [ ] **Instructor payment requests (Payment Requests / Payment History).** These are hidden for now; the screens are kept but have no backend. Build them as a separate project if Accounting should approve instructor pay.

## 🟢 Features (unchanged from before; not started)

- Real-time dashboards (WebSocket/SSE; the unused `/events` stream was removed 2026-10-17); predictive analytics
- OCR receipt scanning (OCR-1; the vendor UI button was removed until this exists)
- SMS notifications; calendar sync; document management; online payments; recurring courses
- LMS evaluation capture; student marketing emails (needs PIPEDA consent flow)
- Offline support; push notifications; i18n
- Cookie consent banner (only if analytics/tracking is added); signup consent checkbox (only if self-signup is added)

## ✅ Done (2026-09-17/18, see git history and the action plan)

Security hardening (admin→sysadmin escalation, vendor invoice IDOR, XSS escaping, trustProxy, Swagger hidden in prod, dependency CVEs) · password reset built · sysadmin/org navigation fixed · 44 broken API calls fixed · 101 dead frontend files and 10 unused packages removed · ESLint/type-checked builds/npm audit/E2E in CI · husky pre-commit · CI deploys staging and production and restarts them · self-contained backend bundle · MySQL-8-compatible guarded migrations with a startup lock · indexes · duplicate-safe cert reminders · rotated refresh tokens and real logout · compression and asset caching · mock data removed · change-password for all roles · confirmations on destructive actions · double-submit guards · one currency/date/tax formatter · UTC date-shift fix · HR/SuperAdmin URL routes · Add Instructor, Delete Organization, org locations, download-my-data endpoints · docs regenerated from the route table.
