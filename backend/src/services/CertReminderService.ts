import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { EmailService } from './EmailService.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const REMINDER_WINDOWS = [30, 60, 90]; // days before expiry
const RUN_LOCK = 'cpr_cert_reminders';

export class CertReminderService {
  private emailService: EmailService;

  constructor() {
    this.emailService = EmailService.getInstance();
  }

  /**
   * Sends expiry reminders. Safe to run from several worker processes at once:
   * a MySQL named lock skips the run if another worker is already in it, and each
   * reminder row is *claimed* (inserted under a UNIQUE key) before the email is
   * sent, so a second worker can never send the same reminder.
   */
  async sendReminders(): Promise<{ sent: number; skipped: number; errors: number }> {
    const pool = getPool();
    let sent = 0, skipped = 0, errors = 0;

    // Named lock is per-connection: hold one connection for the whole run.
    const lockConn = await pool.getConnection();
    try {
      const [lockRows] = await lockConn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [RUN_LOCK]);
      if (Number(lockRows[0]?.got) !== 1) {
        logger.info('Cert reminder run skipped: another worker holds the lock');
        return { sent, skipped, errors };
      }

      for (const days of REMINDER_WINDOWS) {
        const reminderType = `${days}d`;
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT cs.id as course_student_id, cs.email, cs.first_name, cs.last_name,
                  cs.certificate_number, cs.certificate_expires_at,
                  ct.name as course_type_name,
                  DATEDIFF(cs.certificate_expires_at, CURDATE()) as days_until_expiry
           FROM course_students cs
           JOIN course_requests cr ON cs.course_request_id = cr.id
           JOIN class_types ct ON cr.course_type_id = ct.id
           WHERE cs.attended = true
             AND cs.certificate_expires_at IS NOT NULL
             AND cs.email IS NOT NULL AND cs.email != ''
             AND DATEDIFF(cs.certificate_expires_at, CURDATE()) BETWEEN 0 AND ?
             AND NOT EXISTS (
               SELECT 1 FROM certification_reminders r
               WHERE r.course_student_id = cs.id AND r.reminder_type = ?
             )
           ORDER BY cs.certificate_expires_at ASC
           LIMIT 100`,
          [days, reminderType]
        );

        for (const row of rows) {
          // Claim first. INSERT IGNORE + UNIQUE(course_student_id, reminder_type)
          // means exactly one worker wins the row.
          const [claim] = await pool.query<ResultSetHeader>(
            `INSERT IGNORE INTO certification_reminders (course_student_id, student_email, reminder_type)
             VALUES (?, ?, ?)`,
            [row.course_student_id, row.email, reminderType]
          );
          if (!claim.affectedRows) { skipped++; continue; }

          try {
            const ok = await this.emailService.sendCertExpiryReminder(
              row.email,
              row.first_name || 'Student',
              row.course_type_name,
              row.certificate_number || 'N/A',
              row.certificate_expires_at,
              row.days_until_expiry,
            );
            if (ok) {
              sent++;
            } else {
              errors++;
              await this.releaseClaim(row.course_student_id, reminderType);
            }
          } catch (err) {
            logger.error({ err, email: row.email }, 'Failed to send cert reminder');
            errors++;
            await this.releaseClaim(row.course_student_id, reminderType);
          }
        }
      }

      logger.info({ sent, skipped, errors }, 'Certification reminders batch complete');
      return { sent, skipped, errors };
    } finally {
      try { await lockConn.query('SELECT RELEASE_LOCK(?)', [RUN_LOCK]); } catch { /* ignore */ }
      lockConn.release();
    }
  }

  /** Undo a claim so the reminder is retried on the next run. */
  private async releaseClaim(courseStudentId: number, reminderType: string): Promise<void> {
    try {
      await getPool().query(
        'DELETE FROM certification_reminders WHERE course_student_id = ? AND reminder_type = ?',
        [courseStudentId, reminderType]
      );
    } catch (err) {
      logger.warn({ err, courseStudentId, reminderType }, 'Could not release reminder claim');
    }
  }
}
