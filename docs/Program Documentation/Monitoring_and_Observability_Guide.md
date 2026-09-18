# CPR Training Management System - Monitoring and Observability Guide

**Date**: 2026-06-28
**App**: https://cpr.kpbc.ca (Production), https://stagecprapp.kpbc.ca (Staging)
**Stack**: Fastify 5 + React on TMD Hosting (LiteSpeed + Passenger, Node.js)

---

## 1. Overview

The CPR Training Management System uses a layered monitoring approach combining health checks, application metrics, error tracking, structured logging, and audit trails. The current tooling includes:

| Layer | Tool | Purpose |
|-------|------|---------|
| Uptime monitoring | UptimeRobot | Polls health endpoint every 5 minutes; alerts on downtime |
| Error tracking | Sentry (`@sentry/node` v10) | Captures unhandled 500 errors with request context |
| Application metrics | Custom `/metrics` endpoint | Tracks request counts, error rate, latency, slow requests |
| Structured logging | Pino (JSON logger) | HTTP access logs, error logs, slow request warnings |
| Audit trail | `audit_logs` table + AuditLogViewer | Records security-relevant user actions |
| Scheduled jobs | Node.js timers + cron | Cert reminders, auto-deploy, database backups |

All monitoring is passive (poll-based or log-based). There is no active alerting pipeline (e.g., PagerDuty) beyond UptimeRobot email notifications. See Section 9 for the improvement plan.

---

## 2. Health Endpoint

**Endpoint**: `GET /health`
**Authentication**: None (public)
**Source**: `backend/src/app.ts` (lines 101-113)

### What It Checks

The health endpoint verifies database connectivity by executing `SELECT 1` against the MySQL connection pool. This confirms both the application process and the database are responsive.

### Response Format

**Healthy (HTTP 200)**:
```json
{
  "status": "UP",
  "database": "UP",
  "timestamp": "2026-06-28T14:30:00.000Z"
}
```

**Degraded (HTTP 503)**:
```json
{
  "status": "DEGRADED",
  "database": "DOWN",
  "timestamp": "2026-06-28T14:30:00.000Z"
}
```

### How It Is Used

- **UptimeRobot** polls `https://cpr.kpbc.ca/api/v1/health` every 5 minutes.
- A non-200 response or timeout triggers a DOWN alert to `kpbcma@gmail.com`.
- During incident response, `curl -s https://cpr.kpbc.ca/api/v1/health` is the first diagnostic step (see `docs/Incident_Response.md`, Step 1).

> **Note**: The health endpoint is registered at `/health` on the Fastify instance but is accessible at `/api/v1/health` due to Passenger/LiteSpeed proxy configuration. UptimeRobot uses the `/api/v1/health` path.

---

## 3. Metrics Endpoint

**Endpoint**: `GET /metrics`
**Authentication**: None (public)
**Source**: `backend/src/plugins/metrics.ts`

### What It Tracks

The metrics plugin attaches an `onResponse` hook to every request and accumulates counters in memory. The `/metrics` endpoint returns a snapshot of these counters.

**Sample response**:
```json
{
  "uptime_seconds": 86400,
  "requests": {
    "total": 12450,
    "errors": 3,
    "error_rate": 0.02
  },
  "latency": {
    "avg_ms": 45,
    "max_ms": 3200,
    "slow_requests": 2,
    "slow_threshold_ms": 2000
  },
  "timestamp": "2026-06-28T14:30:00.000Z"
}
```

| Field | Description |
|-------|-------------|
| `uptime_seconds` | Seconds since the metrics bucket was last reset (process start) |
| `requests.total` | Total HTTP requests served since startup |
| `requests.errors` | Count of responses with HTTP status >= 500 |
| `requests.error_rate` | Percentage of 500+ responses (`errors / total * 100`) |
| `latency.avg_ms` | Average response time in milliseconds |
| `latency.max_ms` | Maximum single-request response time |
| `latency.slow_requests` | Count of requests exceeding the slow threshold |
| `latency.slow_threshold_ms` | Threshold for slow request detection (hardcoded at 2000 ms) |

### How to Interpret the Data

- **Error rate below 0.1%**: Normal operation.
- **Error rate above 1%**: Investigate immediately. Check Sentry for new exception types and application logs for stack traces.
- **Average latency under 100 ms**: Normal for this application on shared hosting.
- **Average latency above 500 ms**: Possible database contention, resource throttling (LVE limits), or a runaway query.
- **Max latency above 5000 ms**: A single very slow request occurred. Check logs for the `Slow request detected` warning to identify the route.
- **Slow request count increasing steadily**: Systemic performance degradation. Check cPanel Resource Usage for CPU/RAM limits and `SHOW PROCESSLIST` in phpMyAdmin for long-running queries.

### When to Be Concerned

| Indicator | Threshold | Action |
|-----------|-----------|--------|
| Error rate > 1% | Sustained over 5 minutes | Check Sentry, review recent deploys |
| Avg latency > 500 ms | Sustained | Check LVE limits, database processlist |
| Max latency > 10,000 ms | Single occurrence | Identify the route from logs, check for table locks |
| Slow request count > 10 | In a short time window | Possible DB issues or resource exhaustion |

> **Important**: Metrics are held in memory and reset when the process restarts. After a Passenger restart (`touch tmp/restart.txt`), all counters return to zero.

---

## 4. UptimeRobot

**Dashboard**: Configured under the UptimeRobot account linked to `kpbcma@gmail.com`
**Source reference**: `TODO.md` (OPS-1)

### Configuration

| Setting | Value |
|---------|-------|
| Monitor type | HTTP(s) |
| URL | `https://cpr.kpbc.ca/api/v1/health` |
| Monitoring interval | 5 minutes |
| Alert contact | `kpbcma@gmail.com` |
| Expected response | HTTP 200 |

### What It Detects

- **Site completely down**: Passenger crashed, LiteSpeed down, DNS failure, SSL certificate expired.
- **Database unreachable**: Health endpoint returns HTTP 503 with `"status": "DEGRADED"`.
- **Timeout**: Application is alive but too slow to respond within UptimeRobot's timeout window.

### What It Does NOT Detect

- Partial failures (e.g., a single API route returning 500 while others work).
- Elevated error rates or degraded performance below the timeout threshold.
- Authentication or authorization issues.
- Email delivery failures.

### Responding to UptimeRobot Alerts

When you receive a DOWN notification:

1. Follow the Incident Response Runbook (`docs/Incident_Response.md`), starting with the Diagnosis Checklist.
2. Check the health endpoint manually: `curl -s https://cpr.kpbc.ca/api/v1/health`
3. Check metrics for error spikes: `curl -s https://cpr.kpbc.ca/metrics`
4. Proceed through Sentry, Passenger logs, MySQL, and LVE limits as documented.

---

## 5. Sentry Error Monitoring

**SDK**: `@sentry/node` v10
**Configuration**: `backend/src/index.ts` (lines 9-22)
**Error capture**: `backend/src/plugins/errorHandler.ts`

### Initialization

Sentry initializes on application startup if the `SENTRY_DSN` environment variable is set (configured in production `.htaccess`). The import is dynamic and fails gracefully if the `@sentry/node` package is not installed.

```typescript
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: 0.1,  // 10% of transactions sampled for performance
});
```

### What It Captures

Every unhandled error that reaches the global error handler (HTTP 500 responses) is reported to Sentry with:

- The exception object (message + stack trace)
- Request URL and HTTP method (via `extra` context)
- Environment tag (production vs. development)

Errors with status codes below 500 (400, 401, 403, 404, 429) are NOT sent to Sentry -- they are expected application responses.

### How to Access

1. Open the Sentry project dashboard (linked via the `SENTRY_DSN` in the production `.htaccess` file).
2. Navigate to **Issues** to see grouped error types.
3. Each issue shows the error message, stack trace, frequency, and first/last seen timestamps.

### What to Look For

| Signal | Meaning |
|--------|---------|
| New error type appears | Likely caused by a recent deploy. Compare the first-seen timestamp with `git log`. |
| Error frequency spike | A previously rare error is now occurring frequently. Possible data issue or edge case triggered by new data. |
| Error correlates with specific route | A single endpoint is broken. Check the route handler and any recent changes. |
| `ECONNREFUSED` or DB errors | Database connectivity issue. Check MySQL status in cPanel. |

---

## 6. Application Logging

### Logger Setup

**Library**: Pino (structured JSON logging)
**Source**: `backend/src/config/logger.ts`

```typescript
export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

| Environment | Log level | Format |
|-------------|-----------|--------|
| Production | `info` | JSON (machine-readable) |
| Development | `debug` | Pretty-printed with colors (human-readable) |

### Where Logs Are Stored

Logs are written to **stdout**. On TMD Hosting, Passenger captures stdout from the Node.js process and routes it to the LiteSpeed error log.

### How to Access Logs

| Method | Steps |
|--------|-------|
| **cPanel UI** | Login to cPanel > Metrics > Errors. Shows recent LiteSpeed/Passenger error log entries. |
| **SSH** | `ssh kaizenmo@<server>` then check the LiteSpeed error log path (typically `/home/kaizenmo/logs/error.log` or similar). |
| **cPanel Terminal** | Use the cPanel browser-based terminal if SSH is unavailable. |

### What Is Logged

#### HTTP Access Logs (every request)

Logged via an `onResponse` hook in `backend/src/app.ts` (lines 73-90). Every request produces a structured log entry:

```json
{
  "reqId": "req-1234",
  "method": "POST",
  "url": "/api/v1/auth/login",
  "statusCode": 200,
  "duration": 45,
  "userId": 12
}
```

- Requests with status >= 400 are logged at `warn` level.
- All other requests are logged at `info` level.
- The `reqId` field is a correlation ID, also returned in the `x-request-id` response header for client-side tracing.

#### Slow Request Warnings

When any request takes longer than 2000 ms, the metrics plugin logs a warning at `warn` level (source: `backend/src/plugins/metrics.ts`, lines 44-51):

```json
{
  "method": "GET",
  "url": "/api/v1/sysadmin/analytics",
  "statusCode": 200,
  "duration": 3200,
  "msg": "Slow request detected"
}
```

#### Error Logs

Unhandled errors (500s) are logged at `error` level with the full error object, URL, and method (source: `backend/src/plugins/errorHandler.ts`, line 33).

#### Email Send Results

The `EmailService` logs structured results for every email send attempt, including success/failure status and recipient information.

#### Certification Reminder Results

The `CertReminderService` logs a summary after each batch run (source: `backend/src/services/CertReminderService.ts`, line 70):

```json
{
  "sent": 5,
  "skipped": 0,
  "errors": 1,
  "msg": "Certification reminders batch complete"
}
```

Individual send failures are logged at `error` level with the recipient email.

#### Audit Log Write Failures

If writing to the `audit_logs` table fails (e.g., database issue), a `warn`-level log is emitted by `backend/src/utils/auditLog.ts`.

---

## 7. Audit Logs

**Source**: `backend/src/utils/auditLog.ts`
**Storage**: `audit_logs` MySQL table (created in migration v13)

### What Events Are Logged

The `logAudit()` function is called throughout the application to record security-relevant actions. Each entry includes:

| Field | Description |
|-------|-------------|
| `user_id` | ID of the user performing the action |
| `username` | Username of the actor |
| `action` | Type of action performed |
| `entity_type` | Type of entity affected (e.g., `user`, `organization`) |
| `entity_id` | ID of the affected entity |
| `details` | JSON object with additional context |
| `ip_address` | Client IP address |
| `created_at` | Timestamp (auto-set by database) |

**Audited actions include**:

- Login (successful)
- Logout
- Password change
- User creation, update, and deletion (CRUD)
- Other sysadmin operations on users and organizations

### How to View Audit Logs

#### Via the Sysadmin Portal UI

The **AuditLogViewer** component in the sysadmin portal provides:

- Paginated log table with filters (by action, user, date range)
- Stats endpoint showing action counts and recent activity
- CSV export of filtered results

#### Via the API

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/sysadmin/audit-logs` | Paginated list with query filters |
| `GET /api/v1/sysadmin/audit-logs/stats` | Aggregate statistics (action counts, recent activity) |
| `GET /api/v1/sysadmin/audit-logs/export/csv` | CSV download (up to 10,000 records) |

All audit log endpoints require sysadmin role authentication.

### Retention

Audit log entries are stored indefinitely in the database. There is no automated purge or rotation. As the table grows, consider:

- Adding an index on `created_at` if query performance degrades on the stats/filter endpoints.
- Implementing a retention policy (e.g., archive entries older than 2 years) aligned with the PIPEDA compliance requirements documented in `TODO.md`.

### Design Notes

The `logAudit()` function is fire-and-forget: it does not `await` the database insert and never throws. If the insert fails (e.g., database is down), the failure is logged via Pino at `warn` level but does not affect the user's request. This ensures audit logging never degrades application availability.

---

## 8. Scheduled Jobs

### 8.1 Certification Reminder Service

**Source**: `backend/src/services/CertReminderService.ts`, scheduled in `backend/src/index.ts`
**Schedule**: First run 60 seconds after application startup, then every 24 hours

| Parameter | Value |
|-----------|-------|
| Initial delay | 60,000 ms (60 seconds) |
| Interval | 86,400,000 ms (24 hours) |
| Reminder windows | 30, 60, and 90 days before certificate expiry |
| Batch limit | 100 students per reminder window per run |
| Deduplication | `certification_reminders` table prevents duplicate sends |

**What it does**: Queries `course_students` for certificates expiring within 30, 60, or 90 days that have not yet received a reminder for that window. Sends an email via the `EmailService` and records the send in the `certification_reminders` table.

**How to monitor**: Check application logs for the `Certification reminders batch complete` message. The log entry includes `sent`, `skipped`, and `errors` counts. A manual trigger is available via `POST /api/v1/certifications/send-reminders`.

**Failure behavior**: If the entire batch fails (e.g., database error), the error is caught and logged at `error` level. Individual email failures are also logged. The service does not crash the application.

### 8.2 Auto-Deploy Cron

**Schedule**: Hourly at `:18` (e.g., 1:18, 2:18, ...)
**Script**: `/home/kaizenmo/deploy-production.sh` (production), `/home/kaizenmo/deploy-staging.sh` (staging)

The cron job pulls the latest `master` branch from GitHub, runs `tsc` to compile TypeScript, deploys the built output, and restarts Passenger via `touch tmp/restart.txt`.

**How to monitor**: Check `git log --oneline -5` on the server to see the most recent commits. If a deploy introduced a bug, the Incident Response Runbook covers rollback procedures.

### 8.3 Database Backup Cron

**Schedule**: Daily at 2:00 AM
**Script**: `/home/kaizenmo/backup-cpr.sh`
**Retention**: 7-day rotation (older backups are deleted automatically)

The cron runs `mysqldump` on the `kaizenmo_cpr` database and stores compressed backups on the server.

**How to monitor**: Check for the existence of recent backup files on the server. The backup log should show successful runs.

**Known gap**: Both the database and its backups reside on the same TMD server. If the server fails, backups are lost. Offsite backup (S3/B2/FTP) is tracked as `BACKUP-2` in `TODO.md`.

---

## 9. Alerting Gaps and Improvement Plan

The current monitoring setup provides basic visibility but has several gaps that should be addressed as the system scales to multiple paying customers.

### Current Gaps

| Gap | Risk | Impact |
|-----|------|--------|
| **No PagerDuty/OpsGenie integration** | UptimeRobot only sends email. If the email is missed, downtime goes unnoticed. | Delayed incident response, especially outside business hours. |
| **No automated alerting on error rate spikes** | The `/metrics` endpoint must be manually checked. A sudden spike in 500 errors will only be caught via Sentry (if reviewed) or user reports. | Partial outages can persist for hours before detection. |
| **No database monitoring** | No visibility into connection pool utilization, query performance, slow queries, or table lock contention. | Database bottlenecks are invisible until they cause timeouts or 500 errors. |
| **No log aggregation** | Logs are in Passenger/LiteSpeed error logs on the server. No centralized log search or alerting. | Debugging requires SSH access; no proactive alerting on log patterns. |
| **No uptime monitoring for staging** | Only production is monitored by UptimeRobot. | Staging issues may go unnoticed, reducing confidence in pre-production testing. |
| **Metrics are in-memory only** | Counters reset on every Passenger restart. No historical data. | Cannot analyze trends or compare performance over time. |
| **No offsite backups** | Database backups are on the same server as the database (BACKUP-2). | Single point of failure for data recovery. |

### Recommendations for Scaling Monitoring

#### Short-Term (Before 5+ Customers)

1. **Add UptimeRobot monitor for staging**: Monitor `https://stagecprapp.kpbc.ca/api/v1/health` with the same 5-minute interval.
2. **Set up Sentry alerts**: Configure Sentry to send email notifications on new issue types and error frequency spikes (available in Sentry's built-in alert rules).
3. **Implement offsite backups (BACKUP-2)**: Push daily `mysqldump` output to S3, Backblaze B2, or an FTP destination after each successful backup run.
4. **Add a Sentry performance monitor**: The `tracesSampleRate` is already set to `0.1` (10%). Review the Sentry Performance dashboard for slow transactions.

#### Medium-Term (5-20 Customers)

5. **Integrate PagerDuty or OpsGenie**: Replace email-only alerting with an incident management platform that supports escalation, on-call schedules, and SMS/phone alerts.
6. **Persist metrics to a time-series store**: Export `/metrics` data to a service like Datadog, Grafana Cloud, or a self-hosted Prometheus instance. This enables historical trend analysis and threshold-based alerts.
7. **Add database connection pool monitoring**: Log pool statistics (active connections, idle connections, queue depth) periodically. The MySQL2 pool exposes these via `pool.pool` internals.
8. **Centralize logs**: Ship Pino JSON logs to a log aggregation service (e.g., Datadog Logs, Logtail, or Papertrail). Enable alerting on patterns like `Slow request detected` or `Unhandled error`.

#### Long-Term (20+ Customers / VPS Migration)

9. **Upgrade to VPS hosting**: TMD shared hosting limits (100 processes, 2 GB RAM, 2 CPU cores) constrain monitoring options. A VPS allows running Prometheus, Grafana, and dedicated log management.
10. **Implement synthetic monitoring**: Use tools like Checkly or Datadog Synthetics to run scripted browser tests (login, navigate, verify data) on a schedule, catching functional regressions that health checks miss.
11. **Add application performance monitoring (APM)**: Sentry APM or Datadog APM for distributed tracing, database query profiling, and per-endpoint latency breakdowns.
12. **Establish SLOs and error budgets**: Define service-level objectives (e.g., 99.9% uptime, p95 latency < 500 ms) and track them with dashboards. Use error budgets to balance feature velocity with reliability work.

---

## 10. Quick Reference

### Key URLs

| Resource | URL / Path |
|----------|------------|
| Health endpoint | `https://cpr.kpbc.ca/api/v1/health` |
| Metrics endpoint | `https://cpr.kpbc.ca/metrics` |
| Sentry dashboard | Linked via `SENTRY_DSN` in `.htaccess` |
| UptimeRobot dashboard | Configured for `kpbcma@gmail.com` |
| OpenAPI docs | `https://cpr.kpbc.ca/api/v1/docs` |

### Key Files

| File | Purpose |
|------|---------|
| `backend/src/app.ts` | Health endpoint, HTTP access logging, correlation IDs |
| `backend/src/plugins/metrics.ts` | Request/error/latency metrics collection and `/metrics` endpoint |
| `backend/src/plugins/errorHandler.ts` | Global error handler, Sentry error capture |
| `backend/src/config/logger.ts` | Pino logger configuration |
| `backend/src/utils/auditLog.ts` | Fire-and-forget audit log writer |
| `backend/src/services/CertReminderService.ts` | Certification expiry reminder scheduler |
| `backend/src/index.ts` | Sentry initialization, cert reminder scheduling |
| `docs/Incident_Response.md` | Full incident response runbook |

### Diagnostic Commands

```bash
# Check if the application is healthy
curl -s https://cpr.kpbc.ca/api/v1/health

# View current metrics
curl -s https://cpr.kpbc.ca/metrics | python3 -m json.tool

# Check recent commits (on server)
cd /home/kaizenmo/cpr.kpbc.ca-src && git log --oneline -5

# Restart Passenger
cd /home/kaizenmo/cpr.kpbc.ca && touch tmp/restart.txt

# Verify restart
curl -s https://cpr.kpbc.ca/api/v1/health
```
