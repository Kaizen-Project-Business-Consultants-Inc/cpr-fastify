# CPR Training Management System - Architecture Diagrams

**Last Updated**: 2026-06-28
**Stack**: Fastify 5 (Node.js 22) + React 18 + MySQL on TMD Hosting (LiteSpeed + Passenger)

This document provides text-based architecture diagrams using Mermaid syntax. Render these in any Mermaid-compatible viewer (GitHub, VS Code with Mermaid extension, mermaid.live, etc.).

---

## 1. System Architecture

High-level overview of all components and external services.

```mermaid
graph TB
    subgraph Client
        Browser["Browser (React SPA)"]
    end

    subgraph TMD["TMD Hosting Server"]
        LiteSpeed["LiteSpeed (HTTPS + .htaccess)"]
        Passenger["Phusion Passenger"]
        Fastify["Fastify 5 (Node.js 22)"]
        MySQL["MySQL Database"]
        StaticFiles["Static Files (public/)"]
    end

    subgraph External["External Services"]
        Resend["Resend (Email API)"]
        Sentry["Sentry (Error Tracking)"]
        UptimeRobot["UptimeRobot (Monitoring)"]
        GitHub["GitHub (Repo + CI/CD)"]
    end

    Browser -->|"HTTPS"| LiteSpeed
    LiteSpeed -->|"Static files"| StaticFiles
    LiteSpeed -->|"API requests"| Passenger
    Passenger -->|"Node.js process"| Fastify
    Fastify -->|"SQL queries"| MySQL
    Fastify -->|"Send emails"| Resend
    Fastify -->|"Report errors"| Sentry
    UptimeRobot -->|"GET /api/v1/health"| LiteSpeed
    GitHub -->|"FTPS deploy"| TMD
```

LiteSpeed terminates TLS and serves the frontend static files directly. API requests (`/api/v1/*`) are proxied through Passenger to the Fastify backend. The SPA fallback (`.htaccess` rewrite rules + Fastify `setNotFoundHandler`) ensures client-side routing works for deep links.

---

## 2. Backend Architecture

The backend follows a layered architecture: Routes handle HTTP concerns, Services contain business logic, and Repositories/direct queries handle data access.

```mermaid
graph TB
    subgraph Middleware["Middleware Layer"]
        Helmet["Helmet (Security Headers)"]
        CORS["CORS"]
        RateLimit["Rate Limiting"]
        Auth["JWT Authentication"]
        CSRF["CSRF Origin Check"]
        Multipart["Multipart (File Uploads)"]
        ReqId["Request ID (x-request-id)"]
    end

    subgraph Routes["Route Layer (23 route files)"]
        AuthR["auth"]
        HealthR["health"]
        CourseR["courses"]
        BillingR["accounting"]
        OrgR["organization"]
        HRR["hr"]
        InstrR["instructor"]
        AdminR["sysadmin"]
        CourseAdminR["courseadmin"]
        VendorR["vendor"]
        VendorAdminR["vendor-admin"]
        OrgBillingR["org-billing"]
        NotifR["notifications"]
        TimesheetR["timesheet"]
        PayRateR["pay-rates"]
        PayrollR["payroll"]
        StudentsR["student"]
        ProfileR["profile-changes"]
        PricingR["organization-pricing"]
        EmailTplR["email-templates"]
        CollegesR["colleges"]
        MiscR["misc"]
    end

    subgraph Services["Service Layer"]
        AuthS["AuthService"]
        BillingS["BillingService"]
        CourseS["CourseService"]
        EmailS["EmailService"]
        PDFS["PDFService"]
        HRS["HRService"]
        OrgS["OrganizationService"]
        InvNumS["InvoiceNumberService"]
        CertS["CertReminderService"]
    end

    subgraph Data["Data Layer"]
        Pool["MySQL Connection Pool"]
        Migrations["Migration System"]
        DB[("MySQL Database")]
    end

    subgraph Config["Configuration"]
        Env["env.ts (environment)"]
        Logger["logger.ts (Pino)"]
        DbConfig["database.ts (pool)"]
        MigConfig["migrations.ts"]
    end

    subgraph Plugins["Plugins"]
        ErrHandler["errorHandler"]
        Metrics["metrics (/metrics)"]
        Swagger["swagger (/api/v1/docs)"]
        AuditLog["auditLogger"]
    end

    Middleware --> Routes
    Routes --> Services
    Services --> Pool
    Pool --> DB
    Migrations -->|"auto-run on startup"| DB
```

### Route Registration

All routes are registered under the `/api/v1` prefix via `routes/index.ts`. The route file also registers:
- `POST /client-errors` -- client-side error collector (rate-limited, unauthenticated)
- `GET /events` -- SSE endpoint for real-time updates (authenticated)
- OpenAPI docs at `/api/v1/docs` via `@fastify/swagger`

### Middleware Chain

Every request passes through the following middleware (in order):
1. **Helmet** -- security headers (CSP, HSTS, X-Frame-Options)
2. **CORS** -- restricts to `FRONTEND_URL` origin, credentials allowed
3. **Rate Limiting** -- 100 req/min global; tighter limits on auth routes (20 req/15min)
4. **CSRF** -- verifies `Origin` header on POST/PUT/PATCH/DELETE
5. **Request ID** -- assigns `x-request-id` (from header or generated UUID)
6. **Cookie** -- parses cookies for refresh token handling
7. **JWT Auth** -- `requireAuth` middleware on protected routes; extracts `userId`, `userRole`, `userOrgId`

---

## 3. Frontend Architecture

React SPA with role-based portal routing, context providers, and lazy-loaded portal chunks.

```mermaid
graph TB
    subgraph Providers["Context Providers"]
        Theme["ThemeContext (Dark Mode)"]
        AuthCtx["AuthContext (JWT + User State)"]
        QueryClient["React Query (Server State)"]
        Snackbar["SnackbarContext"]
        Realtime["RealtimeContext (SSE)"]
        Notification["NotificationContext"]
    end

    subgraph Router["Router Layer"]
        RoleRouter["RoleBasedRouter"]
        PrivateRoute["PrivateRoute (role guard)"]
    end

    subgraph Portals["8 Role-Based Portals"]
        Instructor["InstructorPortal"]
        Organization["OrganizationPortal"]
        CourseAdmin["CourseAdminPortal"]
        SuperAdmin["SuperAdminPortal"]
        Accounting["AccountingPortal"]
        SystemAdmin["SystemAdminPortal"]
        HR["HRPortal"]
        Vendor["VendorPortal"]
    end

    subgraph Shared["Shared Components (GTACPR Design System)"]
        AdminShell["AdminShell (Layout + Sidebar)"]
        DataTable["DataTable"]
        PageHeader["PageHeader"]
        StatusChip["StatusChip"]
        SearchBar["SearchBar"]
        DateRange["DateRangeFilter"]
        StatCard["StatCard"]
        DetailDrawer["DetailDrawer"]
        ExportCSV["Export CSV"]
    end

    subgraph Pages["Public Pages"]
        Login["Login"]
        ForgotPw["ForgotPassword"]
        ResetPw["ResetPassword"]
        Privacy["PrivacyPolicy"]
        Terms["TermsOfService"]
    end

    Providers --> Router
    Router -->|"role check"| PrivateRoute
    PrivateRoute -->|"lazy load"| Portals
    Portals --> Shared
    Router --> Pages
```

### Portal Roles

| Portal | Role Key | URL Prefix | Description |
|--------|----------|------------|-------------|
| Instructor | `instructor` | `/instructor/*` | Class management, attendance, timesheets |
| Organization | `organization` | `/organization/*` | Course requests, roster, billing |
| Course Admin | `admin` | `/admin/*` | Course scheduling, instructor assignment |
| Super Admin | `superadmin` | `/superadmin/*` | System-wide admin controls |
| Accounting | `accountant` | `/accounting/*` | Invoicing, payments, revenue reports |
| System Admin | `sysadmin` | `/sysadmin/*` | Users, orgs, courses, students, certs, audit logs, WSIB |
| HR | `hr` | `/hr` | Employee management, pay rates |
| Vendor | `vendor` | `/vendor/*` | Vendor invoices, profile |

All portals are **lazy-loaded** via `React.lazy()` and wrapped in `Suspense` with a loading spinner. Each portal is protected by `PrivateRoute` which checks the user's JWT role claim.

---

## 4. Database Architecture

Simplified ERD showing the main entities and their relationships.

```mermaid
erDiagram
    users ||--o{ course_requests : "creates"
    users ||--o{ course_students : "instructs (as instructor)"
    users }o--|| organizations : "belongs to"

    organizations ||--o{ course_requests : "requests"
    organizations ||--o{ invoices : "billed to"
    organizations ||--o{ students : "has"
    organizations ||--o{ organization_pricing : "has pricing"
    organizations ||--o{ invoice_number_sequences : "has sequences"

    course_requests ||--o{ course_students : "enrolls"
    course_requests }o--|| class_types : "is type of"
    course_requests }o--o| users : "assigned instructor"

    students ||--o{ course_students : "enrolled in"

    course_students }o--o| students : "linked to master"

    invoices ||--o{ payments : "receives"
    invoices }o--|| organizations : "billed to"
    invoices }o--|| course_requests : "for course"

    class_types {
        int id PK
        string name
        int duration_minutes
        int max_students
        int certification_validity_months
    }

    users {
        int id PK
        string username
        string email
        string password_hash
        string role
        int organization_id FK
        string status
    }

    organizations {
        int id PK
        string name
        string contact_email
        string status
    }

    course_requests {
        int id PK
        int organization_id FK
        int class_type_id FK
        int instructor_id FK
        date course_date
        string status
    }

    students {
        int id PK
        string email
        string first_name
        string last_name
        int organization_id FK
        boolean marketing_consent
    }

    course_students {
        int id PK
        int course_request_id FK
        int student_id FK
        string attendance_status
        string certificate_number
        datetime issued_at
        datetime expires_at
    }

    invoices {
        int id PK
        string invoice_number
        int organization_id FK
        int course_request_id FK
        decimal amount
        string status
        datetime email_sent_at
    }

    payments {
        int id PK
        int invoice_id FK
        decimal amount
        string payment_method
        datetime payment_date
    }
```

### Additional Tables (Not Shown)

- `schema_migrations` -- tracks applied database migrations
- `token_blacklist` -- invalidated JWT tokens (on password change/logout)
- `audit_logs` -- audit trail for sensitive actions
- `notification_preferences` / `notifications` -- user notification settings
- `vendor_invoices` -- vendor billing
- `instructor_pay_rates` / `pay_rate_history` -- instructor compensation
- `organization_pricing` -- per-org pricing overrides
- `invoice_number_sequences` -- configurable invoice number formats per org
- `email_reminders` / `certification_reminders` -- dedup tables for reminder emails
- `profile_changes` -- instructor profile change requests

---

## 5. Authentication Flow

JWT-based authentication with access and refresh tokens.

```mermaid
sequenceDiagram
    participant Browser
    participant Fastify
    participant AuthService
    participant MySQL

    Note over Browser,MySQL: Login Flow
    Browser->>Fastify: POST /api/v1/auth/login {username, password}
    Fastify->>AuthService: authenticate(username, password)
    AuthService->>MySQL: SELECT user WHERE username = ?
    MySQL-->>AuthService: user record
    AuthService->>AuthService: bcrypt.compare(password, hash)
    AuthService->>AuthService: Check account lockout (10 attempts / 15 min)
    AuthService->>AuthService: Sign JWT access token (15 min expiry)
    AuthService->>AuthService: Sign JWT refresh token (7 day expiry)
    AuthService-->>Fastify: {accessToken, refreshToken, user}
    Fastify-->>Browser: 200 OK + Set-Cookie (refresh token, httpOnly)

    Note over Browser,MySQL: Authenticated Request
    Browser->>Fastify: GET /api/v1/courses (Authorization: Bearer <accessToken>)
    Fastify->>Fastify: requireAuth middleware
    Fastify->>Fastify: Verify JWT signature + expiry
    Fastify->>MySQL: Check token_blacklist
    Fastify->>Fastify: Attach userId, userRole, userOrgId to request
    Fastify->>MySQL: Query courses WHERE org_id = userOrgId
    MySQL-->>Fastify: course data
    Fastify-->>Browser: 200 OK {data: [...]}

    Note over Browser,MySQL: Token Refresh
    Browser->>Fastify: POST /api/v1/auth/refresh (Cookie: refreshToken)
    Fastify->>AuthService: verifyRefreshToken(token)
    AuthService->>MySQL: Check token_blacklist
    AuthService->>AuthService: Sign new access token
    AuthService-->>Fastify: {accessToken}
    Fastify-->>Browser: 200 OK {accessToken}
```

### Key Security Features

- **Access tokens**: 15-minute expiry, sent as `Authorization: Bearer` header
- **Refresh tokens**: 7-day expiry, stored in httpOnly cookie
- **Account lockout**: 10 failed attempts triggers 15-minute lockout
- **Token blacklist**: Tokens are blacklisted on password change and logout
- **Bcrypt**: Password hashing with 12 salt rounds
- **Org scoping**: `userOrgId` from JWT is used in WHERE clauses to enforce multi-tenant isolation
- **Role middleware**: `requireRole('admin', 'sysadmin')` guards protect role-specific endpoints

---

## 6. Deployment Architecture

End-to-end flow from code commit to running application.

```mermaid
graph LR
    subgraph Dev["Developer"]
        Code["Code Changes"]
        LocalBuild["Local Frontend Build<br/>(vite build -- server OOM)"]
    end

    subgraph GitHub["GitHub"]
        Repo["cpr-fastify repo"]
        Actions["GitHub Actions CI/CD"]
    end

    subgraph CI["CI Pipeline"]
        TSC["TypeScript Check"]
        Vitest["Vitest Tests"]
        ViteBuild["Vite Build"]
        FTPSDeploy["FTPS Upload"]
    end

    subgraph TMD["TMD Hosting Server"]
        Cron["GitHub Actions deploy job"]
        DeployScript["FTPS upload + touch tmp/restart.txt"]
        LiteSpeed2["LiteSpeed + SSL"]
        Passenger2["Passenger"]
        Fastify2["Fastify 5"]
        MySQL2[("MariaDB 11.4")]
        Restart["touch tmp/restart.txt"]
    end

    Code -->|"git push"| Repo
    Repo -->|"on push to master"| Actions
    Actions --> TSC
    TSC --> Vitest
    Vitest --> ViteBuild
    ViteBuild --> FTPSDeploy
    FTPSDeploy -->|"backend/dist/ + public/"| TMD

    Cron -->|"hourly pull + build"| DeployScript
    DeployScript --> Restart

    FTPSDeploy --> Restart
    Restart --> Passenger2
    Passenger2 --> Fastify2
    Fastify2 -->|"runMigrations()"| MySQL2
    LiteSpeed2 --> Passenger2
```

### Deployment Paths

There are two deployment paths that can both be active:

1. **CI/CD (primary)**: Push to `master` -> GitHub Actions builds and tests -> FTPS upload to server -> restart Passenger -> health check
2. **Server cron (backup)**: Hourly at `:48`, the server pulls from `master`, builds via `tsc`, and restarts Passenger

### Server Architecture Detail

```mermaid
graph TB
    subgraph Internet
        Client["Client Browser"]
        UptimeRobot2["UptimeRobot"]
    end

    subgraph Server["TMD Server (LiteSpeed + LVE: 2GB RAM, 2 CPU, 100 procs)"]
        LiteSpeed3["LiteSpeed<br/>HTTPS termination<br/>HSTS + .htaccess"]

        subgraph AppDir["/home/kaizenmo/cpr.kpbc.ca/"]
            Public["public/<br/>(React SPA static files)"]
            ServerJS["server.js<br/>(Passenger entry point)"]
            BackendDist["backend/dist/<br/>(Compiled Fastify app)"]
            TmpRestart["tmp/restart.txt<br/>(Restart trigger)"]
            HtAccess[".htaccess<br/>(Env vars: DB, JWT, API keys)"]
        end

        Passenger3["Passenger App Server"]
        NodeJS["Node.js 22 Process"]
    end

    Client -->|"HTTPS :443"| LiteSpeed3
    UptimeRobot2 -->|"GET /api/v1/health<br/>every 5 min"| LiteSpeed3
    LiteSpeed3 -->|"Static files"| Public
    LiteSpeed3 -->|"/api/* requests"| Passenger3
    Passenger3 -->|"Manages lifecycle"| NodeJS
    ServerJS --> NodeJS
    NodeJS --> BackendDist
    HtAccess -->|"SetEnv"| NodeJS
    TmpRestart -->|"File change triggers"| Passenger3
```

### Environment Variables

All secrets are configured via `SetEnv` directives in `/home/kaizenmo/cpr.kpbc.ca/.htaccess`:

- `NODE_ENV`, `PORT`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`
- `FRONTEND_URL`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `SENTRY_DSN`
- `REDIS_ENABLED`, `BCRYPT_SALT_ROUNDS`
- `ACCESS_TOKEN_EXPIRY`, `REFRESH_TOKEN_EXPIRY`

These are never committed to the repository.
