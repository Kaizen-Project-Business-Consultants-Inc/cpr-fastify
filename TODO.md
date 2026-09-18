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

Most of this section was cleared on 2026-09-18. What remains is listed first; the
completed items are kept at the bottom of the section for traceability.

- [ ] **Vendor-invoice summary endpoint (new, found 2026-09-18)**: the four vendor-invoice
  screens are paginated, but three of them fetch the full matching list a second time just
  to sum money, and the approvals screen issues six `limit=1` probes to count by status —
  because no aggregate endpoint exists. Add `GET /admin/vendor-invoices/summary` and
  `GET /accounting/vendor-invoices/summary` returning counts by status plus total/paid/
  outstanding sums (honouring the same `search` filter), then point the stat cards at it.
  Until then paging saves rendering, not bytes, on those screens.
- [ ] **`GET /accounting/invoices` ignores the opt-in pagination rule**: it paginates even
  with no `page`/`limit`, so any caller that sends no params silently gets the first 25.
  `TransactionHistoryView` was doing exactly that and computing totals over a truncated
  set (fixed by making it page explicitly). Either make the endpoint opt-in like the rest,
  or sweep the remaining callers of `api.getInvoices()` that pass no params.
- [ ] **Native dialogs in `hr/ReturnedPaymentRequests.tsx`**: two `window.confirm`/`alert`
  calls remain; replace with `useConfirm` / `useSnackbar` like the rest of the app.
- [ ] **Move remaining `import * as api` (13 files) to named imports** for tree-shaking —
  `services/api.ts` is large and the namespace import pulls it into every portal chunk.
- [ ] **E2E flakiness on the shared host**: a dashboard check occasionally needs a retry;
  consider extra `retries` scoped to the "dashboard loads" tests only.
- [ ] **Backend route tests**: guard coverage exists (`routes.guards.test.ts`); add
  `app.inject` tests for the billing lifecycle, org-billing and vendor flows.
- [ ] **CI action Node runtime**: `SamKirkland/FTP-Deploy-Action@v4.3.5` and
  `actions/*-artifact@v5` still target Node 20 (GitHub forces 24); update when new
  releases target 22+.

### Cleared 2026-09-18
Server-side pagination (20 screens, opt-in `?page`/`limit` contract so unpaginated callers
are unchanged) · transactions around every multi-step write in `admin.ts` and
`instructors.ts` · PIPEDA retention job (dry-run by default, `RETENTION_ENFORCE=true` to
act) · tax rate served from `GET /config` and applied at app start · backend bundling
(host packages 18 → 5, only `pdfkit` needed in production) · vendor PDFs mirrored to
object storage at upload time · context providers memoised and `SessionWarning`'s
per-second timer replaced · native dialogs and fabricated values removed from the
accounting and vendor screens · portal tests for all 8 portals · backend `no-explicit-any`
0 and promoted to `error`.

## 🟢 Features (unchanged from before; not started)

- Real-time dashboards (WebSocket/SSE beyond the current `/events` stream); predictive analytics
- OCR receipt scanning (OCR-1; the vendor UI button was removed until this exists)
- SMS notifications; calendar sync; document management; online payments; recurring courses
- LMS evaluation capture; student marketing emails (needs PIPEDA consent flow)
- Offline support; push notifications; i18n
- Cookie consent banner (only if analytics/tracking is added); signup consent checkbox (only if self-signup is added)

## ✅ Done (2026-09-17/18, see git history and the action plan)

Security hardening (admin→sysadmin escalation, vendor invoice IDOR, XSS escaping, trustProxy, Swagger hidden in prod, dependency CVEs) · password reset built · sysadmin/org navigation fixed · 44 broken API calls fixed · 101 dead frontend files and 10 unused packages removed · ESLint/type-checked builds/npm audit/E2E in CI · husky pre-commit · CI deploys staging and production and restarts them · self-contained backend bundle · MySQL-8-compatible guarded migrations with a startup lock · indexes · duplicate-safe cert reminders · rotated refresh tokens and real logout · compression and asset caching · mock data removed · change-password for all roles · confirmations on destructive actions · double-submit guards · one currency/date/tax formatter · UTC date-shift fix · HR/SuperAdmin URL routes · Add Instructor, Delete Organization, org locations, download-my-data endpoints · docs regenerated from the route table.
