# API Reference

_Generated from the route table by `npm run docs:api` (backend/scripts/generate-api-docs.ts). Do not edit by hand — CI fails if this file is stale._

Base URL: `/api/v1` (except the two root-level health/metrics endpoints).
Auth: send the access token as `Authorization: Bearer <token>`. Role guards are enforced per route (`requireRole`); see the route file for the exact roles.

**263 endpoints across 28 groups.**

## Accounting

Billing — invoices, pricing, payments, reports

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/accounting/aging-report` | Bearer |  |
| GET | `/accounting/billing-queue` | Bearer |  |
| GET | `/accounting/course-pricing` | Bearer |  |
| POST | `/accounting/course-pricing` | Bearer |  |
| PUT | `/accounting/course-pricing/{id}` | Bearer |  |
| DELETE | `/accounting/course-pricing/{id}` | Bearer |  |
| GET | `/accounting/course-types` | Bearer |  |
| GET | `/accounting/dashboard` | Bearer |  |
| GET | `/accounting/invoice-sequences` | Bearer |  |
| PUT | `/accounting/invoice-sequences` | Bearer |  |
| GET | `/accounting/invoice-sequences/{orgId}` | Bearer |  |
| DELETE | `/accounting/invoice-sequences/{orgId}` | Bearer |  |
| GET | `/accounting/invoice-sequences/{orgId}/preview` | Bearer |  |
| GET | `/accounting/invoices` | Bearer |  |
| POST | `/accounting/invoices` | Bearer |  |
| GET | `/accounting/invoices/{id}` | Bearer |  |
| PUT | `/accounting/invoices/{id}/approval` | Bearer |  |
| PUT | `/accounting/invoices/{id}/fix-calculations` | Bearer |  |
| GET | `/accounting/invoices/{id}/payments` | Bearer |  |
| POST | `/accounting/invoices/{id}/payments` | Bearer |  |
| GET | `/accounting/invoices/{id}/pdf` | Bearer |  |
| PUT | `/accounting/invoices/{id}/post-to-org` | Bearer |  |
| GET | `/accounting/invoices/{id}/preview` | Bearer |  |
| PUT | `/accounting/invoices/{id}/resubmit` | Bearer |  |
| GET | `/accounting/invoices/export/csv` | Bearer |  |
| GET | `/accounting/invoices/pending-approval` | Bearer |  |
| GET | `/accounting/invoices/rejected` | Bearer |  |
| GET | `/accounting/organizations` | Bearer |  |
| GET | `/accounting/payment-verifications` | Bearer |  |
| POST | `/accounting/payments/{id}/reverse` | Bearer |  |
| POST | `/accounting/payments/{id}/verify` | Bearer |  |
| GET | `/accounting/reports/ar-aging` | Bearer |  |
| GET | `/accounting/reports/revenue` | Bearer |  |
| GET | `/accounting/vendor-invoices` | Bearer |  |
| GET | `/accounting/vendor-invoices/{id}` | Bearer |  |
| POST | `/accounting/vendor-invoices/{id}/payments` | Bearer |  |
| POST | `/accounting/vendor-invoices/{id}/reject` | Bearer |  |
| GET | `/accounting/vendor-payments` | Bearer |  |
| GET | `/accounting/verified-payments` | Bearer |  |

## Admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/admin/vendor-invoices` | Bearer |  |
| POST | `/admin/vendor-invoices/{id}/approve` | Bearer |  |
| PUT | `/admin/vendor-invoices/{id}/notes` | Bearer |  |
| GET | `/admin/vendor-invoices/ready-for-processing` | Bearer |  |

## Auth

Authentication — login, refresh, logout, password change

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/change-password` | Bearer |  |
| POST | `/auth/forgot-password` | No |  |
| POST | `/auth/login` | No |  |
| POST | `/auth/logout` | No |  |
| GET | `/auth/me` | Bearer |  |
| GET | `/auth/my-data` | Bearer |  |
| POST | `/auth/recover-password` | No |  |
| POST | `/auth/refresh` | No |  |
| POST | `/auth/reset-password` | No |  |

## Classes

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/classes` | Bearer |  |

## Client Errors

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/client-errors` | No |  |

## Colleges

College/institution management

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/colleges/` | Bearer |  |
| POST | `/colleges/` | Bearer |  |
| PUT | `/colleges/{id}` | Bearer |  |
| DELETE | `/colleges/{id}` | Bearer |  |
| GET | `/colleges/all` | Bearer |  |

## Course Types

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/course-types` | Bearer |  |

## Courseadmin

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/courseadmin/courses/{id}/schedule` | Bearer |  |
| GET | `/courseadmin/instructors` | Bearer |  |

## Courses

Course requests — org submission, admin scheduling, instructor assignment

| Method | Path | Auth | Notes |
|---|---|---|---|
| PUT | `/courses/{id}/assign-instructor` | Bearer |  |
| PUT | `/courses/{id}/cancel` | Bearer |  |
| PUT | `/courses/{id}/ready-for-billing` | Bearer |  |
| PUT | `/courses/{id}/schedule` | Bearer |  |
| GET | `/courses/{id}/students` | Bearer |  |
| POST | `/courses/{id}/update-reminder` | Bearer |  |
| GET | `/courses/{id}/validate-billing` | Bearer |  |
| GET | `/courses/cancelled` | Bearer |  |
| GET | `/courses/completed` | Bearer |  |
| GET | `/courses/confirmed` | Bearer |  |
| GET | `/courses/org/students/{courseId}` | Bearer |  |
| POST | `/courses/org/students/{courseId}` | Bearer |  |
| GET | `/courses/pending` | Bearer |  |
| POST | `/courses/request` | Bearer |  |

## Dashboard

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/dashboard` | Bearer |  |

## Email Templates

Email template CRUD, preview, test send

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/email-templates/` | Bearer |  |
| POST | `/email-templates/` | Bearer |  |
| GET | `/email-templates/{id}` | Bearer |  |
| PUT | `/email-templates/{id}` | Bearer |  |
| DELETE | `/email-templates/{id}` | Bearer |  |
| POST | `/email-templates/{id}/clone` | Bearer |  |
| POST | `/email-templates/{id}/preview` | Bearer |  |
| POST | `/email-templates/{id}/test-send` | Bearer |  |
| GET | `/email-templates/meta/event-triggers` | Bearer |  |
| GET | `/email-templates/meta/variables` | Bearer |  |
| GET | `/email-templates/status` | Bearer |  |

## Events

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/events` | Bearer |  |

## Health

Health check and system status

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | No | Liveness + DB check (root, outside /api/v1) |
| GET | `/health/` | Bearer |  |
| GET | `/metrics` | No | Request counts, error rate, latency (root, outside /api/v1) |

## Hr

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/hr/dashboard` | Bearer |  |
| GET | `/hr/instructors` | Bearer |  |
| GET | `/hr/organizations` | Bearer |  |
| GET | `/hr/profile-changes` | Bearer |  |
| POST | `/hr/profile-changes/{changeId}/approve` | Bearer |  |
| GET | `/hr/returned-payment-requests` | Bearer |  |
| POST | `/hr/returned-payment-requests/{requestId}/process` | Bearer |  |
| GET | `/hr/user/{userId}` | Bearer |  |

## Instructor

Instructor portal — classes, availability, attendance, profile

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/instructor/attendance` | Bearer |  |
| GET | `/instructor/availability` | Bearer |  |
| POST | `/instructor/availability` | Bearer |  |
| PUT | `/instructor/availability` | Bearer |  |
| DELETE | `/instructor/availability/{date}` | Bearer |  |
| GET | `/instructor/classes` | Bearer |  |
| GET | `/instructor/classes/{classId}` | Bearer |  |
| POST | `/instructor/classes/{classId}/complete` | Bearer |  |
| GET | `/instructor/classes/{classId}/students` | Bearer |  |
| POST | `/instructor/classes/{classId}/students` | Bearer |  |
| PUT | `/instructor/classes/{classId}/students/{studentId}/attendance` | Bearer |  |
| GET | `/instructor/classes/active` | Bearer |  |
| GET | `/instructor/classes/completed` | Bearer |  |
| GET | `/instructor/classes/today` | Bearer |  |
| GET | `/instructor/dashboard/stats` | Bearer |  |
| GET | `/instructor/profile` | Bearer |  |
| PUT | `/instructor/profile` | Bearer |  |
| GET | `/instructor/schedule` | Bearer |  |

## Instructors

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/instructors` | Bearer |  |
| POST | `/instructors` | Bearer |  |
| PUT | `/instructors/{id}` | Bearer |  |
| DELETE | `/instructors/{id}` | Bearer |  |
| GET | `/instructors/{id}/availability` | Bearer |  |
| PUT | `/instructors/{id}/availability` | Bearer |  |
| DELETE | `/instructors/{id}/availability/{date}` | Bearer |  |
| GET | `/instructors/{id}/schedule` | Bearer |  |
| GET | `/instructors/available/{date}` | Bearer |  |

## Invoices

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/invoices/{id}/calculate-balance` | Bearer |  |
| GET | `/invoices/{id}/pdf` | Bearer |  |
| GET | `/invoices/{id}/preview` | Bearer |  |

## Notifications

User notification preferences and history

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications/` | Bearer |  |
| DELETE | `/notifications/{id}` | Bearer |  |
| POST | `/notifications/{id}/read` | Bearer |  |
| POST | `/notifications/mark-all-read` | Bearer |  |
| GET | `/notifications/preferences` | Bearer |  |
| PUT | `/notifications/preferences/{type}` | Bearer |  |
| GET | `/notifications/unread-count` | Bearer |  |

## Organization

Organization portal — profile, courses, billing, archives

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/organization/{id}` | Bearer |  |
| PUT | `/organization/{id}` | Bearer |  |
| GET | `/organization/archive` | Bearer |  |
| GET | `/organization/billing-summary` | Bearer |  |
| POST | `/organization/course-request` | Bearer |  |
| GET | `/organization/courses` | Bearer |  |
| GET | `/organization/courses/export/csv` | Bearer |  |
| GET | `/organization/dashboard` | Bearer |  |
| GET | `/organization/invoices` | Bearer |  |
| GET | `/organization/invoices/{id}` | Bearer |  |
| GET | `/organization/invoices/{id}/balance-calculation` | Bearer |  |
| POST | `/organization/invoices/{id}/mark-as-paid` | Bearer |  |
| POST | `/organization/invoices/{id}/payment-submission` | Bearer |  |
| GET | `/organization/invoices/{id}/payments` | Bearer |  |
| GET | `/organization/invoices/export/csv` | Bearer |  |
| GET | `/organization/paid-invoices` | Bearer |  |
| GET | `/organization/paid-invoices-summary` | Bearer |  |
| GET | `/organization/payment-summary` | Bearer |  |
| GET | `/organization/profile` | Bearer |  |
| PUT | `/organization/profile` | Bearer |  |
| GET | `/organization/roster/export/csv` | Bearer |  |

## Organization Pricing

Per-organization course pricing configuration

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/organization-pricing/admin` | Bearer |  |
| POST | `/organization-pricing/admin` | Bearer |  |
| GET | `/organization-pricing/admin/{id}` | Bearer |  |
| PUT | `/organization-pricing/admin/{id}` | Bearer |  |
| DELETE | `/organization-pricing/admin/{id}` | Bearer |  |
| POST | `/organization-pricing/calculate-cost` | Bearer |  |
| GET | `/organization-pricing/course-pricing/{organizationId}/{classTypeId}` | Bearer |  |
| GET | `/organization-pricing/organization/{organizationId}` | Bearer |  |

## Pay Rates

Instructor pay rate tiers and assignments

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/pay-rates/bulk-update` | Bearer |  |
| GET | `/pay-rates/instructors` | Bearer |  |
| GET | `/pay-rates/instructors/{instructorId}` | Bearer |  |
| POST | `/pay-rates/instructors/{instructorId}` | Bearer |  |
| GET | `/pay-rates/instructors/{instructorId}/current` | Bearer |  |
| GET | `/pay-rates/tiers` | Bearer |  |
| POST | `/pay-rates/tiers` | Bearer |  |
| PUT | `/pay-rates/tiers/{id}` | Bearer |  |

## Payments

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/payments/{id}/receipt` | Bearer |  |

## Payroll

Payroll calculation, payment processing, reports

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/payroll/calculate/{instructorId}` | Bearer |  |
| GET | `/payroll/instructor/{instructorId}/summary` | Bearer |  |
| GET | `/payroll/payments` | Bearer |  |
| POST | `/payroll/payments` | Bearer |  |
| GET | `/payroll/payments/{paymentId}` | Bearer |  |
| POST | `/payroll/payments/{paymentId}/process` | Bearer |  |
| GET | `/payroll/report` | Bearer |  |
| GET | `/payroll/stats` | Bearer |  |

## Profile Changes

User profile change requests and HR approval

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/profile-changes/` | Bearer |  |
| POST | `/profile-changes/` | Bearer |  |

## Student

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/student/classes` | Bearer |  |
| GET | `/student/completed-classes` | Bearer |  |
| GET | `/student/enrollments` | Bearer |  |
| GET | `/student/profile` | Bearer |  |
| PUT | `/student/profile` | Bearer |  |
| GET | `/student/upcoming-classes` | Bearer |  |

## Sysadmin

System administration — users, organizations, course types, vendors, config

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/sysadmin/audit-logs` | Bearer |  |
| GET | `/sysadmin/audit-logs/export/csv` | Bearer |  |
| GET | `/sysadmin/audit-logs/stats` | Bearer |  |
| GET | `/sysadmin/certifications/expired` | Bearer |  |
| GET | `/sysadmin/certifications/expiring` | Bearer |  |
| GET | `/sysadmin/certifications/expiring/export/csv` | Bearer |  |
| POST | `/sysadmin/certifications/send-reminders` | Bearer |  |
| GET | `/sysadmin/certifications/stats` | Bearer |  |
| GET | `/sysadmin/configurations` | Bearer |  |
| GET | `/sysadmin/configurations/{key}` | Bearer |  |
| PUT | `/sysadmin/configurations/{key}` | Bearer |  |
| GET | `/sysadmin/configurations/categories` | Bearer |  |
| GET | `/sysadmin/configurations/category/{category}` | Bearer |  |
| GET | `/sysadmin/courses` | Bearer |  |
| POST | `/sysadmin/courses` | Bearer |  |
| PUT | `/sysadmin/courses/{id}` | Bearer |  |
| DELETE | `/sysadmin/courses/{id}` | Bearer |  |
| PUT | `/sysadmin/courses/{id}/toggle-active` | Bearer |  |
| GET | `/sysadmin/dashboard` | Bearer |  |
| GET | `/sysadmin/instructors` | Bearer |  |
| GET | `/sysadmin/organizations` | Bearer |  |
| POST | `/sysadmin/organizations` | Bearer |  |
| PUT | `/sysadmin/organizations/{id}` | Bearer |  |
| DELETE | `/sysadmin/organizations/{id}` | Bearer |  |
| GET | `/sysadmin/organizations/{orgId}/locations` | Bearer |  |
| POST | `/sysadmin/organizations/{orgId}/locations` | Bearer |  |
| PUT | `/sysadmin/organizations/{orgId}/locations/{locationId}` | Bearer |  |
| DELETE | `/sysadmin/organizations/{orgId}/locations/{locationId}` | Bearer |  |
| GET | `/sysadmin/organizations/export/csv` | Bearer |  |
| GET | `/sysadmin/students` | Bearer |  |
| GET | `/sysadmin/students/{id}` | Bearer |  |
| PUT | `/sysadmin/students/{id}` | Bearer |  |
| PUT | `/sysadmin/students/{id}/consent` | Bearer |  |
| GET | `/sysadmin/students/export/csv` | Bearer |  |
| GET | `/sysadmin/users` | Bearer |  |
| POST | `/sysadmin/users` | Bearer |  |
| PUT | `/sysadmin/users/{id}` | Bearer |  |
| POST | `/sysadmin/users/{id}/reset-password` | Bearer |  |
| DELETE | `/sysadmin/users/{userId}` | Bearer |  |
| DELETE | `/sysadmin/users/{userId}/personal-data` | Bearer |  |
| GET | `/sysadmin/vendors` | Bearer |  |
| POST | `/sysadmin/vendors` | Bearer |  |
| PUT | `/sysadmin/vendors/{id}` | Bearer |  |
| DELETE | `/sysadmin/vendors/{id}` | Bearer |  |
| GET | `/sysadmin/wsib/compliance-summary` | Bearer |  |
| GET | `/sysadmin/wsib/export/csv` | Bearer |  |
| GET | `/sysadmin/wsib/training-history` | Bearer |  |
| GET | `/sysadmin/wsib/training-history/export/csv` | Bearer |  |

## Timesheet

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/timesheet/` | Bearer |  |
| POST | `/timesheet/` | Bearer |  |
| GET | `/timesheet/{timesheetId}` | Bearer |  |
| PUT | `/timesheet/{timesheetId}` | Bearer |  |
| POST | `/timesheet/{timesheetId}/approve` | Bearer |  |
| GET | `/timesheet/{timesheetId}/notes` | Bearer |  |
| POST | `/timesheet/{timesheetId}/notes` | Bearer |  |
| DELETE | `/timesheet/{timesheetId}/notes/{noteId}` | Bearer |  |
| GET | `/timesheet/instructor/{instructorId}/summary` | Bearer |  |
| GET | `/timesheet/reminders/pending` | Bearer |  |
| POST | `/timesheet/reminders/send` | Bearer |  |
| GET | `/timesheet/stats` | Bearer |  |
| GET | `/timesheet/week/{weekStartDate}/courses` | Bearer |  |

## Vendor

Vendor portal — invoice submission, profile, dashboard

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/vendor/dashboard` | Bearer |  |
| GET | `/vendor/invoices` | Bearer |  |
| POST | `/vendor/invoices` | Bearer |  |
| GET | `/vendor/invoices/{id}` | Bearer |  |
| GET | `/vendor/invoices/{id}/details` | Bearer |  |
| GET | `/vendor/invoices/{id}/download` | Bearer |  |
| POST | `/vendor/invoices/{id}/resend-to-admin` | Bearer |  |
| POST | `/vendor/invoices/{id}/submit-to-admin` | Bearer |  |
| GET | `/vendor/profile` | Bearer |  |
| PUT | `/vendor/profile` | Bearer |  |
| GET | `/vendor/vendors` | Bearer |  |

