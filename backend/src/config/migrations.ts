import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from './database.js';
import { logger } from './logger.js';
import { addColumnIfMissing, addIndexIfMissing, addForeignKeyIfMissing, dropIndexIfExists, tableExists } from './schemaHelpers.js';

interface Migration {
  version: number;
  name: string;
  up: string | ((pool: Pool) => Promise<void>);
}

/**
 * Versioned migration runner. Each migration runs exactly once, tracked in
 * the `schema_migrations` table. Add new migrations to the end of the list.
 */
const migrations: Migration[] = [
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
