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

## 🟢 Features (unchanged from before; not started)

- Real-time dashboards (WebSocket/SSE beyond the current `/events` stream); predictive analytics
- OCR receipt scanning (OCR-1; the vendor UI button was removed until this exists)
- SMS notifications; calendar sync; document management; online payments; recurring courses
- LMS evaluation capture; student marketing emails (needs PIPEDA consent flow)
- Offline support; push notifications; i18n
- Cookie consent banner (only if analytics/tracking is added); signup consent checkbox (only if self-signup is added)

## ✅ Done (2026-09-17/18, see git history and the action plan)

Security hardening (admin→sysadmin escalation, vendor invoice IDOR, XSS escaping, trustProxy, Swagger hidden in prod, dependency CVEs) · password reset built · sysadmin/org navigation fixed · 44 broken API calls fixed · 101 dead frontend files and 10 unused packages removed · ESLint/type-checked builds/npm audit/E2E in CI · husky pre-commit · CI deploys staging and production and restarts them · self-contained backend bundle · MySQL-8-compatible guarded migrations with a startup lock · indexes · duplicate-safe cert reminders · rotated refresh tokens and real logout · compression and asset caching · mock data removed · change-password for all roles · confirmations on destructive actions · double-submit guards · one currency/date/tax formatter · UTC date-shift fix · HR/SuperAdmin URL routes · Add Instructor, Delete Organization, org locations, download-my-data endpoints · docs regenerated from the route table.
