# CPR Training Management System - Disaster Recovery Plan

**Application**: https://cpr.kpbc.ca
**Operated by**: KPBC (Kaizen Professional Business Consulting)
**Last Updated**: 2026-06-28
**Related Documents**: `docs/Incident_Response.md`, `docs/Customer_Offboarding.md`, `ROLLBACK.md`

---

## 1. Purpose and Scope

This document defines the disaster recovery (DR) procedures for the CPR Training Management System operated by KPBC at https://cpr.kpbc.ca. It covers:

- Recovery time and recovery point objectives
- Infrastructure context and known limitations
- Backup strategy and current gaps
- Step-by-step recovery procedures for common disaster scenarios
- Communication protocols during a disaster
- Testing schedule and improvement plan

This plan applies to the production environment. The staging environment (https://stagecprapp.kpbc.ca) is not covered by these DR procedures -- it can be rebuilt from the GitHub repository at any time.

---

## 2. RTO / RPO Targets

| Metric | Target | Notes |
|--------|--------|-------|
| **RTO -- Application** | 4 hours | Time to restore the web application to a functional state after a disaster is declared. |
| **RTO -- Database** | 1 hour | Time to restore the MariaDB database from backup and confirm data integrity. |
| **RPO** | 24 hours | Maximum acceptable data loss. Based on the daily backup cycle (2:00 AM). Any data written after the last backup and before the disaster may be lost. |

These targets reflect the current shared hosting infrastructure. They should be revisited if the system moves to a VPS or cloud environment (see Section 10).

---

## 3. Infrastructure Overview

| Component | Detail |
|-----------|--------|
| **Hosting provider** | TMD Hosting (shared hosting plan) |
| **Web server** | LiteSpeed with Phusion Passenger (serves Node.js) |
| **Application runtime** | Node.js with Fastify 5 |
| **Database** | MariaDB 11.4 (`kaizenmo_cpr` database, user `kaizenmo_cpruser`) |
| **Server account** | `/home/kaizenmo/` |
| **Application path** | `/home/kaizenmo/cpr.kpbc.ca/` |
| **Source code path** | `/home/kaizenmo/cpr.kpbc.ca-src/` |
| **LVE resource limits** | 100 concurrent processes, 2 GB RAM, 2 CPU cores |
| **SSL/TLS** | Managed by LiteSpeed; HSTS enabled |
| **DNS** | Managed via cPanel on TMD Hosting |
| **Email** | Resend API (sends from `noreply@kpbc.ca`) |
| **Monitoring** | UptimeRobot (health endpoint every 5 min), Sentry (error tracking) |
| **Source control** | GitHub -- `https://github.com/Kaizenpbc/cpr-fastify` |
| **CI/CD** | GitHub Actions on every push to `master`: lint, typecheck, tests, backend bundle + smoke test, FTPS deploy to staging and production with restart + health check, Playwright E2E. Nightly offsite backup workflow. No server-side deploy crons. |

### Known Infrastructure Limitations

- **Shared hosting**: No root access, no dedicated resources. TMD may throttle or kill processes if LVE limits are exceeded.
- **Single server**: Application, database, and backups all reside on the same physical server. A server-level failure would affect all three.
- **No automated failover**: There is no standby server or automatic failover mechanism.

---

## 4. Backup Strategy

### 4.1 Current Backup Configuration

| Item | Detail |
|------|--------|
| **Backup method** | `mysqldump` via shell script |
| **Script location** | `/home/kaizenmo/backup-cpr.sh` |
| **Schedule** | Daily at 2:00 AM (server time) via cron |
| **Retention** | 7-day rotation -- the 7 most recent daily backups are kept |
| **Backup format** | Compressed SQL dump (`.sql.gz`) |
| **Storage location** | On the TMD server under `/home/kaizenmo/backups/` (7 days) **and** offsite in Backblaze B2 bucket `GTA-CPR-Backups` (90 days) |
| **Offsite copy** | `.github/workflows/backup.yml` runs nightly at 03:30 UTC: downloads the newest dump, refuses it if older than 36 h, test-restores it into MariaDB 11.4, mirrors `uploads/vendor-invoices/`, copies both to B2, emails on failure. First verified run 2026-09-18. |

### 4.2 Source Code Backup

The application source code is stored in a GitHub repository (`https://github.com/Kaizenpbc/cpr-fastify`). This serves as a complete backup of all application code, configuration files (excluding secrets), database migration scripts, and deployment scripts.

Deploys are performed by GitHub Actions on every push to `master` (no server-side clone or cron is required any more).

### 4.3 What Is NOT Backed Up

- **Environment secrets**: Production environment variables are stored in `/home/kaizenmo/cpr.kpbc.ca/.htaccess` and are not committed to the repository. These include database credentials, Sentry DSN, SMTP credentials, and JWT secrets. A copy of these values must be maintained in a secure password manager.
- **Uploaded files**: Vendor invoice PDFs in `uploads/vendor-invoices/` live on the server filesystem and are copied offsite once a night by the backup workflow (up to 24 h of uploads could be lost in a total server failure).

### 4.4 Offsite Backup (implemented 2026-09-18)

Database dumps are copied to Backblaze B2 every night (see 4.1). Each copy is restored into a scratch MariaDB first, so a corrupt or empty dump fails the job and triggers an email instead of silently replacing a good backup. **RPO in a total server loss is therefore 24 hours** (last nightly dump). Backblaze credentials are stored only as GitHub Actions secrets (`B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET`); the key is restricted to the one bucket.

To restore from offsite: Backblaze console → Buckets → `GTA-CPR-Backups` → `db` → download `cpr_<date>.sql.gz`, then follow section 7.

---

## 5. Disaster Scenarios and Recovery Procedures

### Scenario 1: Application Crash

**Symptoms**: UptimeRobot DOWN alert; `GET /api/v1/health` fails or returns non-200; users see 502/503 errors.

**Likely causes**: Passenger process crash, out-of-memory kill, bad deployment, dependency error.

**Recovery steps**:

1. SSH into the server (or use cPanel Terminal).
2. Restart Passenger:
   ```bash
   cd /home/kaizenmo/cpr.kpbc.ca
   touch tmp/restart.txt
   ```
3. Verify recovery:
   ```bash
   curl -s https://cpr.kpbc.ca/api/v1/health
   ```
   Expected response: `{"status":"UP"}` with HTTP 200.
4. If the application does not recover, check LiteSpeed/Passenger error logs in cPanel under **Metrics > Errors**.
5. Look for `ENOMEM`, `MODULE_NOT_FOUND`, or `App ... crashed` messages.
6. Check LVE resource usage in cPanel -- if limits are being hit, see Scenario 6 in the Incident Response runbook.
7. If the crash is related to a recent deploy, proceed to Scenario 5 (Deployment Failure).

**Estimated recovery time**: 5-15 minutes.

### Scenario 2: Database Corruption

**Symptoms**: Application returns 500 errors on data operations; health endpoint reports DOWN; phpMyAdmin shows table errors or query failures.

**Likely causes**: Disk corruption, interrupted write operation, MariaDB crash during a transaction.

**Recovery steps**:

1. Confirm the issue by checking the health endpoint and attempting a simple query in phpMyAdmin (`SELECT 1;`).
2. Check if specific tables are affected: `CHECK TABLE table_name;` in phpMyAdmin for critical tables (`users`, `organizations`, `course_requests`, `invoices`).
3. If corruption is isolated to specific tables, attempt repair:
   ```sql
   REPAIR TABLE table_name;
   ```
4. If repair fails or corruption is widespread, perform a full database restore (see Section 6: Database Restore Procedure).
5. After restoration, restart Passenger:
   ```bash
   cd /home/kaizenmo/cpr.kpbc.ca
   touch tmp/restart.txt
   ```
6. Verify application functionality across key operations (login, course list, billing).
7. Document the data loss window: data written between the backup timestamp and the corruption event is lost.

**Estimated recovery time**: 30-60 minutes.

### Scenario 3: Server Failure (TMD)

**Symptoms**: Entire server unreachable; SSH, cPanel, and the application are all down; UptimeRobot DOWN alert with no recovery.

**Likely causes**: Hardware failure, data centre outage, hosting account suspension.

**Recovery steps**:

1. Confirm the outage is server-side by checking TMD's status page and attempting cPanel login.
2. Contact TMD Hosting support immediately via their client portal support ticket system or live chat at tmdhosting.com.
3. If TMD can restore the server:
   - Wait for TMD to bring the server back online.
   - Verify the application and database are intact.
   - Run `curl -s https://cpr.kpbc.ca/api/v1/health` to confirm.
4. If the server cannot be restored (total loss):
   - Request a new hosting account or VPS from TMD (or an alternative provider).
   - Restore application from GitHub:
     ```bash
     git clone https://github.com/Kaizenpbc/cpr-fastify.git
     ```
   - Rebuild the application: install Node.js dependencies, compile TypeScript, configure Passenger.
   - Restore environment variables from the password manager into `.htaccess`.
   - Restore the database from the most recent offsite backup in Backblaze B2 (`GTA-CPR-Backups/db`).
   - Update DNS records to point `cpr.kpbc.ca` to the new server IP.
   - Verify SSL certificate is provisioned (cPanel AutoSSL or Let's Encrypt).
   - Test all critical paths: login, course management, billing.

**Estimated recovery time**: 2-8 hours depending on TMD response time (offsite backups exist; data loss bounded by the last nightly dump).

### Scenario 4: Security Breach

**Symptoms**: Unauthorized access detected in audit logs; unexpected data changes; user reports of account compromise; Sentry alerts for unusual activity.

**Recovery steps**:

Follow the procedures defined in `docs/Incident_Response.md`, with the following DR-specific additions:

1. **Isolate**: Immediately change all credentials -- database password, JWT secret, SMTP credentials, API keys. Update `.htaccess` and restart Passenger.
2. **Assess scope**: Review the audit log (`GET /audit-logs`) to determine what data was accessed or modified. Check for unauthorized user accounts, role escalations, or data exports.
3. **Remediate**:
   - If data was modified maliciously, restore the database from the last known clean backup (see Section 6).
   - Invalidate all active user sessions by rotating the JWT secret.
   - Force password resets for all affected users.
4. **Notify**: Per PIPEDA requirements (and LEGAL-3 in the project roadmap), if personal information was compromised:
   - Notify the Office of the Privacy Commissioner of Canada.
   - Notify affected individuals.
   - Target notification within 72 hours of confirmed breach.
5. **Document**: Complete a post-incident report per the template in `docs/Incident_Response.md` Section 6.

**Estimated recovery time**: 1-4 hours for technical remediation; notification and reporting are ongoing.

### Scenario 5: Deployment Failure

**Symptoms**: Application breaks immediately after a deploy; new errors in Sentry; features stop working; health endpoint may or may not be affected.

**Likely causes**: Breaking code change merged to `master`; missing dependency; TypeScript compilation error not caught by CI; environment variable change.

**Recovery steps**:

1. Identify the bad commit:
   ```bash
   cd /home/kaizenmo/cpr.kpbc.ca-src
   git log --oneline -5
   ```
2. Revert the commit:
   ```bash
   git revert <bad-commit-hash>
   git push origin master
   ```
3. CI deploys the revert to staging and production automatically (about 10 minutes): `gh run watch` or https://github.com/Kaizenpbc/cpr-fastify/actions
4. If the app will not start after a deploy, see `ROLLBACK.md` ("If the app will not start after a deploy").
   Note: `dist-backup/` is overwritten on every deploy. If you may need it, copy it elsewhere first.
5. Verify recovery:
   ```bash
   curl -s https://cpr.kpbc.ca/api/v1/health
   ```
6. For detailed rollback procedures, see `ROLLBACK.md` in the project root.

**Estimated recovery time**: 5-20 minutes.

### Scenario 6: DNS or SSL Failure

**Symptoms**: Browser shows certificate warnings or "not secure" errors; domain does not resolve; HSTS errors prevent access.

**Likely causes**: SSL certificate expiry, DNS record misconfiguration, cPanel AutoSSL failure, domain registration lapse.

**Recovery steps**:

1. Check if the domain resolves:
   ```bash
   nslookup cpr.kpbc.ca
   ```
2. If DNS is not resolving, log in to cPanel and verify DNS zone records. Contact TMD support if records appear correct but resolution fails.
3. If DNS resolves but SSL is the issue:
   - Log in to cPanel.
   - Navigate to **SSL/TLS Status** or **AutoSSL**.
   - Check if the certificate has expired or failed to renew.
   - Run AutoSSL manually to re-issue the certificate.
   - If AutoSSL fails, contact TMD support to investigate.
4. If the domain registration has lapsed, renew it through the domain registrar immediately.
5. Verify HSTS headers are not causing caching issues in browsers. Users may need to clear their browser cache if they received an HSTS error.

**Estimated recovery time**: 15 minutes to 2 hours depending on root cause.

---

## 6. Database Restore Procedure

This section provides step-by-step instructions for restoring the MariaDB database from a daily backup.

### Step 1: Locate Backup Files

```bash
# SSH into the server or use cPanel Terminal
cd /home/kaizenmo/
ls -la cpr_*.sql.gz
```

Backup files follow the naming convention established by `backup-cpr.sh` with a 7-day rotation. Identify the most recent backup file before the incident.

### Step 2: Verify Backup Integrity

```bash
# Test that the compressed file is not corrupt
gunzip -t cpr_backup_YYYY-MM-DD.sql.gz
```

If the test passes with no output, the file is intact.

### Step 3: Decompress the Backup

```bash
gunzip -k cpr_backup_YYYY-MM-DD.sql.gz
# The -k flag keeps the original .gz file intact
```

### Step 4: Import the Backup

```bash
mysql -u kaizenmo_cpruser -p kaizenmo_cpr < cpr_backup_YYYY-MM-DD.sql
```

Enter the database password when prompted. The database password is stored in the `.htaccess` file and in the password manager.

For large databases, this may take several minutes. Do not interrupt the process.

### Step 5: Verify Data Integrity

1. Open phpMyAdmin via cPanel.
2. Select the `kaizenmo_cpr` database.
3. Verify critical tables exist and contain data:
   ```sql
   SELECT COUNT(*) FROM users;
   SELECT COUNT(*) FROM organizations;
   SELECT COUNT(*) FROM course_requests;
   SELECT COUNT(*) FROM invoices;
   SELECT COUNT(*) FROM students;
   ```
4. Verify the most recent records match expectations (compare dates against the backup timestamp).
5. Run a schema migration check to ensure all migrations have been applied:
   ```sql
   SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;
   ```

### Step 6: Restart the Application

```bash
cd /home/kaizenmo/cpr.kpbc.ca
touch tmp/restart.txt
```

### Step 7: Verify Application Functionality

```bash
curl -s https://cpr.kpbc.ca/api/v1/health
```

Log in via the browser and test key functions: user login, course listing, billing page load.

### Step 8: Document the Restore

Record the following in the post-incident report:

- Backup file used (filename and date)
- Data loss window (time between backup and incident)
- Any anomalies found during verification
- Time taken for the restore

---

## 7. Communication During a Disaster

Communication follows the severity levels and channels defined in `docs/Incident_Response.md`.

### Notification Matrix

| Audience | When to Notify | Channel |
|----------|---------------|---------|
| **Development team (George)** | Immediately on any disaster declaration | Direct message / email |
| **TMD Hosting support** | When the disaster involves server infrastructure, database, DNS, or SSL | Support ticket via TMD client portal or live chat |
| **Customers (Organization Admins)** | P1 outage lasting more than 30 minutes | Email to org admin contacts |
| **End users (all)** | Extended outage (2+ hours) or data loss event | Email; in-app banner after recovery |
| **Privacy Commissioner of Canada** | Confirmed breach of personal information | Formal notification per PIPEDA |

### Status Update Cadence

- **P1 (Critical)**: Post updates every 15 minutes until resolved.
- **P2 (Degraded)**: Post updates every hour until resolved.
- **Post-recovery**: Send an all-clear message with a brief explanation of what happened and any impact on data.

### Data Loss Communication

If the RPO is exceeded (data loss occurs), communicate the following to affected customers:

- The time window of data that may have been lost.
- Which types of data are affected (e.g., course requests submitted between 2:00 AM and the incident time).
- Steps customers should take (e.g., re-submit course requests, verify student rosters).

---

## 8. Testing Schedule

Regular testing validates that recovery procedures work and that backups are restorable.

### Quarterly: Backup Restore Test

**Frequency**: Every 3 months (January, April, July, October).

**Procedure**:

1. Download the most recent production backup file.
2. Restore it to the staging database (`stagecprapp.kpbc.ca`).
3. Verify data integrity using the checks in Section 6, Step 5.
4. Confirm the staging application functions correctly against the restored data.
5. Document the test: date, backup file used, time to restore, any issues found.

### Annually: Full DR Drill

**Frequency**: Once per year.

**Procedure**:

1. Simulate a total application failure on the staging environment.
2. Execute the full recovery process: clone from GitHub, restore database from backup, configure environment, verify functionality.
3. Measure actual RTO and RPO achieved.
4. Compare against targets (4-hour application RTO, 1-hour database RTO, 24-hour RPO).
5. Document findings and update this plan with any process improvements.

### After Every Significant Change

After major infrastructure changes (hosting migration, database engine upgrade, new backup mechanism), perform an ad-hoc backup restore test to validate the new configuration.

---

## 9. Roles and Responsibilities

| Role | Responsibilities |
|------|-----------------|
| **System Administrator (George)** | Declare disaster, execute recovery procedures, communicate with TMD support, notify stakeholders, write post-incident report |
| **TMD Hosting Support** | Server-level recovery, infrastructure troubleshooting, DNS/SSL resolution |
| **KPBC Management** | Customer communication for extended outages, PIPEDA breach notification decisions, budget approval for infrastructure improvements |

---

## 10. Improvement Plan

The following improvements are planned to strengthen disaster recovery capabilities. They are tracked in `TODO.md`.

### BACKUP-2: Offsite Database Backups — DONE (2026-09-18)

Implemented as a pull-based GitHub Actions job (`.github/workflows/backup.yml`) rather than a push from the server, because the shared host's process limit makes server-side tooling unreliable. Nightly at 03:30 UTC: fetch newest dump over FTPS → reject if > 36 h old → test-restore into MariaDB 11.4 → mirror vendor uploads → copy to Backblaze B2 `GTA-CPR-Backups` → prune copies older than 90 days → email on failure. RPO in total server loss: 24 h.

**Remaining**: store vendor PDFs directly in the bucket at upload time (S2) to close the up-to-24 h window for uploads.

### HOSTING-1: VPS Upgrade (Medium Priority)

**Current state**: Shared hosting with LVE limits (100 processes, 2 GB RAM, 2 CPU cores). No root access. Risk of 503 errors under load.

**Target state**: TMD Managed VPS with dedicated resources, no process limits, full root access.

**Benefits for DR**:
- Ability to install and configure additional backup tools (e.g., `mysqldump` to S3 directly, filesystem snapshots).
- Better process isolation -- no risk of other tenants or LVE enforcement affecting recovery operations.
- Ability to run automated DR tests via cron.
- Option for server-level snapshots as an additional backup layer.

**Trigger**: Upgrade before onboarding multiple concurrent paying customers.

### Future Considerations

- **Database replication**: If the system grows to require near-zero RPO, implement MariaDB replication to a standby server.
- **Multi-region hosting**: For higher availability, deploy to a second geographic region with DNS failover.
- **Automated health-check recovery**: Script that automatically restarts Passenger when the health endpoint fails (beyond UptimeRobot alerting).
- **Immutable backups**: Use object lock or write-once storage for backups to protect against ransomware or accidental deletion.

---

## Appendix A: Key File Paths and Credentials

| Resource | Location |
|----------|----------|
| Application directory | `/home/kaizenmo/cpr.kpbc.ca/` |
| Source code directory | `/home/kaizenmo/cpr.kpbc.ca-src/` |
| Backup script | `/home/kaizenmo/backup-cpr.sh` |
| Deploys | GitHub Actions `.github/workflows/ci.yml` (staging + production on push to `master`) |
| Offsite backup job | GitHub Actions `.github/workflows/backup.yml` → Backblaze B2 `GTA-CPR-Backups` |
| Environment variables | `/home/kaizenmo/cpr.kpbc.ca/.htaccess` |
| Passenger restart trigger | `/home/kaizenmo/cpr.kpbc.ca/tmp/restart.txt` |
| GitHub repository | `https://github.com/Kaizenpbc/cpr-fastify` |
| cPanel access | TMD Hosting client area (credentials in password manager) |
| TMD support | Support ticket via TMD client portal; live chat at tmdhosting.com |
| UptimeRobot | Monitors `GET /api/v1/health` every 5 min; alerts kpbcma@gmail.com |
| Sentry | DSN configured in production `.htaccess` |
| Database name | `kaizenmo_cpr` |
| Database user | `kaizenmo_cpruser` |

**Note**: Never store actual passwords or API keys in this document. All credentials are maintained in a secure password manager and in the production `.htaccess` file on the server.

---

*This plan should be reviewed and updated quarterly, or after any significant infrastructure change. The next scheduled review is October 2026.*
