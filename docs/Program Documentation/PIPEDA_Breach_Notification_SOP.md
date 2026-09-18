# PIPEDA Breach Notification Standard Operating Procedure

| Field             | Value                                          |
|-------------------|------------------------------------------------|
| **Document ID**   | SOP-PRIV-001                                   |
| **Version**       | 1.0                                            |
| **Effective Date**| 2026-06-28                                     |
| **Owner**         | Privacy Officer, KPBC (Kaizen Performance Business Consulting) |
| **System**        | CPR Training Management System (cpr.kpbc.ca)   |
| **Review Cycle**  | Annual                                         |
| **Next Review**   | 2027-06-28                                     |

---

## 1. Purpose

This Standard Operating Procedure establishes the process KPBC follows when a breach of personal information occurs within the CPR Training Management System. It ensures compliance with the Personal Information Protection and Electronic Documents Act (PIPEDA) and the Breach of Security Safeguards Regulations (SOR/2018-64), which require organizations to:

- Report breaches involving a real risk of significant harm to the Office of the Privacy Commissioner of Canada (OPC)
- Notify affected individuals
- Maintain a record of all breaches for at least 24 months

---

## 2. Scope

This SOP applies to all breaches of personal information processed by the CPR Training Management System, including data belonging to:

- Students enrolled in courses managed through the platform
- Instructors and staff of customer organizations
- Customer organization administrators
- KPBC system administrators

This procedure covers breaches originating from any vector: unauthorized access, system vulnerability, human error, lost or stolen credentials, or third-party compromise.

---

## 3. Definitions

**Personal Information**: Information about an identifiable individual, as defined under PIPEDA Section 2(1). In the context of this system, this includes names, email addresses, phone numbers, mailing addresses, course records, certification details, and billing information.

**Breach of Security Safeguards (Breach)**: The loss of, unauthorized access to, or unauthorized disclosure of personal information resulting from a breach of an organization's security safeguards, or a failure to establish those safeguards.

**Real Risk of Significant Harm (RROSH)**: The threshold under PIPEDA Section 10.1 that triggers mandatory notification. Significant harm includes bodily harm, humiliation, damage to reputation or relationships, loss of employment, business or professional opportunities, financial loss, identity theft, negative effects on credit record, and damage to or loss of property. Factors to assess include the sensitivity of the information and the probability that the information will be misused.

---

## 4. Roles and Responsibilities

### 4.1 Privacy Officer

- Overall accountability for breach response
- Makes the determination on whether a breach meets the RROSH threshold
- Submits the report to the OPC
- Approves notifications to affected individuals and customer organizations
- Maintains the 24-month breach log
- Conducts or oversees post-incident review

### 4.2 Technical Lead

- Monitors alert channels (Sentry, UptimeRobot, server logs)
- Performs initial triage and containment actions
- Conducts forensic investigation to determine scope and root cause
- Implements technical remediation (patches, credential rotation, configuration changes)
- Preserves technical evidence (logs, database snapshots)
- Deploys fixes to production

### 4.3 Customer Contact

- Serves as the liaison to affected customer organizations
- Delivers breach notifications to organization administrators
- Coordinates individual notifications where the customer organization manages the relationship with affected persons
- Collects and relays questions or concerns from affected parties

---

## 5. Step 1 — Detection (Immediate)

### 5.1 Indicators of a Potential Breach

| Indicator | Source | Example |
|-----------|--------|---------|
| Unauthorized access patterns | Audit logs (`audit_log` table) | User accessing resources outside their organization's scope |
| Unusual error volumes | Sentry | Mass 403 errors, SQL injection attempts, authentication bypass attempts |
| Unexpected downtime followed by data changes | UptimeRobot + database review | Service goes down and data is modified during the outage window |
| User or customer reports | Email / direct contact | User reports seeing another organization's data, or activity they did not perform |
| Unknown access origins | Server access logs (LiteSpeed) | Connections from unrecognized IP addresses performing administrative actions |
| Credential compromise indicators | Sentry / audit logs | Successful logins from multiple geographies in a short window, brute-force patterns |

### 5.2 Who Detects

- **Automated**: Sentry captures unhandled exceptions and suspicious patterns in real time. UptimeRobot polls the health endpoint (`GET /api/v1/health`) every 5 minutes and emails alerts to kpbcma@gmail.com on failure.
- **Manual**: User reports via email or direct contact. Periodic review of audit logs by the Technical Lead.

### 5.3 Escalation

Any person who detects or suspects a breach must immediately notify the Privacy Officer and Technical Lead. Do not attempt to investigate alone or delay reporting. When in doubt, escalate — the assessment phase (Step 3) will determine whether the event constitutes a reportable breach.

---

## 6. Step 2 — Containment (Within 1 Hour)

The goal of containment is to stop ongoing unauthorized access and prevent further data loss while preserving evidence.

### 6.1 Actions

1. **Revoke compromised sessions**: Clear entries in the `token_blacklist` table and force password resets for affected accounts.
2. **Isolate affected systems**: If the server is compromised, take the application offline by deploying a maintenance page (`touch tmp/restart.txt` with maintenance mode enabled).
3. **Preserve evidence**: Do NOT delete any logs, database records, or audit trail entries. Take a snapshot of the database and copy relevant server logs to a secure location before any remediation.
4. **Rotate credentials if exposed**: Change the database password (`kaizenmo_cpruser`), API keys (Resend, Sentry DSN), and any other credentials that may have been compromised. Update the production `.htaccess` environment variables accordingly.
5. **Restrict access**: If the breach vector is a specific user account or API endpoint, disable that account or block the endpoint immediately.

### 6.2 Documentation During Containment

Record the following as events occur:

- Exact time the breach was detected
- Exact time containment actions began
- Who performed each action
- What systems and data were affected (initial assessment)

---

## 7. Step 3 — Assessment (Within 24 Hours)

### 7.1 Determine Scope

Answer the following questions:

- **What personal information was involved?** Names, email addresses, phone numbers, course records, certification data, billing details, hashed passwords, other.
- **How many individuals are affected?** Query the audit log and affected database tables to establish the count.
- **Which customer organizations are affected?** Identify all organizations whose data was accessed or exposed.
- **Was data actually accessed or exfiltrated, or merely exposed?** Review server logs, audit logs, and database query history.
- **What is the state of the data's protection?** Passwords are bcrypt-hashed. Other personal information is not encrypted at rest. Data is transmitted over TLS (HTTPS).

### 7.2 Assess Real Risk of Significant Harm

Apply the OPC criteria to determine whether the breach meets the RROSH threshold:

**Sensitivity of the information:**
- High sensitivity: financial information, government-issued identifiers, health information
- Medium sensitivity: contact information combined with course/certification records
- Lower sensitivity: business email addresses alone

**Probability of misuse:**
- Was the data accessed by an identified internal party (lower probability) or an unknown external actor (higher probability)?
- Is the data in a format that is readily usable (plaintext) or protected (hashed/encrypted)?
- Has the data been recovered, or is it still in unauthorized hands?
- Is there evidence of malicious intent?

### 7.3 Decision Tree

1. **Was personal information involved?** If no, this is a security incident but not a privacy breach. Follow the Incident Response Runbook only. If yes, continue.
2. **Was there unauthorized access, disclosure, or loss?** If no, no breach occurred. Document and close. If yes, continue.
3. **Does the breach create a real risk of significant harm?** Apply the criteria in Section 7.2.
   - **If yes**: Proceed to Step 4 (Notification). Report to OPC and notify affected individuals within 72 hours.
   - **If no**: Do NOT report to OPC or notify individuals. Record the breach in the breach log (Section 9). Proceed to Step 5 (Remediation).
   - **If uncertain**: Err on the side of reporting. Contact the OPC for guidance if needed.

---

## 8. Step 4 — Notification (Within 72 Hours If Reportable)

### 8.1 Notification to the Office of the Privacy Commissioner

Submit a breach report to the OPC through their online reporting form:

**URL**: https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/

**Required information:**

| Field | Description |
|-------|-------------|
| Organization name | Kaizen Performance Business Consulting (KPBC) |
| Contact person | Privacy Officer (name, title, phone, email) |
| Description of the breach | What happened, how it was discovered |
| Date or estimated date of the breach | When the breach occurred |
| Date the breach was discovered | When KPBC became aware |
| Personal information involved | Categories of data affected |
| Number of individuals affected | Count or best estimate |
| Steps taken to reduce risk of harm | Containment and remediation actions |
| Steps taken or planned to notify individuals | How and when individuals will be told |

### 8.2 Notification to Affected Individuals

Send email notification to each affected individual. The notification must include:

1. **What happened**: A clear, plain-language description of the breach
2. **What personal information was involved**: Specific categories (e.g., name, email, course history)
3. **What KPBC is doing**: Actions taken to contain and remediate
4. **What the individual can do**: Recommended steps such as changing passwords, monitoring accounts for suspicious activity, placing a fraud alert with credit bureaus if financial data was involved
5. **Contact information**: How to reach the Privacy Officer with questions or concerns
6. **Right to complain**: Information about the individual's right to file a complaint with the OPC

**Email subject line**: Important Notice About Your Personal Information — KPBC CPR Training System

**Send from**: The system notification address (noreply@kpbc.ca via Resend) or directly from the Privacy Officer's email, depending on the nature and severity of the breach.

### 8.3 Notification to Customer Organizations

Notify the primary administrator of each affected customer organization directly. Include:

- Summary of the breach and its scope as it pertains to their organization
- What data belonging to their users was affected
- Actions taken to contain and remediate
- Recommended actions for the organization (e.g., advising their staff to change passwords)
- Contact information for follow-up

Customer notification should be made by phone or email depending on the severity. For breaches affecting a single organization, direct phone contact is preferred.

---

## 9. Step 5 — Remediation (Within 1 Week)

1. **Identify and fix the vulnerability** that caused or permitted the breach. This may involve code changes, configuration updates, or infrastructure modifications.
2. **Deploy the fix to production**. Follow the standard deployment process (push to `master`, CI validation via GitHub Actions, deploy via `deploy-production.sh` or wait for auto-deploy at :18).
3. **Verify the fix** by testing the specific attack vector or failure mode in the staging environment (stagecprapp.kpbc.ca) before or after production deployment.
4. **Conduct a post-incident review** within 48 hours of resolution, following the Post-Incident Report template in the Incident Response Runbook. Store completed reports in `docs/incidents/`.
5. **Update security measures** as needed: add new audit log checks, update access controls, strengthen input validation, add monitoring rules in Sentry.
6. **Document everything** in the breach log and the post-incident report.

---

## 10. Record Keeping

### 10.1 Requirement

Under PIPEDA Section 10.3, KPBC must maintain a record of every breach of security safeguards involving personal information for a minimum of **24 months** from the date the organization determines the breach has occurred. This applies to all breaches, regardless of whether the RROSH threshold was met and regardless of whether the OPC was notified.

### 10.2 Fields to Record

Each breach log entry must include:

- Breach ID (sequential identifier)
- Date the breach occurred (or estimated date)
- Date the breach was discovered
- Description of the breach
- Categories of personal information involved
- Number of individuals affected
- Customer organizations affected
- Assessment of real risk of significant harm (yes/no/uncertain, with rationale)
- Whether the OPC was notified (yes/no, with date if yes)
- Whether affected individuals were notified (yes/no, with date if yes)
- Containment actions taken
- Remediation actions taken
- Date of post-incident review
- Status (open/closed)

### 10.3 Storage

The breach log is maintained as a controlled document accessible only to the Privacy Officer and Technical Lead. It must be retained for a minimum of 24 months and must be provided to the OPC upon request.

---

## 11. Breach Log Template

| Breach ID | Date Occurred | Date Discovered | Description | PI Involved | Individuals Affected | Orgs Affected | RROSH Assessment | OPC Notified | Individuals Notified | Containment Actions | Remediation Actions | Post-Incident Review Date | Status |
|-----------|---------------|-----------------|-------------|-------------|----------------------|---------------|-------------------|--------------|----------------------|---------------------|---------------------|---------------------------|--------|
| BR-001 | YYYY-MM-DD | YYYY-MM-DD | [Description] | [Categories] | [Count] | [Org names] | Yes/No — [Rationale] | Yes/No — [Date] | Yes/No — [Date] | [Actions taken] | [Actions taken] | YYYY-MM-DD | Open/Closed |

---

## 12. Contact Information

| Role | Contact | Details |
|------|---------|---------|
| **Privacy Officer** | [Assign — currently the sole operator of KPBC] | Primary point of contact for all breach-related decisions and notifications |
| **Technical Lead** | [Assign — currently the sole operator of KPBC] | Responsible for detection, containment, forensic analysis, and remediation |
| **OPC Breach Reporting** | Office of the Privacy Commissioner of Canada | https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/ |
| **OPC General Inquiries** | Office of the Privacy Commissioner of Canada | https://www.priv.gc.ca/en/report-a-concern/ |
| **System Alerts** | kpbcma@gmail.com | UptimeRobot and Sentry alerts are directed here |
| **System Notification Sender** | noreply@kpbc.ca | Outbound email via Resend API |

---

## 13. Review Schedule

This SOP must be reviewed and updated at least **annually** by the Privacy Officer. Additional reviews should be triggered by:

- Any actual breach (incorporate lessons learned)
- Significant changes to the CPR Training Management System architecture or data handling practices
- Changes to PIPEDA or related regulations
- Addition of new third-party data processors or service providers
- Feedback from the OPC or legal counsel

| Review Date | Reviewer | Changes Made | Next Review Due |
|-------------|----------|-------------|-----------------|
| 2026-06-28 | Privacy Officer | Initial version | 2027-06-28 |

---

*End of document.*
