# CPR Training System — UAT Test Bank

**All test users use password: `test123`**

| User | Role | Portal | URL |
|------|------|--------|-----|
| `instructor` | instructor | Instructor Portal | `/instructor/dashboard` |
| `orguser` | organization | Organization Portal | `/organization/dashboard` |
| `courseadmin` | admin | Course Admin Portal | `/admin/dashboard` |
| `accountant` | accountant | Accounting Portal | `/accounting/dashboard` |
| `admin` | superadmin | Super Admin Portal | `/superadmin/dashboard` |
| `sysadmin` | sysadmin | System Admin Portal | `/sysadmin/dashboard` |
| `hruser` | hr | HR Portal | `/hr` |
| `vendoruser` | vendor | Vendor Portal | `/vendor/dashboard` |

---

## 1. Authentication (All Users)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1 | Login | Enter username/password, click Login | Redirects to correct portal dashboard |
| 1.2 | Wrong password | Enter wrong password | "Invalid username or password" error |
| 1.3 | Logout | Click logout from any portal | Redirects to `/login`, session cleared |
| 1.4 | Session persistence | Login, close tab, reopen same URL | Still logged in (token valid) |
| 1.5 | Role-based routing | Login as each user | Each user lands on their correct portal |
| 1.6 | Change password | Profile → Change Password → enter current + new | Success message, can login with new password |

---

## 2. Instructor Portal (`instructor` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 2.1 | Dashboard | View stats | Navigate to Dashboard | Shows total courses, scheduled, completed, cancelled, total students, recent classes |
| 2.2 | Dashboard | Recent classes | Check recent classes list | Up to 5 recent classes displayed |
| 2.3 | Availability | View dates | Click Availability | Calendar or list of available dates shown |
| 2.4 | Availability | Add date | Select a future date, click Add | Date appears in availability list |
| 2.5 | Availability | Remove date | Click remove on an availability date | Date removed from list |
| 2.6 | My Schedule | View classes | Click My Schedule | Shows upcoming confirmed classes + availability |
| 2.7 | My Schedule | Mark complete | Click "Mark Complete" on a past class | Class moves to completed status |
| 2.8 | Class Attendance | View students | Select a class | Student list for that class displayed |
| 2.9 | Class Attendance | Toggle attendance | Check/uncheck attended for a student | Attendance status updates, cert dates auto-set |
| 2.10 | Class Attendance | Add student | Click "Add Student", fill form | New student added to class roster |
| 2.11 | Timesheet | View timesheets | Click Timesheet | List of own timesheets displayed |
| 2.12 | Timesheet | Submit new | Select a past week, fill hours, submit | Timesheet created with "pending" status |
| 2.13 | Timesheet | Edit pending | Click edit on a pending timesheet | Can modify hours/notes, save updates |
| 2.14 | Timesheet | Cannot edit approved | Try to edit an approved timesheet | Edit button disabled or not shown |
| 2.15 | Timesheet | Add note | Open timesheet, add a note | Note appears in notes thread |
| 2.16 | Archive | View completed | Click Archive | Table of completed courses (read-only) |
| 2.17 | Profile | View profile | Click Profile | Shows username, email, phone, stats |
| 2.18 | Profile | Update profile | Change phone number, save | Success message, phone updated |
| 2.19 | Teaching Manual | Open manual | Click Teaching Manual | PDF opens in new tab |

---

## 3. Organization Portal (`orguser` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 3.1 | Dashboard | View summary | Navigate to Dashboard | Shows active courses, completed, pending invoices, total spent |
| 3.2 | Dashboard | Org name shown | Check sidebar/header | "Test Organization - Main Location" displayed |
| 3.3 | My Courses | View courses | Click My Courses | List of active/pending/confirmed courses |
| 3.4 | My Courses | View students | Click View Students on a course | Student list modal/panel opens |
| 3.5 | My Courses | Upload CSV | Click Upload Students, select CSV file | Students imported, count updates |
| 3.6 | Schedule | View form | Click "Schedule a Course" | Course request form with course type dropdown |
| 3.7 | Schedule | Submit request | Fill in course type, date, location, # students → Submit | Success message, course appears in My Courses as "pending" |
| 3.8 | Schedule | Org not configured check | (Already tested — should NOT show error) | Form displays normally with org name |
| 3.9 | Bills Payable | View invoices | Click Bills Payable | List of outstanding invoices (paginated, sortable) |
| 3.10 | Bills Payable | View invoice detail | Click on an invoice | Detail view with line items + payment history |
| 3.11 | Bills Payable | Submit payment | Click Pay, fill method/amount/reference → Submit | Payment recorded, balance updates |
| 3.12 | Bills Payable | Download PDF | Click PDF download icon | Invoice PDF downloads |
| 3.13 | Bills Payable | Preview invoice | Click preview icon | Invoice renders in HTML preview |
| 3.14 | Paid Invoices | View paid | Click Paid Invoices | List of fully paid invoices with summary stats |
| 3.15 | Pricing | View pricing | Click Pricing | Org-specific pricing per course type shown |
| 3.16 | Pricing | Calculate cost | (If available) Enter student count | Cost estimate displayed |
| 3.17 | Archive | View archive | Click Archive | Completed/archived courses listed |
| 3.18 | Profile | View org profile | Click Profile | Organization details shown |
| 3.19 | Profile | Update profile | Change contact info, save | Success message |
| 3.20 | Analytics | View analytics | Click Analytics | Charts/stats derived from courses and billing |
| 3.21 | Navigation | All menu items work | Click each menu item in sequence | Each view loads without errors, URL updates |

---

## 4. Course Admin Portal (`courseadmin` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 4.1 | Dashboard | View summary | Navigate to Dashboard | Shows pending requests, confirmed courses, summary counts |
| 4.2 | Dashboard | Pending requests | Check pending section | Pending course requests listed |
| 4.3 | Instructor Mgmt | View instructors | Click Instructor Management | Active instructors listed with availability |
| 4.4 | Course Scheduling | View pending | Click Course Scheduling | Pending course requests shown |
| 4.5 | Course Scheduling | Assign instructor | Select a pending course → choose instructor → assign | Course moves to "confirmed" with instructor assigned |
| 4.6 | Course Scheduling | Reschedule | Click reschedule on a confirmed course | Date/time updated |
| 4.7 | Course Scheduling | Cancel course | Click cancel, enter reason | Course moves to "cancelled" with reason |
| 4.8 | Course Scheduling | Mark ready for billing | Click "Ready for Billing" on completed course | Course appears in accounting billing queue |
| 4.9 | Course Scheduling | View students | Click view students on a course | Enrolled students shown |
| 4.10 | Course Scheduling | Send reminder | Click send reminder | Reminder email sent |
| 4.11 | Email Templates | View templates | Click Email Templates | List of all templates |
| 4.12 | Email Templates | Create template | Click Create, fill name/subject/body → Save | Template created |
| 4.13 | Email Templates | Edit template | Click edit on existing template | Can modify and save |
| 4.14 | Email Templates | Preview template | Click preview | Rendered preview shown |
| 4.15 | Email Templates | Clone template | Click clone, enter name | Copy created |
| 4.16 | Email Templates | Send test | Click test send, enter email | Test email delivered |
| 4.17 | Email Templates | Delete template | Click delete, confirm | Template removed |
| 4.18 | Cancelled Courses | View list | Click Cancelled Courses | All cancelled courses listed |
| 4.19 | Vendor Invoices | View invoices | Click Vendor Invoices | Vendor invoices awaiting admin action |
| 4.20 | Vendor Invoices | Approve | Click approve on an invoice | Invoice moves to accounting |
| 4.21 | Vendor Invoices | Reject | Click reject, enter notes | Invoice marked rejected, vendor notified |
| 4.22 | Paid Vendor Inv. | View paid | Click Paid Vendor Invoices | Paid vendor invoices listed |

---

## 5. Accounting Portal (`accountant` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 5.1 | Dashboard | View financials | Navigate to Dashboard | Total revenue, outstanding, paid, pending counts |
| 5.2 | Aging Report | View aging | Click Aging Report | Executive summary, bucket breakdown (0-30, 31-60, 61-90, 90+), org breakdown |
| 5.3 | Aging Report | Filter by org | Select organization filter | Report filters to selected org |
| 5.4 | Financial Summary | View revenue | Click Financial Summary | Monthly revenue vs. collected chart for current year |
| 5.5 | Ready for Billing | View queue | Click Ready for Billing | Courses ready to be invoiced |
| 5.6 | Ready for Billing | Create invoice | Click "Create Invoice" on a course | Invoice generated, moves to pending approval |
| 5.7 | Pending Approvals | View pending | Click Pending Approvals | Invoices awaiting approval listed |
| 5.8 | Pending Approvals | Approve invoice | Click approve | Invoice approved, can be posted to org |
| 5.9 | Pending Approvals | Reject invoice | Click reject, enter notes | Invoice rejected with reason |
| 5.10 | Pending Approvals | Post to org | Click "Post to Org" on approved invoice | Invoice visible to organization |
| 5.11 | Rejected Invoices | View rejected | Click Rejected Invoices | Rejected invoices listed |
| 5.12 | Rejected Invoices | Resubmit | Click resubmit on a rejected invoice | Invoice moves back to pending approval |
| 5.13 | Org Receivables | View receivables | Click Organization Receivables | Outstanding invoices with balances |
| 5.14 | Org Receivables | Record payment | Select invoice → record payment | Payment applied, balance updates |
| 5.15 | Org Receivables | Fix calculations | Click "Fix Calculations" | Invoice amounts recalculated |
| 5.16 | Invoice History | View all | Click Invoice History | Complete invoice history with all statuses |
| 5.17 | Payment Requests | View requests | Click Instructor Payments | Pending org payment submissions |
| 5.18 | Payment Requests | Verify payment | Click approve/reject | Payment verified or rejected |
| 5.19 | Payment Verification | View pending | Click Payment Verification | Pending verifications listed |
| 5.20 | Payment Verification | Approve | Click approve | Payment approved |
| 5.21 | Payment Verification | View verified | Check verified tab | Previously verified payments shown |
| 5.22 | Payment Reversal | View reversible | Click Payment Reversal | Verified payments within 48-hour window |
| 5.23 | Payment Reversal | Reverse payment | Click reverse, enter reason | Payment reversed (only within 48h window) |
| 5.24 | Payment Reversal | Outside 48h | Try to reverse a payment older than 48h | Action blocked, error message |
| 5.25 | Vendor Invoices | View all | Click Vendor Invoices | All vendor invoices with payment totals |
| 5.26 | Vendor Invoices | Process payment | Select invoice → enter payment → submit | Payment recorded |
| 5.27 | Vendor Invoices | Reject | Click reject, enter notes | Invoice rejected |
| 5.28 | Paid Vendor Inv. | View paid | Click Paid Vendor Invoices | Paid vendor invoices listed |
| 5.29 | Navigation | All 13 menu items | Click each menu item | Each loads correctly |

---

## 6. Super Admin Portal (`admin` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 6.1 | Organizations | View list | Click Organizations | All organizations listed |
| 6.2 | Organizations | Create org | Click Create, fill name/email/phone → Save | Organization created |
| 6.3 | Organizations | Edit org | Click edit, modify fields → Save | Organization updated |
| 6.4 | Users | View list | Click Users | Paginated user list with role filter |
| 6.5 | Users | Search | Enter search term | Filtered results |
| 6.6 | Users | Create user | Click Create, fill all fields → Save | User created with correct role |
| 6.7 | Users | Edit user | Click edit, change fields → Save | User updated |
| 6.8 | Users | Reset password | Click reset password, enter new | Password reset |
| 6.9 | Users | Assign to org | Edit user → select organization + location | User linked to org |
| 6.10 | Course Types | View list | Click Course Types | All course types listed |
| 6.11 | Course Types | Create | Click Create, fill name/duration → Save | Course type created |
| 6.12 | Course Types | Toggle active | Click activate/deactivate | Status toggles |
| 6.13 | Course Types | Delete | Click delete on unused course type | Course type removed |
| 6.14 | Pricing Rules | View rules | Click Pricing Rules | All org/course pricing rules |
| 6.15 | Pricing Rules | Create rule | Select org + course type + price → Save | Pricing rule created |
| 6.16 | Pricing Rules | Edit rule | Click edit, change price → Save | Price updated |
| 6.17 | Pricing Rules | Delete rule | Click delete | Rule removed |

---

## 7. System Admin Portal (`sysadmin` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 7.1 | Dashboard | View stats | Navigate to Dashboard | Total users, orgs, courses, vendors, recent activity |
| 7.2 | Course Mgmt | View courses | Click Course Management | All course types |
| 7.3 | Course Mgmt | CRUD | Create/edit/toggle/delete course type | All operations succeed |
| 7.4 | Organizations | View orgs | Click Organizations | All organizations |
| 7.5 | Organizations | CRUD | Create/edit organization | Operations succeed |
| 7.6 | Org Pricing | View pricing | Click Organization Pricing | All org pricing records |
| 7.7 | Org Pricing | CRUD | Create/edit/delete pricing rule | Operations succeed |
| 7.8 | User Mgmt | View users | Click User Management | Paginated, searchable, filterable by role |
| 7.9 | User Mgmt | Create user | Fill all fields including role → Save | User created |
| 7.10 | User Mgmt | Edit user | Change status to inactive | User deactivated |
| 7.11 | User Mgmt | Reset password | Select user → reset password | Password reset |
| 7.12 | User Mgmt | PIPEDA delete | Click PIPEDA anonymization | Personal data removed per privacy law |
| 7.13 | Vendor Mgmt | View vendors | Click Vendor Management | All vendors listed |
| 7.14 | Vendor Mgmt | CRUD | Create/edit/deactivate vendor | Operations succeed |
| 7.15 | Student Dir. | Search students | Click Student Directory → search | Students matching query shown |
| 7.16 | Student Dir. | View detail | Click on a student | Full profile + course history |
| 7.17 | Student Dir. | Update student | Edit student info → Save | Student updated |
| 7.18 | Student Dir. | Marketing consent | Toggle marketing consent | Consent updated with timestamp |
| 7.19 | Certifications | View stats | Click Certification Tracking | Active, expiring (30d/90d), expired counts |
| 7.20 | Certifications | View expiring | Check expiring tab | Certs expiring within 90 days listed |
| 7.21 | Certifications | View expired | Check expired tab | Expired certs listed |
| 7.22 | Sys Config | View configs | Click System Configuration | All config key-value pairs |
| 7.23 | Sys Config | Edit config | Change a config value → Save | Config updated |
| 7.24 | Sys Config | Filter by category | Select category filter | Configs filtered |
| 7.25 | Navigation | All 9 menu items | Click each menu item | Each loads correctly |

---

## 8. HR Portal (`hruser` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 8.1 | Dashboard | View stats | Navigate to Dashboard | Total instructors, pending timesheets, pending profile changes, org count |
| 8.2 | Personnel | View instructors | Click Personnel Management → Instructors tab | Instructor listing |
| 8.3 | Personnel | View organizations | Click Organizations tab | Organization listing |
| 8.4 | Personnel | Profile changes | Click Profile Changes tab | Pending profile change requests |
| 8.5 | Personnel | Approve change | Click approve on a profile change | Change applied |
| 8.6 | Personnel | Reject change | Click reject, enter comment | Change rejected |
| 8.7 | Timesheet Mgmt | View all | Click Timesheet Management | All timesheets (all instructors) |
| 8.8 | Timesheet Mgmt | Filter | Filter by status/instructor/month | Filtered results |
| 8.9 | Timesheet Mgmt | Approve | Click approve on pending timesheet | Timesheet approved |
| 8.10 | Timesheet Mgmt | Reject | Click reject, enter comment | Timesheet rejected |
| 8.11 | Timesheet Mgmt | Add HR note | Open timesheet → add note | Note appears in thread |
| 8.12 | Timesheet Mgmt | Send reminders | Click send reminders | Reminders sent to instructors without timesheets |
| 8.13 | Pay Rates | View tiers | Click Pay Rate Management → Tiers | Pay rate tiers listed |
| 8.14 | Pay Rates | Create tier | Click create, fill name/rate/bonus → Save | Tier created |
| 8.15 | Pay Rates | Edit tier | Modify tier → Save | Tier updated |
| 8.16 | Pay Rates | View instructor rates | Click Instructors tab | Instructor pay rates listed |
| 8.17 | Pay Rates | Set rate | Select instructor → set hourly rate + bonus | Rate assigned |
| 8.18 | Pay Rates | Bulk update | Select multiple instructors → bulk rate update | All selected updated |
| 8.19 | Payroll | View stats | Click Instructor Payroll | Monthly payroll stats |
| 8.20 | Payroll | Calculate payroll | Select instructor + date range → Calculate | Payroll calculation shown |
| 8.21 | Payroll | Create payment | Fill amount/method → Create | Payment created (pending) |
| 8.22 | Payroll | Process payment | Approve/reject pending payment | Payment processed |
| 8.23 | Payroll | View report | Generate payroll report | Report displayed |
| 8.24 | Returned Payments | View requests | Click Returned Payments | Returned payment requests listed |
| 8.25 | Returned Payments | Override approve | Click override approve, enter notes | Payment re-approved |
| 8.26 | Returned Payments | Final reject | Click final reject, enter notes | Payment finally rejected |
| 8.27 | Notifications | View | Click Notifications | Notification list |
| 8.28 | Notifications | Mark read | Click mark as read | Notification marked |
| 8.29 | Notifications | Mark all read | Click "Mark All Read" | All cleared |
| 8.30 | HR Reports | View | Click HR Reports | Placeholder page (future feature) |

---

## 9. Vendor Portal (`vendoruser` / `test123`)

| # | Menu Item | Test | Steps | Expected |
|---|-----------|------|-------|----------|
| 9.1 | Dashboard | View stats | Navigate to Dashboard | Pending invoices, total invoices, total paid, avg payment time |
| 9.2 | Upload Invoice | View form | Click Upload Invoice | Invoice submission form |
| 9.3 | Upload Invoice | Submit invoice | Fill invoice #, amount, description, date → Submit | Invoice created + submitted to admin |
| 9.4 | Upload Invoice | Attach PDF | Upload a PDF file with the invoice | File attached and validated |
| 9.5 | Invoice Mgmt | View all | Click Invoice Management | All own invoices listed |
| 9.6 | Invoice Mgmt | View detail | Click on an invoice | Detail with payment history |
| 9.7 | Invoice Mgmt | Download PDF | Click download | Invoice PDF downloads |
| 9.8 | Invoice Mgmt | Resend rejected | Click resend on rejected invoice, enter notes | Invoice resubmitted to admin |
| 9.9 | Invoice Status | View pipeline | Click Invoice Status | Invoices grouped by status stage |
| 9.10 | Paid Invoices | View paid | Click Paid Invoices | Only paid invoices shown |
| 9.11 | Profile | View profile | Click Profile | Vendor details (matched by email) |
| 9.12 | Profile | Update profile | Change vendor name/phone/address → Save | Profile updated |
| 9.13 | Navigation | All 6 menu items | Click each menu item | Each loads correctly |

---

## 10. Cross-Portal Workflows

| # | Workflow | Steps | Expected |
|---|----------|-------|----------|
| 10.1 | Course lifecycle | orguser schedules → courseadmin assigns instructor → instructor teaches + marks complete → courseadmin marks ready for billing → accountant creates invoice → accountant approves → accountant posts to org → orguser pays | Full lifecycle completes without errors |
| 10.2 | Timesheet lifecycle | instructor submits timesheet → hruser reviews → approves/rejects → instructor sees result | Status flows correctly |
| 10.3 | Payroll lifecycle | hruser calculates payroll → creates payment → processes (approve) | Payment completed |
| 10.4 | Vendor invoice lifecycle | vendoruser uploads invoice → courseadmin approves → accountant processes payment | Vendor paid |
| 10.5 | Payment verification | orguser submits payment → accountant verifies → (optional) reverses within 48h | Full payment flow |
| 10.6 | Multi-tab safety | Login as orguser in tab 1, login as instructor in tab 2 | Each tab maintains correct session |

---

## 11. UI/UX Checks (All Portals)

| # | Check | Expected |
|---|-------|----------|
| 11.1 | Sidebar navigation | All menu items clickable, active item highlighted |
| 11.2 | Page title updates | Header shows correct eyebrow + title per view |
| 11.3 | Loading states | Spinner/skeleton shown while data loads |
| 11.4 | Empty states | Appropriate message when no data (e.g., "No courses found") |
| 11.5 | Error handling | API errors show user-friendly messages |
| 11.6 | Responsive layout | Sidebar collapses on mobile |
| 11.7 | Theme toggle | Dark/light mode switches correctly |
| 11.8 | User name display | User's full name shown in sidebar/header |
| 11.9 | Pagination | Tables with many rows paginate correctly |
| 11.10 | Sort/filter | Table columns sortable, filters work |

---

**Total test cases: 175**
