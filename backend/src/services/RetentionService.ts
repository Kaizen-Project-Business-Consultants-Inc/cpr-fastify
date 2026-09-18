import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { logAudit } from '../utils/auditLog.js';
import type { RowDataPacket } from 'mysql2/promise';

/** MySQL named lock so only one Passenger worker runs retention at a time. */
const RUN_LOCK = 'cpr_retention';

/** PIPEDA: personal information is anonymised 2 years after an account is closed. */
const CLOSURE_RETENTION_YEARS = 2;

/** A closed account, per the statuses admin.ts allows on users.status. */
const CLOSED_STATUSES = ['inactive', 'deleted'];

/** Bound each run so a large backlog cannot lock the table. */
const BATCH_SIZE = 100;

/**
 * Sentinel written by the manual endpoint (DELETE /sysadmin/users/:userId/personal-data):
 * email = CONCAT('deleted_', id, '@deleted.invalid'). Rows carrying it are already
 * anonymised, so repeat runs are no-ops.
 */
const ANONYMISED_EMAIL_SUFFIX = '@deleted.invalid';

export interface RetentionResult {
  scanned: number;
  anonymised: number;
  skipped: number;
  errors: number;
}

interface CandidateRow {
  id: number;
  email: string | null;
  status: string | null;
  date_offboarded: string | Date | null;
  updated_at: string | Date | null;
}

/**
 * Automated PIPEDA data retention.
 *
 * Anonymises the PII on `users` rows whose account has been closed for more than
 * two years, using exactly the columns and values the manual sysadmin endpoint
 * writes so manual and automatic anonymisation agree.
 *
 * Course, invoice and payment records are never touched: those are kept 7 years.
 *
 * Dry run unless RETENTION_ENFORCE === 'true' — every query still runs, and the
 * transaction is rolled back so the first production runs are observable.
 */
export class RetentionService {
  async run(opts?: { dryRun?: boolean }): Promise<RetentionResult> {
    // Enforcement needs the env flag AND no explicit dry-run request.
    const dryRun = opts?.dryRun === true || process.env.RETENTION_ENFORCE !== 'true';
    const result: RetentionResult = { scanned: 0, anonymised: 0, skipped: 0, errors: 0 };

    let lockConn;
    try {
      const pool = getPool();
      // Named lock is per-connection: hold one connection for the whole run.
      lockConn = await pool.getConnection();
      const [lockRows] = await lockConn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [RUN_LOCK]);
      if (Number(lockRows[0]?.got) !== 1) {
        logger.info('Retention run skipped: another worker holds the lock');
        return result;
      }

      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - CLOSURE_RETENTION_YEARS);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email, status, date_offboarded, updated_at
           FROM users
          WHERE status IN (?)
            AND COALESCE(date_offboarded, updated_at) IS NOT NULL
            AND COALESCE(date_offboarded, updated_at) < ?
            AND (email IS NULL OR email NOT LIKE ?)
          ORDER BY COALESCE(date_offboarded, updated_at) ASC
          LIMIT ${BATCH_SIZE}`,
        [CLOSED_STATUSES, cutoff, `%${ANONYMISED_EMAIL_SUFFIX}`]
      );

      const candidates = (rows ?? []) as CandidateRow[];
      result.scanned = candidates.length;

      for (const row of candidates) {
        // Re-check every rule in code: the SQL filter is an optimisation, not the rule.
        if (!CLOSED_STATUSES.includes(String(row.status))) { result.skipped++; continue; }
        if (row.email && row.email.endsWith(ANONYMISED_EMAIL_SUFFIX)) { result.skipped++; continue; }

        // Never anonymise a row whose closure date cannot be established.
        const closureRaw = row.date_offboarded ?? row.updated_at;
        if (!closureRaw) { result.skipped++; continue; }
        const closedAt = new Date(closureRaw);
        if (Number.isNaN(closedAt.getTime()) || closedAt >= cutoff) { result.skipped++; continue; }

        try {
          await this.anonymiseUser(row.id, dryRun);
          result.anonymised++;
          logAudit({
            action: 'retention_anonymise',
            entityType: 'user',
            entityId: row.id,
            details: { dryRun, closedAt: closedAt.toISOString(), previousStatus: row.status },
          });
          logger.info(
            { userId: row.id, dryRun, closedAt: closedAt.toISOString() },
            dryRun ? 'Retention dry run: would anonymise user' : 'Retention: user anonymised'
          );
        } catch (err) {
          result.errors++;
          logger.error({ err, userId: row.id }, 'Retention: failed to anonymise user');
        }
      }

      logger.info({ ...result, dryRun, batchSize: BATCH_SIZE }, 'Retention run complete');
      return result;
    } catch (err) {
      // A missing table or column must never take the server down at boot.
      logger.warn({ err, dryRun }, 'Retention run aborted');
      return result;
    } finally {
      if (lockConn) {
        try { await lockConn.query('SELECT RELEASE_LOCK(?)', [RUN_LOCK]); } catch { /* ignore */ }
        lockConn.release();
      }
    }
  }

  /**
   * Anonymise one user inside its own transaction. Column list and values are copied
   * verbatim from the manual sysadmin endpoint in routes/admin.ts.
   * In dry-run mode the UPDATE runs and is then rolled back, so nothing is written.
   */
  private async anonymiseUser(userId: number, dryRun: boolean): Promise<void> {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE users SET username = CONCAT('deleted_', id), email = CONCAT('deleted_', id, '@deleted.invalid'),
         first_name = NULL, last_name = NULL, phone = NULL, status = 'deleted' WHERE id = ?`,
        [userId]
      );
      if (dryRun) {
        await conn.rollback();
      } else {
        await conn.commit();
      }
    } catch (err) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw err;
    } finally {
      conn.release();
    }
  }
}
