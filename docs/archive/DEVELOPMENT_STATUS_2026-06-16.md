# CPR Training Management System — Development Status

**Date**: 2026-06-16
**Session**: Certification expiry tracking + student directory
**Repo**: https://github.com/Kaizenpbc/cpr-fastify
**Production**: https://cpr.kpbc.ca
**Staging**: https://stagecprapp.kpbc.ca

---

## Completed This Session

### 1. Auth Fix (Critical)
- **Problem**: All Bearer token requests returned 401 on production + staging
- **Root cause**: `token_blacklist` table missing `invalidated_at` column; `isTokenBlacklisted()` threw DB error caught by generic catch in `requireAuth`
- **Fix**: Migration v4 adds column; `requireAuth` separates JWT errors from blacklist DB errors (fail-open on DB error)
- **Deployed**: Both environments

### 2. Students Master Table
- Migration v5: `students` table (email unique, org FK, marketing consent, timestamps)
- Migration v6: `course_students.student_id` FK to students
- Migration v7: Backfill — groups existing course_students by email, creates master records, links
- **Write-through**: Roster upload (org + instructor paths) auto-creates/links master student records
- `StudentRepository`: findOrCreate, findOrCreateBulk, search, getCourseHistory, updateMarketingConsent
- 9 unit tests
- **Deployed**: Both environments

### 3. Student Directory (Sysadmin Portal)
- **Backend**: 4 endpoints in admin.ts — `GET/PUT /sysadmin/students`, `GET/PUT /sysadmin/students/:id`, `PUT /sysadmin/students/:id/consent`
- **Frontend**: `StudentManagement.tsx` — debounced search, table (name, email, phone, org, course count, last course, marketing consent), course history dialog, edit dialog, consent toggle
- **API**: `sysAdminApi` methods in api.ts
- **Portal**: Wired into SystemAdminPortal with menu item + route at `/sysadmin/students`
- **Deployed**: Both environments

### 4. Certification Expiry Tracking
- Migration v8: `class_types.certification_validity_months` (per course type, e.g., CPR = 24 months)
- Migration v9: `course_students.certificate_number`, `certificate_issued_at`, `certificate_expires_at` + index
- Migration v10: Backfill — auto-populates cert dates for attended students in completed courses with validity period
- **Auto-populate**: Instructor attendance toggle sets cert dates (or clears on un-attend)
- **Backend endpoints**:
  - `GET /sysadmin/certifications/expiring?days=N` — certs expiring within N days
  - `GET /sysadmin/certifications/expired` — already-expired certs
  - `GET /sysadmin/certifications/stats` — counts (active, expiring 30d/90d, expired)
- Course CRUD (GET/POST/PUT `/sysadmin/courses`) now includes `certification_validity_months`
- **Frontend**: `CertificationTracking.tsx` — stats cards, expiring/expired toggle, time window filter (30/60/90/180 days), color-coded expiry chips
- **StudentManagement** course history dialog now shows "Cert Status" column (Active/Expiring/Expired)
- **CourseManagement** form now maps `validityPeriodMonths` → `certification_validity_months` in DB
- **Portal**: Wired into SystemAdminPortal at `/sysadmin/certifications`
- **Deployed**: Both environments

### 5. Invoice Number Sequences (from prior session, verified this session)
- `InvoiceNumberService` with atomic `SELECT FOR UPDATE` allocation
- Format tokens, reset policies, admin CRUD, preview endpoint
- Migration v3, 14 unit tests
- **Deployed**: Both environments

---

## Action Required

### Set Certification Validity on Course Types
The migrations add the column but don't set values. To see cert data:
1. Log in as sysadmin → Course Management
2. Edit each course type and set "Validity Period (Months)" — e.g.:
   - CPR Level C → 24 months
   - Standard First Aid → 36 months
   - BLS → 12 months
3. The backfill migration (v10) only populates certs for course types that already have a validity period set at migration time. After setting values, you can re-run the backfill logic by marking and unmarking attendance on existing records, or a manual SQL update.

---

## Current Test Results
- **Backend (vitest)**: 87 tests, 6 suites — all passing
  - AuthService (11), BillingService (16), HRService (12), BillingLifecycle (25), InvoiceNumberService (14), StudentRepository (9)
- **Frontend (tsc)**: Only pre-existing errors (react-dropzone types, jest namespace)
- **E2E (Playwright)**: 36/36 passing (last run 2026-06-15)

---

## Sysadmin Portal Menu (current order)
1. System Dashboard
2. Course Management
3. Organization Management
4. Organization Pricing
5. User Management
6. Vendor Management
7. **Student Directory** ← NEW
8. **Certification Tracking** ← NEW
9. System Configuration

---

## Migration History (v1–v10)
| Version | Name | Type |
|---------|------|------|
| 1 | create_login_attempts | SQL |
| 2 | create_token_blacklist | SQL |
| 3 | create_invoice_number_sequences | SQL |
| 4 | fix_token_blacklist_add_invalidated_at | SQL |
| 5 | create_students_master | SQL |
| 6 | add_student_id_to_course_students | SQL |
| 7 | backfill_students_master | Function |
| 8 | add_certification_expiry_tracking | SQL |
| 9 | add_certificate_fields_to_course_students | SQL |
| 10 | backfill_certificate_dates | Function |

---

## What's Next (from TODO.md)

### Red — Must-do before first paying customer
- **LEGAL-2**: Customer MSA / contract
- **LEGAL-3**: PIPEDA breach notification SOP
- **BIZ-1**: SaaS pricing & billing model
- **BIZ-2**: Offboarding / cancellation policy
- **HOSTING-1**: VPS upgrade plan
- **BACKUP-2**: Offsite database backups

### Yellow — High-value code work
- **BIZ-5**: Data export for customers (CSV/PDF per portal) — PIPEDA portability
- **WSIB reporting**: Training history report UI/export (data model complete)
- **Student marketing emails**: Renewal reminders using consent + cert expiry data
- **ONBOARD-1**: Document manual customer onboarding process

### Deploy Notes
- Frontend must be built locally (server OOM on vite)
- Upload via cPanel `Fileman/upload_files` API with `overwrite=1` parameter
- Backend auto-deploys hourly (staging :18, production :48) or force-deploy via one-time cron
- Always clean up one-time crons after deploy

---

## Files Changed This Session

### Backend
- `backend/src/config/migrations.ts` — v4–v10
- `backend/src/repositories/StudentRepository.ts` — new file, getCourseHistory updated with cert fields
- `backend/src/repositories/CourseStudentRepository.ts` — write-through with student_id
- `backend/src/routes/admin.ts` — student CRUD, cert endpoints, course type cert field
- `backend/src/routes/instructors.ts` — attendance auto-populates cert dates
- `backend/src/services/CourseService.ts` — passes orgId for write-through
- `backend/src/plugins/auth.ts` — separated JWT errors from blacklist DB errors
- `backend/src/__tests__/StudentRepository.test.ts` — 9 tests

### Frontend
- `frontend/src/services/api.ts` — sysAdminApi: student + cert methods
- `frontend/src/components/sysadmin/StudentManagement.tsx` — new file, cert status in history
- `frontend/src/components/sysadmin/CertificationTracking.tsx` — new file
- `frontend/src/components/sysadmin/CourseManagement.tsx` — cert validity field mapping
- `frontend/src/components/portals/SystemAdminPortal.tsx` — menu items + routes

### Commits (on master)
1. `fix: auth 401 caused by missing invalidated_at column in token_blacklist`
2. `feat: students master table with write-through on roster upload`
3. `feat: admin student directory — search, view history, update, consent`
4. `feat: add Student Directory page to sysadmin portal`
5. `feat: certification expiry tracking with auto-populate and sysadmin dashboard`
