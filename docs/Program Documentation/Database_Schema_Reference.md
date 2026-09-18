# CPR Training Management System -- Database Schema Reference

**Database Engine:** MariaDB 11.4 (InnoDB) — MySQL-compatible; confirmed from the production dump header 2026-09-18
**Character Set:** utf8mb4
**Timezone:** UTC (+00:00)

---

## Table of Contents

1. [Core Tables](#core-tables)
2. [Billing & Invoicing Tables](#billing--invoicing-tables)
3. [Vendor Management Tables](#vendor-management-tables)
4. [Payroll & Compensation Tables](#payroll--compensation-tables)
5. [Notification & Communication Tables](#notification--communication-tables)
6. [Student & Certification Tables](#student--certification-tables)
7. [System & Infrastructure Tables](#system--infrastructure-tables)
8. [Relationships](#relationships)
9. [Migration History](#migration-history)

---

## Core Tables

### users

Stores all system users including admins, instructors, organization users, accountants, HR staff, course admins, and vendors.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| username | VARCHAR(255) | NO | | Unique login username |
| email | VARCHAR(255) | NO | | User email address |
| password_hash | VARCHAR(255) | NO | | Bcrypt-hashed password |
| full_name | VARCHAR(255) | YES | NULL | Legacy full name field |
| first_name | VARCHAR(100) | YES | NULL | First name |
| last_name | VARCHAR(100) | YES | NULL | Last name |
| role | VARCHAR(50) | NO | | One of: admin, instructor, organization, accountant, hr, courseadmin, vendor, sysadmin |
| organization_id | INT | YES | NULL | FK to organizations.id |
| location_id | INT | YES | NULL | FK to organization_locations.id |
| status | VARCHAR(20) | NO | 'active' | One of: active, inactive, deleted |
| phone | VARCHAR(50) | YES | NULL | Office/home phone |
| mobile | VARCHAR(50) | YES | NULL | Mobile phone |
| address | VARCHAR(500) | YES | NULL | Mailing address |
| date_onboarded | DATE | YES | NULL | Date the user was onboarded |
| date_offboarded | DATE | YES | NULL | Date the user was offboarded |
| user_comments | TEXT | YES | NULL | Administrative comments |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Notes:** This table does not use a `deleted_at` column; instead, `status = 'deleted'` is used for soft deletion. PIPEDA data erasure anonymizes personal fields via the sysadmin endpoint.

---

### organizations

Client organizations that request CPR training courses.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| name | VARCHAR(255) | NO | | Organization name |
| address | VARCHAR(500) | YES | NULL | Mailing/physical address |
| contact_email | VARCHAR(255) | YES | NULL | Primary contact email |
| contact_phone | VARCHAR(50) | YES | NULL | Primary contact phone |
| contact_person | VARCHAR(255) | YES | NULL | Name of contact person |
| status | VARCHAR(20) | YES | 'active' | Organization status |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id

---

### organization_locations

Physical locations belonging to an organization where courses can be held.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| organization_id | INT | NO | | FK to organizations.id |
| location_name | VARCHAR(255) | NO | | Name of the location |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** organization_id -> organizations(id)

---

### class_types

Catalog of available course/class types (e.g., "Basic CPR", "First Aid Level C").

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| name | VARCHAR(255) | NO | | Course type name (unique) |
| description | TEXT | YES | NULL | Course description |
| duration_minutes | INT | NO | | Duration of the course in minutes |
| course_code | VARCHAR(50) | YES | NULL | Short code identifier |
| is_active | BOOLEAN | YES | TRUE | Whether the course type is available for scheduling |
| certification_validity_months | INT | YES | NULL | How many months a certification is valid (added in migration v8) |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Notes:** When a class type has associated course_requests, deletion is soft (sets is_active = false).

---

### course_requests

Central table for training course requests. Tracks the full lifecycle from request through scheduling, completion, and billing.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| organization_id | INT | NO | | FK to organizations.id |
| course_type_id | INT | NO | | FK to class_types.id |
| date_requested | DATETIME | NO | CURRENT_TIMESTAMP | When the request was submitted |
| scheduled_date | DATE | YES | NULL | Requested/scheduled date |
| location | VARCHAR(255) | NO | | Course location |
| location_id | INT | YES | NULL | FK to organization_locations.id |
| registered_students | INT | NO | 0 | Expected number of students |
| notes | TEXT | YES | NULL | Free-text notes |
| status | VARCHAR(30) | NO | 'pending' | pending, past_due, confirmed, completed, invoiced, cancelled |
| instructor_id | INT | YES | NULL | FK to users.id (assigned instructor) |
| confirmed_date | DATE | YES | NULL | Confirmed course date |
| confirmed_start_time | VARCHAR(10) | YES | NULL | Confirmed start time (HH:MM) |
| confirmed_end_time | VARCHAR(10) | YES | NULL | Confirmed end time (HH:MM) |
| completed_at | DATETIME | YES | NULL | Timestamp when course was completed |
| instructor_comments | TEXT | YES | NULL | Instructor notes after completion |
| is_cancelled | BOOLEAN | YES | FALSE | Whether the course is cancelled |
| cancelled_at | DATETIME | YES | NULL | Cancellation timestamp |
| cancellation_reason | TEXT | YES | NULL | Reason for cancellation |
| ready_for_billing | BOOLEAN | YES | FALSE | Whether course is ready for invoicing |
| ready_for_billing_at | DATETIME | YES | NULL | When it was marked ready |
| invoiced | BOOLEAN | YES | FALSE | Whether an invoice has been created |
| last_reminder_at | DATETIME | YES | NULL | Last reminder sent timestamp |
| archived | BOOLEAN | YES | FALSE | Whether the course is archived |
| archived_at | DATETIME | YES | NULL | When it was archived |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |
| deleted_at | DATETIME | YES | NULL | Soft delete timestamp |

**Primary Key:** id
**Foreign Keys:**
- organization_id -> organizations(id)
- course_type_id -> class_types(id)
- instructor_id -> users(id)

---

### course_students

Roster of students enrolled in a specific course request. Each row is a student-to-course enrollment.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| course_request_id | INT | NO | | FK to course_requests.id |
| student_id | INT | YES | NULL | FK to students.id (master record, added in migration v6) |
| first_name | VARCHAR(255) | NO | | Student first name |
| last_name | VARCHAR(255) | NO | | Student last name |
| email | VARCHAR(255) | YES | NULL | Student email |
| phone | VARCHAR(50) | YES | NULL | Student phone |
| college | VARCHAR(255) | YES | NULL | College affiliation |
| attended | BOOLEAN | NO | FALSE | Whether student attended |
| attendance_marked | BOOLEAN | YES | FALSE | Whether attendance has been recorded |
| certificate_number | VARCHAR(50) | YES | NULL | Issued certificate number (added in migration v9) |
| certificate_issued_at | DATETIME | YES | NULL | When certificate was issued (added in migration v9) |
| certificate_expires_at | DATETIME | YES | NULL | Certificate expiry date (added in migration v9) |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | YES | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |
| deleted_at | DATETIME | YES | NULL | Soft delete timestamp |

**Primary Key:** id
**Foreign Keys:**
- course_request_id -> course_requests(id)
- student_id -> students(id) ON DELETE SET NULL
**Indexes:**
- idx_cs_student_id (student_id) -- added in migration v6
- idx_cs_cert_expires (certificate_expires_at) -- added in migration v9

---

### classes

Legacy/secondary scheduling table used by the instructor portal for class management.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| class_type_id | INT | NO | | FK to class_types.id |
| instructor_id | INT | NO | | FK to users.id |
| organization_id | INT | YES | NULL | FK to organizations.id |
| start_time | DATETIME | YES | NULL | Class start time |
| end_time | DATETIME | YES | NULL | Class end time |
| status | VARCHAR(30) | YES | 'scheduled' | scheduled, completed, cancelled |
| location | VARCHAR(255) | YES | NULL | Class location |
| max_students | INT | YES | NULL | Maximum student capacity |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:**
- class_type_id -> class_types(id)
- instructor_id -> users(id)

---

### colleges

Lookup table for educational institutions (used in student enrollment forms).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| name | VARCHAR(200) | NO | | College name (unique) |
| is_active | BOOLEAN | YES | TRUE | Whether the college is active |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id

---

### instructor_availability

Tracks instructor availability dates for course scheduling.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| instructor_id | INT | NO | | FK to users.id |
| date | DATE | NO | | Available date |
| status | VARCHAR(20) | NO | 'available' | Availability status |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** instructor_id -> users(id)

---

## Billing & Invoicing Tables

### invoices

Invoices generated for organizations based on completed courses. The `invoice_with_breakdown` view (or table alias) is frequently used in queries and includes `base_cost` and `tax_amount` breakdowns.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| invoice_number | VARCHAR(50) | NO | | Unique invoice number (generated via invoice_number_sequences) |
| organization_id | INT | NO | | FK to organizations.id |
| course_request_id | INT | NO | | FK to course_requests.id |
| invoice_date | DATETIME | YES | NULL | Date invoice was issued |
| due_date | DATE | YES | NULL | Payment due date |
| amount | DECIMAL(10,2) | NO | | Total invoice amount |
| base_cost | DECIMAL(10,2) | NO | 0 | Pre-tax amount |
| tax_amount | DECIMAL(10,2) | NO | 0 | HST/tax amount |
| students_billed | INT | NO | 0 | Number of students billed |
| rate_per_student | DECIMAL(10,2) | YES | NULL | Rate per student at time of invoicing |
| status | VARCHAR(30) | NO | 'draft' | draft, pending, approved, posted, payment_submitted, partial_payment, paid, void, cancelled |
| approval_status | VARCHAR(20) | NO | 'pending' | pending, approved, rejected |
| posted_to_org | BOOLEAN | NO | FALSE | Whether invoice is visible to the organization |
| posted_to_org_at | DATETIME | YES | NULL | When invoice was posted to org |
| email_sent_at | DATETIME | YES | NULL | When invoice email was sent |
| rejection_reason | TEXT | YES | NULL | Reason if invoice was rejected |
| rejected_at | DATETIME | YES | NULL | When invoice was rejected |
| rejected_by | INT | YES | NULL | FK to users.id (who rejected) |
| approved_by | INT | YES | NULL | FK to users.id (who approved) |
| approved_at | DATETIME | YES | NULL | When invoice was approved |
| course_type_name | VARCHAR(255) | YES | NULL | Denormalized course type name |
| location | VARCHAR(255) | YES | NULL | Denormalized course location |
| date_completed | DATE | YES | NULL | Denormalized completion date |
| notes | TEXT | YES | NULL | Invoice notes |
| paid_date | DATE | YES | NULL | Date invoice was fully paid |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |
| deleted_at | DATETIME | YES | NULL | Soft delete timestamp |

**Primary Key:** id
**Foreign Keys:**
- organization_id -> organizations(id)
- course_request_id -> course_requests(id)
- rejected_by -> users(id)
- approved_by -> users(id)

**Notes:** The codebase references `invoice_with_breakdown` in many queries. This is either a view or table alias that provides `base_cost` and `tax_amount` as separate columns for financial calculations.

---

### payments

Payments made against invoices by organizations. Supports a verification workflow where org submits payment and accounting verifies it.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| invoice_id | INT | NO | | FK to invoices.id |
| amount | DECIMAL(10,2) | NO | | Payment amount |
| payment_date | DATE | NO | | Date of payment |
| payment_method | VARCHAR(50) | YES | NULL | Payment method (e.g., cheque, e-transfer) |
| reference_number | VARCHAR(100) | YES | NULL | Payment reference/confirmation number |
| notes | TEXT | YES | NULL | Payment notes (appended during verification) |
| status | VARCHAR(30) | NO | 'pending_verification' | pending_verification, verified, rejected, reversed |
| submitted_by_org_at | DATETIME | YES | NULL | When org submitted the payment |
| verified_by_accounting_at | DATETIME | YES | NULL | When accounting verified the payment |
| reversed_at | DATETIME | YES | NULL | When payment was reversed |
| reversed_by | INT | YES | NULL | FK to users.id (who reversed) |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| deleted_at | DATETIME | YES | NULL | Soft delete timestamp |

**Primary Key:** id
**Foreign Keys:**
- invoice_id -> invoices(id)
- reversed_by -> users(id)

---

### invoice_number_sequences

Per-organization configuration for automatic invoice number generation. Created in migration v3.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| organization_id | INT | NO | | FK to organizations.id (UNIQUE) |
| prefix | VARCHAR(20) | NO | 'INV' | Invoice number prefix |
| format_string | VARCHAR(100) | NO | '{PREFIX}-{YYYY}-{NNNN}' | Format template for invoice numbers |
| padding | INT | NO | 4 | Zero-padding for the sequence number |
| next_number | INT | NO | 1 | Next number in sequence |
| step | INT | NO | 1 | Increment step |
| reset_policy | ENUM | NO | 'none' | none, yearly, monthly -- when to reset the counter |
| last_reset_period | VARCHAR(10) | YES | NULL | Last period when counter was reset |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** organization_id -> organizations(id) (fk_inv_seq_org)
**Constraints:** organization_id is UNIQUE

---

### course_pricing

Per-organization, per-course-type pricing for the billing system used by the accountant/billing service.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| organization_id | INT | NO | | FK to organizations.id |
| course_type_id | INT | NO | | FK to class_types.id |
| price_per_student | DECIMAL(10,2) | NO | | Price charged per student |
| effective_date | DATE | YES | CURRENT_DATE | When this price takes effect |
| is_active | BOOLEAN | NO | TRUE | Whether this pricing is currently active |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |
| deleted_at | DATETIME | YES | NULL | Soft delete timestamp |

**Primary Key:** id
**Foreign Keys:**
- organization_id -> organizations(id)
- course_type_id -> class_types(id)

---

### organization_pricing

Sysadmin-managed pricing for organizations (alternative/parallel pricing table to course_pricing).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| organization_id | INT | NO | | FK to organizations.id |
| class_type_id | INT | NO | | FK to class_types.id |
| price_per_student | DECIMAL(10,2) | NO | | Price per student |
| is_active | BOOLEAN | NO | TRUE | Whether pricing is active |
| created_by | INT | YES | NULL | FK to users.id |
| last_modified_by | INT | YES | NULL | FK to users.id |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:**
- organization_id -> organizations(id)
- class_type_id -> class_types(id)

---

## Vendor Management Tables

### vendors

External vendor/supplier companies.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| name | VARCHAR(255) | NO | | Vendor display name |
| vendor_name | VARCHAR(255) | YES | NULL | Alternative name field |
| contact_email | VARCHAR(255) | YES | NULL | Vendor contact email (links to users.email for vendor portal) |
| contact_first_name | VARCHAR(100) | YES | NULL | Contact person first name |
| contact_last_name | VARCHAR(100) | YES | NULL | Contact person last name |
| phone | VARCHAR(50) | YES | NULL | Phone number |
| address | VARCHAR(500) | YES | NULL | Full address (legacy) |
| address_street | VARCHAR(255) | YES | NULL | Street address |
| address_city | VARCHAR(100) | YES | NULL | City |
| address_province | VARCHAR(50) | YES | NULL | Province/state |
| address_postal_code | VARCHAR(20) | YES | NULL | Postal/ZIP code |
| vendor_type | VARCHAR(50) | YES | NULL | Type/category of vendor |
| is_active | BOOLEAN | NO | TRUE | Whether vendor is active |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Notes:** Vendor portal users are linked via `vendors.contact_email = users.email`.

---

### vendor_invoices

Invoices submitted by vendors for payment (accounts payable).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| vendor_id | INT | NO | | FK to vendors.id |
| invoice_number | VARCHAR(100) | NO | | Vendor's invoice number |
| amount | DECIMAL(10,2) | NO | | Invoice amount (subtotal) |
| rate | DECIMAL(10,2) | YES | 0 | Unit rate |
| subtotal | DECIMAL(10,2) | YES | NULL | Subtotal before tax |
| hst | DECIMAL(10,2) | YES | 0 | HST tax amount |
| total | DECIMAL(10,2) | YES | NULL | Total including tax |
| description | TEXT | YES | NULL | Invoice description |
| invoice_date | DATE | NO | | Date on the invoice |
| due_date | DATE | YES | NULL | Payment due date |
| manual_type | VARCHAR(50) | YES | NULL | Manual entry type |
| quantity | INT | YES | NULL | Quantity of items/services |
| pdf_filename | VARCHAR(255) | YES | NULL | Uploaded PDF filename |
| status | VARCHAR(30) | NO | 'pending_submission' | pending_submission, submitted_to_admin, submitted_to_accounting, rejected_by_admin, rejected_by_accountant, paid |
| approved_by | INT | YES | NULL | FK to users.id (admin who approved) |
| admin_notes | TEXT | YES | NULL | Admin notes |
| rejection_reason | TEXT | YES | NULL | Reason for rejection |
| rejected_at | DATETIME | YES | NULL | When rejected |
| rejected_by | INT | YES | NULL | FK to users.id |
| sent_to_accounting_at | DATETIME | YES | NULL | When sent to accounting |
| submitted_by | INT | YES | NULL | FK to users.id (vendor user) |
| submitted_at | DATETIME | YES | NULL | When submitted |
| paid_at | DATETIME | YES | NULL | When paid |
| payment_date | DATE | YES | NULL | Payment date |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:**
- vendor_id -> vendors(id)
- approved_by -> users(id)
- submitted_by -> users(id)

---

### vendor_payments

Payments made to vendors against their invoices.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| vendor_invoice_id | INT | NO | | FK to vendor_invoices.id |
| amount | DECIMAL(10,2) | NO | | Payment amount |
| payment_date | DATE | YES | NULL | Date of payment |
| payment_method | VARCHAR(50) | YES | NULL | Payment method |
| reference_number | VARCHAR(100) | YES | NULL | Payment reference number |
| notes | TEXT | YES | NULL | Payment notes |
| status | VARCHAR(20) | NO | 'processed' | processed, pending |
| processed_by | INT | YES | NULL | FK to users.id |
| processed_at | DATETIME | YES | NULL | When payment was processed |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |

**Primary Key:** id
**Foreign Keys:**
- vendor_invoice_id -> vendor_invoices(id)
- processed_by -> users(id)

---

## Payroll & Compensation Tables

### instructor_pay_rates

Active pay rates for instructors. Supports date-range validity and tier-based rates.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| instructor_id | INT | NO | | FK to users.id |
| tier_id | INT | YES | NULL | FK to pay_rate_tiers.id |
| hourly_rate | DECIMAL(10,2) | NO | | Hourly pay rate |
| course_bonus | DECIMAL(10,2) | NO | 50.00 | Per-course bonus amount |
| effective_date | DATE | NO | | Start date of this rate |
| end_date | DATE | YES | NULL | End date (NULL = currently active) |
| is_active | BOOLEAN | NO | TRUE | Whether rate is active |
| notes | TEXT | YES | NULL | Notes about this rate |
| created_by | INT | YES | NULL | FK to users.id (who set this rate) |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:**
- instructor_id -> users(id)
- tier_id -> pay_rate_tiers(id)
- created_by -> users(id)

---

### pay_rate_tiers

Named tiers for instructor compensation (e.g., "Junior", "Senior", "Lead").

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| name | VARCHAR(100) | NO | | Tier name |
| description | TEXT | YES | NULL | Tier description |
| base_hourly_rate | DECIMAL(10,2) | NO | | Default hourly rate for this tier |
| course_bonus | DECIMAL(10,2) | NO | 50.00 | Default course bonus for this tier |
| is_active | BOOLEAN | NO | TRUE | Whether tier is active |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id

---

### pay_rate_history

Audit trail of pay rate changes for instructors.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| instructor_id | INT | NO | | FK to users.id |
| old_hourly_rate | DECIMAL(10,2) | YES | NULL | Previous hourly rate |
| new_hourly_rate | DECIMAL(10,2) | NO | | New hourly rate |
| old_course_bonus | DECIMAL(10,2) | YES | NULL | Previous course bonus |
| new_course_bonus | DECIMAL(10,2) | NO | | New course bonus |
| old_tier_id | INT | YES | NULL | Previous tier FK |
| new_tier_id | INT | YES | NULL | New tier FK |
| change_reason | TEXT | YES | NULL | Reason for the change |
| changed_by | INT | YES | NULL | FK to users.id (who made the change) |
| effective_date | DATE | NO | | When the new rate takes effect |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |

**Primary Key:** id
**Foreign Keys:**
- instructor_id -> users(id)
- old_tier_id -> pay_rate_tiers(id)
- new_tier_id -> pay_rate_tiers(id)
- changed_by -> users(id)

---

### payroll_payments

Payroll payments made to instructors.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| instructor_id | INT | NO | | FK to users.id |
| amount | DECIMAL(10,2) | NO | | Payment amount |
| payment_date | DATE | NO | | Payment date |
| payment_method | VARCHAR(50) | NO | 'direct_deposit' | Payment method |
| notes | TEXT | YES | NULL | Notes |
| hr_notes | TEXT | YES | NULL | HR processing notes |
| status | VARCHAR(20) | NO | 'pending' | pending, completed, rejected |
| transaction_id | VARCHAR(100) | YES | NULL | External transaction reference |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** instructor_id -> users(id)

---

### timesheets

Weekly timesheet submissions from instructors.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| instructor_id | INT | NO | | FK to users.id |
| week_start_date | DATE | NO | | Monday of the reported week |
| total_hours | DECIMAL(6,2) | NO | 0 | Total hours worked |
| teaching_hours | DECIMAL(6,2) | YES | 0 | Hours spent teaching |
| travel_time | DECIMAL(6,2) | YES | 0 | Travel time hours |
| prep_time | DECIMAL(6,2) | YES | 0 | Preparation time hours |
| courses_taught | INT | NO | 0 | Number of courses taught that week |
| notes | TEXT | YES | NULL | Instructor notes |
| course_details | JSON | YES | NULL | Detailed course information (auto-populated) |
| status | VARCHAR(20) | NO | 'pending' | pending, approved, rejected |
| hr_comment | TEXT | YES | NULL | HR review comment |
| is_late | BOOLEAN | NO | FALSE | Whether submission was late |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** instructor_id -> users(id)
**Unique Constraint:** (instructor_id, week_start_date) -- enforced in application logic

---

### timesheet_notes

Threaded notes/comments on timesheets from different roles.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| timesheet_id | INT | NO | | FK to timesheets.id |
| user_id | INT | NO | | FK to users.id (who added the note) |
| user_role | VARCHAR(50) | YES | NULL | Role of the user when note was added |
| note_text | TEXT | NO | | Note content |
| note_type | ENUM | NO | 'general' | instructor, hr, accounting, general |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |

**Primary Key:** id
**Foreign Keys:**
- timesheet_id -> timesheets(id)
- user_id -> users(id)

---

## Notification & Communication Tables

### notifications

In-app notifications for users.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| user_id | INT | NO | | FK to users.id |
| type | VARCHAR(50) | NO | | Notification type (e.g., timesheet_reminder, payment_submitted) |
| title | VARCHAR(255) | YES | NULL | Notification title |
| message | TEXT | NO | | Notification message body |
| is_read | BOOLEAN | NO | FALSE | Whether the user has read this notification |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |

**Primary Key:** id
**Foreign Keys:** user_id -> users(id)

---

### notification_preferences

Per-user, per-notification-type preferences for email, push, and sound notifications.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| user_id | INT | NO | | FK to users.id |
| notification_type | VARCHAR(50) | NO | | Type of notification |
| email_enabled | BOOLEAN | NO | TRUE | Whether to send email for this type |
| push_enabled | BOOLEAN | NO | TRUE | Whether to show push notification |
| sound_enabled | BOOLEAN | NO | TRUE | Whether to play sound |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** user_id -> users(id)
**Notes:** Valid notification types include: payment_submitted, timesheet_submitted, invoice_status_change, payment_verification_needed, payment_verified, timesheet_approved, invoice_overdue, system_alert, course_status_change.

---

### email_templates

Configurable email templates managed by administrators.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| name | VARCHAR(255) | NO | | Template name |
| key | VARCHAR(100) | YES | NULL | Unique template key (e.g., COURSE_REMINDER) |
| category | VARCHAR(50) | NO | | Template category (course, reminder, notification, system, custom) |
| sub_category | VARCHAR(50) | YES | NULL | Sub-category |
| subject | VARCHAR(500) | NO | | Email subject line |
| body | TEXT | NO | | HTML email body with {{variable}} placeholders |
| is_active | BOOLEAN | NO | TRUE | Whether template is active |
| is_system | BOOLEAN | NO | FALSE | Whether this is a system template (cannot be deleted) |
| created_by | INT | YES | NULL | FK to users.id |
| last_modified_by | INT | YES | NULL | FK to users.id |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id

---

## Student & Certification Tables

### students

Master student records, deduplicated by email. Created in migration v5 and backfilled from course_students in migration v7.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| email | VARCHAR(255) | NO | | Student email (unique, lowercased) |
| first_name | VARCHAR(255) | NO | | First name |
| last_name | VARCHAR(255) | NO | | Last name |
| phone | VARCHAR(50) | YES | NULL | Phone number |
| organization_id | INT | YES | NULL | FK to organizations.id |
| marketing_consent | BOOLEAN | NO | FALSE | Whether student consented to marketing |
| marketing_consent_at | DATETIME | YES | NULL | When consent was given |
| notes | TEXT | YES | NULL | Administrative notes |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** organization_id -> organizations(id) ON DELETE SET NULL (fk_students_org)
**Indexes:**
- idx_students_email (email) -- UNIQUE
- idx_students_org (organization_id)
- idx_students_name (last_name, first_name)

---

### certification_reminders

Tracks sent certification expiry reminders to prevent duplicate notifications. Created in migration v12.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| course_student_id | INT | NO | | FK to course_students.id |
| student_email | VARCHAR(255) | NO | | Email address reminder was sent to |
| reminder_type | VARCHAR(10) | NO | | Type of reminder (e.g., '30day', '60day', '90day') |
| sent_at | DATETIME | NO | CURRENT_TIMESTAMP | When the reminder was sent |

**Primary Key:** id
**Indexes:** idx_dedup (course_student_id, reminder_type)

---

### profile_changes

Tracks pending profile change requests that require HR approval before being applied.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| user_id | INT | NO | | FK to users.id |
| change_type | VARCHAR(50) | NO | | Type of change (e.g., 'profile_update') |
| field_name | VARCHAR(100) | NO | | Which field is being changed |
| old_value | TEXT | YES | NULL | Previous value |
| new_value | TEXT | NO | | Requested new value |
| status | VARCHAR(20) | NO | 'pending' | pending, approved, rejected |
| hr_comment | TEXT | YES | NULL | HR reviewer comment |
| created_at | DATETIME | NO | CURRENT_TIMESTAMP | Record creation timestamp |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** id
**Foreign Keys:** user_id -> users(id)

---

## System & Infrastructure Tables

### schema_migrations

Tracks which database migrations have been applied. Created automatically by the migration runner.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| version | INT | NO | | Migration version number |
| name | VARCHAR(255) | NO | | Migration name |
| applied_at | DATETIME | NO | CURRENT_TIMESTAMP | When migration was applied |

**Primary Key:** version

---

### login_attempts

Tracks login attempts for rate limiting and security monitoring. Created in migration v1. Old records (>1 hour) are automatically purged during migration runs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| username | VARCHAR(255) | NO | | Attempted username |
| attempted_at | DATETIME | NO | CURRENT_TIMESTAMP | When attempt occurred |

**Primary Key:** id
**Indexes:** idx_login_attempts_username (username, attempted_at)

---

### token_blacklist

Stores invalidated JWT tokens (by user_id) for logout/session invalidation. Created in migration v2.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | INT | NO | | User whose tokens are invalidated |
| invalidated_at | DATETIME | NO | CURRENT_TIMESTAMP | When tokens were invalidated |

**Primary Key:** user_id
**Indexes:** idx_token_blacklist_user (user_id)

---

### audit_logs

System-wide audit trail for security-sensitive actions. Created in migration v13.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INT | NO | AUTO_INCREMENT | Primary key |
| user_id | INT | YES | NULL | FK to users.id (actor) |
| username | VARCHAR(100) | YES | NULL | Username at time of action |
| action | VARCHAR(100) | NO | | Action performed (e.g., login, create_user, update_organization) |
| entity_type | VARCHAR(50) | YES | NULL | Type of entity affected (e.g., user, organization) |
| entity_id | INT | YES | NULL | ID of affected entity |
| details | JSON | YES | NULL | Additional action details |
| ip_address | VARCHAR(45) | YES | NULL | Client IP address |
| created_at | TIMESTAMP | NO | CURRENT_TIMESTAMP | When action occurred |

**Primary Key:** id
**Indexes:**
- idx_audit_created (created_at)
- idx_audit_user (user_id)
- idx_audit_entity (entity_type, entity_id)

---

### system_config

Key-value store for system-wide configuration. Created in migration v11.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| config_key | VARCHAR(100) | NO | | Configuration key |
| config_value | VARCHAR(500) | NO | | Configuration value |
| description | VARCHAR(255) | YES | NULL | Human-readable description |
| updated_at | DATETIME | NO | CURRENT_TIMESTAMP ON UPDATE | Last update timestamp |

**Primary Key:** config_key
**Notes:** Seeded with `tax_rate` (HST rate as decimal, e.g., 0.13 = 13%) during migration v11.

---

## Relationships

### Organization-Centric Relationships
- **organizations** 1---* **users** (via users.organization_id)
- **organizations** 1---* **organization_locations** (via organization_locations.organization_id)
- **organizations** 1---* **course_requests** (via course_requests.organization_id)
- **organizations** 1---* **invoices** (via invoices.organization_id)
- **organizations** 1---* **course_pricing** (via course_pricing.organization_id)
- **organizations** 1---* **organization_pricing** (via organization_pricing.organization_id)
- **organizations** 1---* **invoice_number_sequences** (via invoice_number_sequences.organization_id, 1:1)
- **organizations** 1---* **students** (via students.organization_id)

### Course Lifecycle Relationships
- **class_types** 1---* **course_requests** (via course_requests.course_type_id)
- **course_requests** 1---* **course_students** (via course_students.course_request_id)
- **course_requests** 1---* **invoices** (via invoices.course_request_id)
- **users (instructor)** 1---* **course_requests** (via course_requests.instructor_id)

### Student Relationships
- **students** 1---* **course_students** (via course_students.student_id)
- **course_students** 1---* **certification_reminders** (via certification_reminders.course_student_id)

### Billing Relationships
- **invoices** 1---* **payments** (via payments.invoice_id)
- **class_types** + **organizations** ---* **course_pricing** (composite lookup)
- **class_types** + **organizations** ---* **organization_pricing** (composite lookup)

### Vendor Relationships
- **vendors** 1---* **vendor_invoices** (via vendor_invoices.vendor_id)
- **vendor_invoices** 1---* **vendor_payments** (via vendor_payments.vendor_invoice_id)

### Payroll Relationships
- **users (instructor)** 1---* **instructor_pay_rates** (via instructor_pay_rates.instructor_id)
- **pay_rate_tiers** 1---* **instructor_pay_rates** (via instructor_pay_rates.tier_id)
- **users (instructor)** 1---* **pay_rate_history** (via pay_rate_history.instructor_id)
- **users (instructor)** 1---* **payroll_payments** (via payroll_payments.instructor_id)
- **users (instructor)** 1---* **timesheets** (via timesheets.instructor_id)
- **timesheets** 1---* **timesheet_notes** (via timesheet_notes.timesheet_id)

### User Relationships
- **users** 1---* **profile_changes** (via profile_changes.user_id)
- **users** 1---* **notifications** (via notifications.user_id)
- **users** 1---* **notification_preferences** (via notification_preferences.user_id)
- **users** 1---* **audit_logs** (via audit_logs.user_id)

---

## Migration History

All migrations are defined in `backend/src/config/migrations.ts` and tracked in the `schema_migrations` table. Migrations run automatically at server startup.

| Version | Name | Description |
|---------|------|-------------|
| 1 | create_login_attempts | Creates the `login_attempts` table with index on (username, attempted_at) for rate limiting |
| 2 | create_token_blacklist | Creates the `token_blacklist` table for JWT invalidation |
| 3 | create_invoice_number_sequences | Creates the `invoice_number_sequences` table with FK to organizations |
| 4 | fix_token_blacklist_add_invalidated_at | Adds `invalidated_at` column to token_blacklist (idempotent) |
| 5 | create_students_master | Creates the `students` master table with unique email index and org FK |
| 6 | add_student_id_to_course_students | Adds `student_id` column and FK to course_students linking to students master |
| 7 | backfill_students_master | Programmatic migration: deduplicates course_students by email, creates master student records, and links existing course_students to their master records |
| 8 | add_certification_expiry_tracking | Adds `certification_validity_months` column to class_types |
| 9 | add_certificate_fields_to_course_students | Adds `certificate_number`, `certificate_issued_at`, `certificate_expires_at` to course_students with index on expiry date |
| 10 | backfill_certificate_dates | Programmatic migration: for attended students in completed courses where the class type has a validity period, sets certificate_issued_at and certificate_expires_at |
| 11 | create_system_config | Creates the `system_config` key-value table and seeds the HST tax rate |
| 12 | create_certification_reminders | Creates the `certification_reminders` table for tracking sent cert expiry reminders |
| 13 | create_audit_logs | Creates the `audit_logs` table with indexes on created_at, user_id, and (entity_type, entity_id) |

**Notes:**
- The migration runner automatically creates the `schema_migrations` tracking table if it does not exist.
- Migrations are idempotent and use `IF NOT EXISTS` / `IF NOT EXISTS` guards where possible.
- After migrations complete, old login_attempts (older than 1 hour) are automatically purged.
- Many tables (users, organizations, class_types, course_requests, invoices, payments, etc.) are assumed to be created by an initial SQL schema or seed script outside the versioned migration system. The migration system handles incremental schema changes only.
