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

- [ ] **Server-side pagination on every list endpoint (4.9)**: `paginatedQuery` is used in 7 places; users, vendors, students, org courses/invoices, vendor invoices, AR and history still return every row. Frontend `DataTable` already supports paging.
- [ ] **`admin.ts` multi-statement writes without transactions (4.10)**; wrap org create + locations, config updates.
- [ ] **Promote lint warnings to errors as counts fall**: backend 411 warnings (`no-explicit-any`), frontend ~720 (`no-explicit-any`, `no-unused-vars`, react-hooks rules incl. hooks inside try/catch in `InvoiceUpload.tsx` / `AccountingDashboard.tsx`).
- [ ] **Remaining native `alert()`/local Snackbars** in `PaymentVerificationView.tsx`; vendor `InvoiceHistory` fabricated approver name.
- [ ] **Memoise the other context providers** (Notification, Toast, Network) and replace `SessionWarning`'s 1-second interval with a scheduled timeout.
- [ ] **Move remaining `import * as api` (9 files) to named imports** for tree-shaking.
- [ ] **Bundle more backend packages**: `backend/build.mjs` still treats long-installed packages as external (host `node_modules` is stale). Shrink `EXTERNAL` once each is verified to bundle cleanly, then the host needs no `node_modules` at all.
- [ ] **E2E flakiness on the shared host**: one dashboard check occasionally needs a retry; consider a second `retries` only for the "dashboard loads" tests.
- [ ] **Test coverage**: route tests exist only for guards; add `app.inject` tests for billing lifecycle, org-billing, vendors; portal tests exist for 5 of 8 portals.
- [ ] **Tax rate at runtime**: backend reads `system_config`; frontend uses build-time `VITE_HST_RATE` (default 0.13). Expose the rate via an endpoint so both agree if it ever changes.
- [ ] **Data retention enforcement**: policy is documented; scheduled anonymisation of accounts closed 2+ years is not implemented.
- [ ] **CI action Node runtime**: `SamKirkland/FTP-Deploy-Action@v4.3.5` and `actions/*-artifact@v5` still target Node 20 (GitHub forces 24); update when new releases target 22+.

## 🟢 Features (unchanged from before; not started)

- Real-time dashboards (WebSocket/SSE beyond the current `/events` stream); predictive analytics
- OCR receipt scanning (OCR-1; the vendor UI button was removed until this exists)
- SMS notifications; calendar sync; document management; online payments; recurring courses
- LMS evaluation capture; student marketing emails (needs PIPEDA consent flow)
- Offline support; push notifications; i18n
- Cookie consent banner (only if analytics/tracking is added); signup consent checkbox (only if self-signup is added)

## ✅ Done (2026-09-17/18, see git history and the action plan)

Security hardening (admin→sysadmin escalation, vendor invoice IDOR, XSS escaping, trustProxy, Swagger hidden in prod, dependency CVEs) · password reset built · sysadmin/org navigation fixed · 44 broken API calls fixed · 101 dead frontend files and 10 unused packages removed · ESLint/type-checked builds/npm audit/E2E in CI · husky pre-commit · CI deploys staging and production and restarts them (server crons retired) · self-contained backend bundle · MySQL-8-compatible guarded migrations with a startup lock · indexes · duplicate-safe cert reminders · rotated refresh tokens and real logout · compression and asset caching · mock data removed · change-password for all roles · confirmations on destructive actions · double-submit guards · one currency/date/tax formatter · UTC date-shift fix · HR/SuperAdmin URL routes · Add Instructor, Delete Organization, org locations, download-my-data endpoints · docs regenerated from the route table.
