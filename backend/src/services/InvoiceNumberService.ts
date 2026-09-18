import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';

interface InvoiceSequence {
  id: number;
  organization_id: number;
  prefix: string;
  format_string: string;
  padding: number;
  next_number: number;
  step: number;
  reset_policy: 'none' | 'yearly' | 'monthly';
  last_reset_period: string | null;
}

/**
 * Generates invoice numbers using per-org configurable sequences.
 * Falls back to system default (INV-YYYY-NNNNNN) when no org sequence exists.
 *
 * Format tokens: {PREFIX}, {YYYY}, {YY}, {MM}, {DD}, {NN}/{NNN}/{NNNN} etc.
 * The number of N's in the token determines padding (overrides the `padding` column).
 */
export class InvoiceNumberService {

  /**
   * Allocate the next invoice number for an organization.
   * Must be called within an existing transaction (pass the connection).
   */
  async allocate(orgId: number, conn: PoolConnection): Promise<string> {
    // Lock the sequence row (or discover it doesn't exist)
    const [rows] = await conn.query<(RowDataPacket & InvoiceSequence)[]>(
      'SELECT * FROM invoice_number_sequences WHERE organization_id = ? FOR UPDATE',
      [orgId]
    );

    if (rows.length === 0) {
      return this.generateDefault();
    }

    const seq: InvoiceSequence = rows[0];
    const now = new Date();

    // Handle reset policy
    const currentPeriod = this.getCurrentPeriod(seq.reset_policy, now);
    let number = seq.next_number;

    if (currentPeriod && seq.last_reset_period !== currentPeriod) {
      // Period changed — reset counter
      number = 1;
      await conn.query(
        `UPDATE invoice_number_sequences
         SET next_number = ?, last_reset_period = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [number + seq.step, currentPeriod, seq.id]
      );
    } else {
      // Normal increment
      await conn.query(
        `UPDATE invoice_number_sequences
         SET next_number = next_number + step, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [seq.id]
      );
    }

    return this.format(seq, number, now);
  }

  /**
   * Preview what the next invoice number would look like (no allocation).
   */
  async preview(orgId: number): Promise<string> {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & InvoiceSequence)[]>(
      'SELECT * FROM invoice_number_sequences WHERE organization_id = ?',
      [orgId]
    );

    if (rows.length === 0) {
      return this.generateDefault();
    }

    const seq: InvoiceSequence = rows[0];
    const now = new Date();
    const currentPeriod = this.getCurrentPeriod(seq.reset_policy, now);
    const number = (currentPeriod && seq.last_reset_period !== currentPeriod) ? 1 : seq.next_number;

    return this.format(seq, number, now);
  }

  /**
   * Get sequence config for an org (or null if using default).
   */
  async getSequence(orgId: number): Promise<InvoiceSequence | null> {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & InvoiceSequence)[]>(
      'SELECT * FROM invoice_number_sequences WHERE organization_id = ?',
      [orgId]
    );
    return rows[0] ?? null;
  }

  /**
   * Get all configured sequences.
   */
  async getAllSequences(): Promise<(InvoiceSequence & { organization_name: string })[]> {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & InvoiceSequence & { organization_name: string })[]>(
      `SELECT s.*, o.name as organization_name
       FROM invoice_number_sequences s
       JOIN organizations o ON s.organization_id = o.id
       ORDER BY o.name`
    );
    return rows;
  }

  /**
   * Create or update a sequence for an org.
   */
  async upsert(orgId: number, config: {
    prefix?: string;
    format_string?: string;
    padding?: number;
    next_number?: number;
    step?: number;
    reset_policy?: 'none' | 'yearly' | 'monthly';
  }): Promise<InvoiceSequence> {
    const pool = getPool();

    await pool.query(
      `INSERT INTO invoice_number_sequences (organization_id, prefix, format_string, padding, next_number, step, reset_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         prefix = VALUES(prefix),
         format_string = VALUES(format_string),
         padding = VALUES(padding),
         next_number = VALUES(next_number),
         step = VALUES(step),
         reset_policy = VALUES(reset_policy),
         updated_at = CURRENT_TIMESTAMP`,
      [
        orgId,
        config.prefix ?? 'INV',
        config.format_string ?? '{PREFIX}-{YYYY}-{NNNN}',
        config.padding ?? 4,
        config.next_number ?? 1,
        config.step ?? 1,
        config.reset_policy ?? 'none',
      ]
    );

    const [rows] = await pool.query<(RowDataPacket & InvoiceSequence)[]>(
      'SELECT * FROM invoice_number_sequences WHERE organization_id = ?',
      [orgId]
    );

    logger.info({ orgId, prefix: config.prefix }, 'Invoice sequence upserted');
    return rows[0];
  }

  /**
   * Delete a sequence (org reverts to system default).
   */
  async deleteSequence(orgId: number): Promise<boolean> {
    const pool = getPool();
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM invoice_number_sequences WHERE organization_id = ?',
      [orgId]
    );
    return result.affectedRows > 0;
  }

  // --- Private helpers ---

  private generateDefault(): string {
    const now = new Date();
    const year = now.getFullYear();
    // Use timestamp + random suffix for uniqueness (replacing old Date.now().slice(-6))
    const seq = String(Date.now()).slice(-6);
    const rand = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    return `INV-${year}-${seq}${rand}`;
  }

  private getCurrentPeriod(policy: string, now: Date): string | null {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    switch (policy) {
      case 'yearly': return String(year);
      case 'monthly': return `${year}-${month}`;
      default: return null;
    }
  }

  private format(seq: InvoiceSequence, number: number, now: Date): string {
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    let result = seq.format_string;

    // Replace tokens
    result = result.replace(/\{PREFIX\}/g, seq.prefix);
    result = result.replace(/\{YYYY\}/g, year);
    result = result.replace(/\{YY\}/g, year.slice(-2));
    result = result.replace(/\{MM\}/g, month);
    result = result.replace(/\{DD\}/g, day);

    // Replace {NN...} with padded number — padding determined by number of N's
    result = result.replace(/\{(N+)\}/g, (_match, ns: string) => {
      return String(number).padStart(ns.length, '0');
    });

    return result;
  }
}
