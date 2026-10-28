import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from './database.js';
import { logger } from './logger.js';
import { torontoToday } from '../utils/torontoDate.js';
import { addColumnIfMissing, addIndexIfMissing, addForeignKeyIfMissing, dropIndexIfExists, tableExists, columnExists, constraintExists } from './schemaHelpers.js';

interface Migration {
  version: number;
  name: string;
  up: string | ((pool: Pool) => Promise<void>);
}

/**
 * Versioned migration runner. Each migration runs exactly once, tracked in
 * the `schema_migrations` table. Add new migrations to the end of the list.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_login_attempts',
    up: `CREATE TABLE IF NOT EXISTS login_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_login_attempts_username (username, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 2,
    name: 'create_token_blacklist',
    up: `CREATE TABLE IF NOT EXISTS token_blacklist (
      user_id INT NOT NULL PRIMARY KEY,
      invalidated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_token_blacklist_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 3,
    name: 'create_invoice_number_sequences',
    up: `CREATE TABLE IF NOT EXISTS invoice_number_sequences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT NOT NULL UNIQUE,
      prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
      format_string VARCHAR(100) NOT NULL DEFAULT '{PREFIX}-{YYYY}-{NNNN}',
      padding INT NOT NULL DEFAULT 4,
      next_number INT NOT NULL DEFAULT 1,
      step INT NOT NULL DEFAULT 1,
      reset_policy ENUM('none','yearly','monthly') NOT NULL DEFAULT 'none',
      last_reset_period VARCHAR(10) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_inv_seq_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 4,
    name: 'fix_token_blacklist_add_invalidated_at',
    // Guarded (MySQL 8 has no ADD COLUMN IF NOT EXISTS)
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'token_blacklist', 'invalidated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
    },
  },
  {
    version: 5,
    name: 'create_students_master',
    up: `CREATE TABLE IF NOT EXISTS students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      organization_id INT DEFAULT NULL,
      marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
      marketing_consent_at DATETIME DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_students_email (email),
      INDEX idx_students_org (organization_id),
      INDEX idx_students_name (last_name, first_name),
      CONSTRAINT fk_students_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 6,
    name: 'add_student_id_to_course_students',
    // Guarded + idempotent: a partial earlier run (column added, FK failed) can be retried
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'course_students', 'student_id', 'INT DEFAULT NULL');
      await addIndexIfMissing(pool, 'course_students', 'idx_cs_student_id', ['student_id']);
      await addForeignKeyIfMissing(pool, 'course_students', 'fk_cs_student', 'student_id', 'students', 'id', 'SET NULL');
    },
  },
  {
    version: 7,
    name: 'backfill_students_master',
    up: async (pool: Pool) => {
      // Group existing course_students by email, create master records, link them
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT email, MIN(first_name) as first_name, MIN(last_name) as last_name,
               MIN(phone) as phone,
               (SELECT cr.organization_id FROM course_requests cr
                WHERE cr.id = MIN(cs.course_request_id)) as organization_id
        FROM course_students cs
        WHERE email IS NOT NULL AND TRIM(email) != ''
        GROUP BY LOWER(TRIM(email))
      `);

      if (rows.length === 0) return;

      for (const r of rows) {
        const email = r.email.trim().toLowerCase();
        // Insert if not exists (idempotent)
        await pool.query(
          `INSERT IGNORE INTO students (email, first_name, last_name, phone, organization_id)
           VALUES (?, ?, ?, ?, ?)`,
          [email, r.first_name, r.last_name, r.phone, r.organization_id]
        );
      }

      // Link course_students to their master records
      await pool.query(`
        UPDATE course_students cs
        JOIN students s ON LOWER(TRIM(cs.email)) = s.email
        SET cs.student_id = s.id
        WHERE cs.student_id IS NULL AND cs.email IS NOT NULL AND TRIM(cs.email) != ''
      `);

      const [count] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as c FROM students');
      logger.info({ studentsMigrated: count[0].c }, 'Students master table backfilled');
    },
  },
  {
    version: 8,
    name: 'add_certification_expiry_tracking',
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'class_types', 'certification_validity_months', 'INT DEFAULT NULL');
    },
  },
  {
    version: 9,
    name: 'add_certificate_fields_to_course_students',
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'course_students', 'certificate_number', 'VARCHAR(50) DEFAULT NULL');
      await addColumnIfMissing(pool, 'course_students', 'certificate_issued_at', 'DATETIME DEFAULT NULL');
      await addColumnIfMissing(pool, 'course_students', 'certificate_expires_at', 'DATETIME DEFAULT NULL');
      await addIndexIfMissing(pool, 'course_students', 'idx_cs_cert_expires', ['certificate_expires_at']);
    },
  },
  {
    version: 10,
    name: 'backfill_certificate_dates',
    up: async (pool: Pool) => {
      // For attended students in completed courses where the class type has a validity period,
      // set certificate_issued_at = course completed_at, and calculate expiry
      const [result] = await pool.query<ResultSetHeader>(`
        UPDATE course_students cs
        JOIN course_requests cr ON cs.course_request_id = cr.id
        JOIN class_types ct ON cr.course_type_id = ct.id
        SET cs.certificate_issued_at = cr.completed_at,
            cs.certificate_expires_at = DATE_ADD(cr.completed_at, INTERVAL ct.certification_validity_months MONTH)
        WHERE cs.attended = true
          AND cr.completed_at IS NOT NULL
          AND ct.certification_validity_months IS NOT NULL
          AND cs.certificate_issued_at IS NULL
      `);
      logger.info({ backfilled: result.affectedRows }, 'Certificate dates backfilled');
    },
  },
  {
    version: 11,
    name: 'create_system_config',
    up: async (pool: Pool) => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS system_config (
          config_key VARCHAR(100) NOT NULL PRIMARY KEY,
          config_value VARCHAR(500) NOT NULL,
          description VARCHAR(255) DEFAULT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      // Seed the tax rate from current env or default
      const hstRate = process.env.HST_RATE ?? '0.13';
      await pool.query(
        `INSERT IGNORE INTO system_config (config_key, config_value, description)
         VALUES ('tax_rate', ?, 'HST rate as decimal (e.g. 0.13 = 13%)')`,
        [hstRate]
      );
      logger.info({ taxRate: hstRate }, 'system_config table created with tax_rate');
    },
  },
  {
    version: 12,
    name: 'create_certification_reminders',
    up: `CREATE TABLE IF NOT EXISTS certification_reminders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_student_id INT NOT NULL,
      student_email VARCHAR(255) NOT NULL,
      reminder_type VARCHAR(10) NOT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dedup (course_student_id, reminder_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 13,
    name: 'create_audit_logs',
    up: `CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      username VARCHAR(100) DEFAULT NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) DEFAULT NULL,
      entity_id INT DEFAULT NULL,
      details JSON DEFAULT NULL,
      ip_address VARCHAR(45) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_created (created_at),
      INDEX idx_audit_user (user_id),
      INDEX idx_audit_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 14,
    name: 'create_password_resets',
    up: `CREATE TABLE IF NOT EXISTS password_resets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_password_resets_token (token_hash),
      INDEX idx_password_resets_user (user_id, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 15,
    name: 'add_hot_path_indexes',
    // Composite indexes for the most common WHERE/JOIN/ORDER BY columns
    // (docs/AUDIT_2026-09-17.md §6). Each is skipped if the table/column is absent.
    up: async (pool: Pool) => {
      const specs: Array<[string, string, string[]]> = [
        ['course_requests', 'idx_cr_status_deleted_sched', ['status', 'deleted_at', 'scheduled_date']],
        ['course_requests', 'idx_cr_org_deleted', ['organization_id', 'deleted_at']],
        ['course_requests', 'idx_cr_instructor_deleted', ['instructor_id', 'deleted_at']],
        ['course_students', 'idx_cs_request_attended', ['course_request_id', 'attended']],
        ['payments', 'idx_pay_invoice_status', ['invoice_id', 'status']],
        ['invoices', 'idx_inv_org_status_due', ['organization_id', 'status', 'due_date']],
        ['users', 'idx_users_org_role_status', ['organization_id', 'role', 'status']],
        ['users', 'idx_users_email', ['email']],
        ['notifications', 'idx_notif_user_read', ['user_id', 'is_read']],
        ['timesheets', 'idx_ts_instructor_week', ['instructor_id', 'week_start_date']],
        ['vendor_invoices', 'idx_vi_vendor_status', ['vendor_id', 'status']],
        ['instructor_pay_rates', 'idx_ipr_instructor_active_eff', ['instructor_id', 'is_active', 'effective_date']],
        ['payroll_payments', 'idx_pp_instructor_date', ['instructor_id', 'payment_date']],
      ];
      for (const [table, index, columns] of specs) {
        try {
          const added = await addIndexIfMissing(pool, table, index, columns);
          if (added) logger.info({ table, index }, 'Index added');
        } catch (err) {
          // Never block startup on an optimisation
          logger.warn({ err, table, index }, 'Index creation skipped');
        }
      }
    },
  },
  {
    version: 16,
    name: 'certification_reminders_unique_claim',
    // Claim-then-send needs a UNIQUE key so two workers cannot both send the same reminder.
    up: async (pool: Pool) => {
      if (!(await tableExists(pool, 'certification_reminders'))) return;
      // Remove any historical duplicates first (keep the earliest row)
      await pool.query(`
        DELETE cr1 FROM certification_reminders cr1
        JOIN certification_reminders cr2
          ON cr1.course_student_id = cr2.course_student_id
         AND cr1.reminder_type = cr2.reminder_type
         AND cr1.id > cr2.id
      `);
      await addIndexIfMissing(pool, 'certification_reminders', 'uq_cert_reminder', ['course_student_id', 'reminder_type'], { unique: true });
    },
  },
  {
    version: 17,
    name: 'create_refresh_tokens',
    // Server-side record of issued refresh tokens so they can be rotated and revoked.
    up: `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME DEFAULT NULL,
      replaced_by CHAR(64) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_refresh_token_hash (token_hash),
      INDEX idx_refresh_user (user_id, revoked_at, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    version: 18,
    name: 'organization_locations_address_contact',
    // The sysadmin Locations dialog edits address + contact fields; the original
    // table only had location_name. Guarded so re-runs and pre-populated DBs are safe.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'organization_locations', 'address', 'VARCHAR(500) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'city', 'VARCHAR(100) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'province', 'VARCHAR(100) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'postal_code', 'VARCHAR(20) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'contact_first_name', 'VARCHAR(100) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'contact_last_name', 'VARCHAR(100) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'contact_email', 'VARCHAR(255) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'contact_phone', 'VARCHAR(50) DEFAULT NULL');
      await addColumnIfMissing(pool, 'organization_locations', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
    },
  },
  {
    version: 19,
    name: 'course_students_deleted_at',
    // Needed so an org user can remove a student they mistakenly added (e.g.
    // a duplicate CSV upload) without a hard DELETE. course_students never
    // had this column — a raw query elsewhere in the app already assumed it
    // did (instructor-admin.ts's students_attended subquery), which was
    // itself a latent bug this makes correct.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'course_students', 'deleted_at', 'DATETIME DEFAULT NULL');
      await addIndexIfMissing(pool, 'course_students', 'idx_cs_deleted_at', ['deleted_at']);
    },
  },
  {
    version: 20,
    name: 'payroll_payments_notes_and_timesheets_course_details',
    // Two more columns the code always assumed existed but never actually
    // did — found live tonight once POST /payroll/payments and POST
    // /timesheet got real error surfacing instead of a swallowed 500.
    // Creating a payroll payment and submitting a timesheet have likely
    // never worked, for anyone, since either route was written.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'payroll_payments', 'notes', 'TEXT DEFAULT NULL');
      await addColumnIfMissing(pool, 'timesheets', 'course_details', 'JSON DEFAULT NULL');
    },
  },
  {
    version: 21,
    name: 'timesheets_travel_prep_teaching_late',
    // Same discovery as v20, one column at a time as each new "Unknown
    // column" error surfaced — the whole submit-timesheet INSERT assumed
    // columns that were never added. Confirmed timesheets.travel_time is
    // missing; adding its neighbours from the same INSERT in one pass
    // rather than deploying four more times to find each one individually.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'timesheets', 'travel_time', 'DECIMAL(5,2) DEFAULT 0');
      await addColumnIfMissing(pool, 'timesheets', 'prep_time', 'DECIMAL(5,2) DEFAULT 0');
      await addColumnIfMissing(pool, 'timesheets', 'teaching_hours', 'DECIMAL(5,2) DEFAULT 0');
      await addColumnIfMissing(pool, 'timesheets', 'is_late', 'TINYINT(1) NOT NULL DEFAULT 0');
      // Not yet confirmed missing, but written by the approve/reject route
      // in the same file and cheap/safe to guard now rather than find it
      // the same way as the others, one deploy at a time.
      await addColumnIfMissing(pool, 'timesheets', 'hr_comment', 'TEXT DEFAULT NULL');
    },
  },
  {
    version: 22,
    name: 'drop_broken_instructor_pay_rate_unique',
    // uq_instructor_active is UNIQUE(instructor_id, is_active) — not what
    // it sounds like. Its intent was clearly "one active rate per
    // instructor", but MariaDB has no partial/filtered unique index, so as
    // written it also caps every instructor at exactly one *inactive*
    // (historical) rate row ever. The route already deactivates the old
    // active row and inserts a fresh one in the same transaction, which is
    // the correct way to enforce "one active rate" — so this constraint
    // was never protecting anything real, only breaking every second rate
    // change for the same instructor with 'Duplicate entry ... for key
    // uq_instructor_active'. Confirmed live: instructor 4's second rate
    // change failed this way tonight. Dropping it; the app-level logic is
    // what actually keeps this correct.
    up: async (pool: Pool) => {
      await dropIndexIfExists(pool, 'instructor_pay_rates', 'uq_instructor_active');
    },
  },
  {
    version: 23,
    name: 'invoices_rejection_reason',
    // Confirmed live: PUT /accounting/invoices/:id/approval (reject) has
    // always thrown "Unknown column 'rejection_reason' in 'SET'" — invoices
    // have rejected_by/rejected_at but never got the reason column the
    // reject route and the Rejected Invoices screen both assume exists.
    // Rejecting an invoice has never worked.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'invoices', 'rejection_reason', 'TEXT DEFAULT NULL');
    },
  },
  {
    version: 24,
    name: 'inbound_email_course_requests',
    // Email -> course request intake (see TODO.md). `course_requests.source`
    // tags which channel created a row; `inbound_emails` is the audit trail
    // of every received email and what the parser decided, whether or not
    // it ended up creating a request.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'course_requests', 'source', `VARCHAR(20) NOT NULL DEFAULT 'portal'`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS inbound_emails (
          id INT AUTO_INCREMENT PRIMARY KEY,
          resend_email_id VARCHAR(191) NOT NULL,
          from_address VARCHAR(255) NOT NULL,
          subject VARCHAR(500) DEFAULT NULL,
          body_text MEDIUMTEXT DEFAULT NULL,
          matched_organization_id INT DEFAULT NULL,
          matched_user_id INT DEFAULT NULL,
          parse_tier VARCHAR(20) DEFAULT NULL,
          parse_confidence DECIMAL(3,2) DEFAULT NULL,
          extracted JSON DEFAULT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'received',
          course_request_id INT DEFAULT NULL,
          reject_reason TEXT DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_inbound_emails_resend_id (resend_email_id),
          KEY idx_inbound_emails_status (status)
        )
      `);
    },
  },
  {
    version: 25,
    name: 'payments_status_date_index',
    // Financial Summary reads verified payments by payment_date range.
    up: async (pool: Pool) => {
      await addIndexIfMissing(pool, 'payments', 'idx_payments_status_date', ['status', 'payment_date']);
    },
  },
  {
    version: 26,
    name: 'token_blacklist_per_user',
    // Both live databases had an older token_blacklist (token_hash, expires_at) that
    // v2's CREATE TABLE IF NOT EXISTS never replaced. AuthService reads and writes it
    // by user_id, so password change and reset failed after saving the new password,
    // and "sign out everywhere" never worked. Keep the old table (renamed), create v2's.
    // Two DDL steps each commit on their own, so this is written to be safe to re-run
    // if it stops between them.
    up: async (pool: Pool) => {
      if ((await tableExists(pool, 'token_blacklist')) && !(await columnExists(pool, 'token_blacklist', 'user_id'))) {
        await pool.query('RENAME TABLE token_blacklist TO token_blacklist_legacy_20261017');
      }
      await pool.query(`CREATE TABLE IF NOT EXISTS token_blacklist (
        user_id INT NOT NULL PRIMARY KEY,
        invalidated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    },
  },
  {
    version: 27,
    name: 'inbound_emails_handled',
    // When and by whom a held email was handled (request created or
    // dismissed), for the Handled tab and the 90-day email-text clean-up.
    // Existing handled rows use their received time.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'inbound_emails', 'handled_at', 'DATETIME DEFAULT NULL');
      await addColumnIfMissing(pool, 'inbound_emails', 'handled_by', 'INT DEFAULT NULL');
      await pool.query(
        "UPDATE inbound_emails SET handled_at = created_at WHERE handled_at IS NULL AND status IN ('created_request', 'rejected')"
      );
      await addIndexIfMissing(pool, 'inbound_emails', 'idx_inbound_emails_status_handled', ['status', 'handled_at']);
    },
  },
  {
    version: 28,
    name: 'course_requests_date_requested_backfill',
    // createRequest never set date_requested (DATE NOT NULL, no default), so
    // MariaDB stored 0000-00-00 for every request since April 2026. Use the
    // day each one was created, in Toronto time. The server has no time-zone
    // tables (CONVERT_TZ gives NULL), so the date is worked out here.
    up: async (pool: Pool) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, created_at FROM course_requests
          WHERE (date_requested IS NULL OR date_requested = '0000-00-00') AND created_at IS NOT NULL`
      );
      for (const row of rows) {
        const created = new Date(row.created_at);
        if (isNaN(created.getTime())) continue; // a zero created_at; leave it
        await pool.query('UPDATE course_requests SET date_requested = ? WHERE id = ?', [torontoToday(created), row.id]);
      }
    },
  },
  {
    version: 29,
    name: 'payment_and_invoice_status_checks_match_code',
    // The live databases carry hand-added CHECK constraints (not from any
    // migration) whose status lists predate the payment flow: chk_pay_status
    // lacks 'pending_verification' and chk_inv_status lacks 'payment_submitted'
    // / 'partial_payment'. So every organization "Submit Payment" failed with
    // a 500 (CONSTRAINT `chk_pay_status` failed). Widen both to every status
    // the code writes; old values stay allowed. Skipped where they don't exist.
    up: async (pool: Pool) => {
      if (await constraintExists(pool, 'payments', 'chk_pay_status')) {
        await pool.query(
          `ALTER TABLE payments DROP CONSTRAINT chk_pay_status,
             ADD CONSTRAINT chk_pay_status CHECK (status IS NULL OR status IN
               ('pending', 'pending_verification', 'verified', 'rejected', 'reversed'))`
        );
      }
      if (await constraintExists(pool, 'invoices', 'chk_inv_status')) {
        await pool.query(
          `ALTER TABLE invoices DROP CONSTRAINT chk_inv_status,
             ADD CONSTRAINT chk_inv_status CHECK (status IN
               ('pending', 'payment_submitted', 'partial_payment', 'paid', 'overdue', 'cancelled'))`
        );
      }
      // Same story for users: "Erase personal data" sets status 'deleted',
      // which chk_users_status didn't allow, so every erase failed.
      if (await constraintExists(pool, 'users', 'chk_users_status')) {
        await pool.query(
          `ALTER TABLE users DROP CONSTRAINT chk_users_status,
             ADD CONSTRAINT chk_users_status CHECK (status IS NULL OR status IN
               ('active', 'inactive', 'suspended', 'deleted'))`
        );
      }
    },
  },
  {
    version: 30,
    name: 'certificate_dates_from_class_day',
    // Complete Class never set certificate dates (attendance is marked first,
    // and only attendance set them), and v10 used the UTC completion time,
    // which put evening classes on the next day. Re-derive them for every
    // attended student of a completed class from the day it was held.
    // Written out (not the shared helper) so this migration never changes.
    up: async (pool: Pool) => {
      const classDay = `CASE WHEN cr.completed_at IS NOT NULL
        THEN COALESCE(cr.confirmed_date, cr.scheduled_date, DATE(cr.completed_at)) END`;
      const [result] = await pool.query<ResultSetHeader>(`
        UPDATE course_students cs
        JOIN course_requests cr ON cs.course_request_id = cr.id
        JOIN class_types ct ON cr.course_type_id = ct.id
        SET cs.certificate_issued_at = ${classDay},
            cs.certificate_expires_at = DATE_ADD(${classDay}, INTERVAL ct.certification_validity_months MONTH)
        WHERE cs.attended = true AND cs.deleted_at IS NULL
          AND cr.completed_at IS NOT NULL AND ct.certification_validity_months IS NOT NULL`);
      logger.info({ updated: result.affectedRows }, 'Certificate dates set from the class day');
    },
  },
  {
    version: 31,
    name: 'certificate_numbers',
    // Every issued certificate gets a number (GTACPR-<year of issue>-<6 digits>).
    // The counter table hands them out one at a time; existing certificates are
    // numbered oldest first. Written out (not the shared helper) so this
    // migration never changes.
    up: async (pool: Pool) => {
      await pool.query(`CREATE TABLE IF NOT EXISTS certificate_counter (
        id TINYINT NOT NULL PRIMARY KEY,
        last_number INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query('INSERT IGNORE INTO certificate_counter (id, last_number) VALUES (1, 0)');
      await addColumnIfMissing(pool, 'course_students', 'certificate_emailed_at', 'DATETIME DEFAULT NULL');

      const [todo] = await pool.query<RowDataPacket[]>(
        `SELECT id, YEAR(certificate_issued_at) AS yr FROM course_students
         WHERE certificate_issued_at IS NOT NULL AND certificate_number IS NULL
         ORDER BY certificate_issued_at, id`);
      for (const row of todo) {
        await pool.query('UPDATE certificate_counter SET last_number = LAST_INSERT_ID(last_number + 1) WHERE id = 1');
        const [seq] = await pool.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS n');
        await pool.query('UPDATE course_students SET certificate_number = ? WHERE id = ?',
          [`GTACPR-${row.yr}-${String(seq[0].n).padStart(6, '0')}`, row.id]);
      }
      await addIndexIfMissing(pool, 'course_students', 'uq_cs_certificate_number', ['certificate_number'], { unique: true });
      logger.info({ numbered: todo.length }, 'Existing certificates numbered');
    },
  },
  {
    version: 32,
    name: 'class_reminders',
    // When each reminder went out, and when the instructor said they were ready.
    // A reminder is claimed by setting its column, so it is never sent twice.
    up: async (pool: Pool) => {
      for (const col of ['reminder_day_before_at', 'reminder_soon_at', 'instructor_ready_at', 'ready_alert_at']) {
        await addColumnIfMissing(pool, 'course_requests', col, 'DATETIME DEFAULT NULL');
      }
    },
  },
  {
    version: 33,
    name: 'instructor_ready_location',
    // "I'm ready" is only accepted when the instructor's phone is within a set distance of
    // the class address. The distance and the phone's accuracy at that tap are kept (never
    // the coordinates) for the course admin. The radius is a system setting.
    up: async (pool: Pool) => {
      await addColumnIfMissing(pool, 'course_requests', 'instructor_ready_accuracy_m', 'INT DEFAULT NULL');
      await addColumnIfMissing(pool, 'course_requests', 'instructor_ready_distance_m', 'INT DEFAULT NULL');
      try {
        await pool.query(
          `INSERT IGNORE INTO system_configurations (config_key, config_value, description, category)
           VALUES ('checkin_radius_meters', '300',
                   'How close (in metres) an instructor must be to the class address to check in with the I''m ready button', 'general')`);
      } catch (err) {
        // The class check-in falls back to 300 m without the row
        logger.warn({ err }, 'Could not add the check-in radius setting');
      }
    },
  },
];

const MIGRATION_LOCK = 'cpr_migrations';

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Passenger starts several workers at once; only one may run DDL at a time.
  // GET_LOCK is per-connection, so hold a dedicated connection for the whole run.
  const conn = await pool.getConnection();
  try {
    const [lockRows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 60) AS got', [MIGRATION_LOCK]);
    if (Number(lockRows[0]?.got) !== 1) {
      throw new Error('Could not acquire migration lock within 60s');
    }

    // Ensure migrations tracking table exists
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Get already-applied versions (re-read under the lock, so a worker that waited
    // sees what the first worker applied)
    const [rows] = await conn.query<RowDataPacket[]>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    // Run pending migrations in order
    let ran = 0;
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      if (typeof m.up === 'function') {
        await m.up(pool);
      } else {
        await pool.query(m.up);
      }
      await conn.query(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
        [m.version, m.name]
      );
      logger.info({ version: m.version, name: m.name }, 'Migration applied');
      ran++;
    }

    if (ran > 0) {
      logger.info({ count: ran }, 'Migrations complete');
    } else {
      logger.info('Schema up to date');
    }
  } finally {
    try { await conn.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]); } catch { /* ignore */ }
    conn.release();
  }
}
