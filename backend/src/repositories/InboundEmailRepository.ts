import { BaseRepository } from './BaseRepository.js';
import { getPool } from '../config/database.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type InboundEmailStatus =
  | 'received'
  | 'unmatched_sender'
  | 'needs_review'
  | 'created_request'
  | 'rejected';

export interface InboundEmail {
  id: number;
  resend_email_id: string;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  matched_organization_id: number | null;
  matched_user_id: number | null;
  parse_tier: 'template' | 'llm' | null;
  parse_confidence: number | null;
  extracted: Record<string, unknown> | null;
  status: InboundEmailStatus;
  course_request_id: number | null;
  reject_reason: string | null;
  created_at: Date;
  handled_at: Date | null;
  handled_by: number | null;
}

/** How long a handled email's text is kept (privacy policy, section 5). */
export const HANDLED_EMAIL_RETENTION_DAYS = 90;

const HANDLED: InboundEmailStatus[] = ['created_request', 'rejected'];

export class InboundEmailRepository extends BaseRepository<InboundEmail> {
  constructor() {
    super('inbound_emails', null, false);
  }

  // `extracted` is a JSON column with a json_valid() CHECK. mysql2 doesn't
  // serialize a plain object for it, so the INSERT failed and the whole row
  // was lost. Serialize it here.
  async create(data: Partial<InboundEmail>): Promise<number> {
    const { extracted, ...rest } = data;
    const record = extracted === undefined
      ? rest
      : { ...rest, extracted: extracted === null ? null : JSON.stringify(extracted) };
    const id = await super.create(record as Partial<InboundEmail>);
    // An auto-booked email is handled the moment it arrives. Stamp it with the
    // database clock, like transition(), so all handled times agree.
    if (data.status && HANDLED.includes(data.status)) {
      await getPool().query('UPDATE inbound_emails SET handled_at = NOW() WHERE id = ?', [id]);
    }
    return id;
  }

  async findByResendId(resendEmailId: string): Promise<InboundEmail | null> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT * FROM inbound_emails WHERE resend_email_id = ?',
      [resendEmailId]
    );
    return (rows[0] as InboundEmail) ?? null;
  }

  async findOne(id: number): Promise<InboundEmail | null> {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT * FROM inbound_emails WHERE id = ?', [id]);
    const row = rows[0] as InboundEmail | undefined;
    return row ? { ...row, extracted: parseExtracted(row.extracted) } : null;
  }

  /**
   * Move a row from one status to another only if it is still in `from`.
   * Returns false when someone else already changed it, so two staff
   * clicking at once can't both act on the same email.
   */
  async transition(id: number, from: InboundEmailStatus, to: InboundEmailStatus, extra: Partial<Pick<InboundEmail, 'course_request_id' | 'reject_reason' | 'handled_by'>> = {}): Promise<boolean> {
    const sets = ['status = ?'];
    const values: unknown[] = [to];
    if (HANDLED.includes(to)) { sets.push('handled_at = NOW()'); }
    if (extra.handled_by !== undefined) { sets.push('handled_by = ?'); values.push(extra.handled_by); }
    if (extra.course_request_id !== undefined) { sets.push('course_request_id = ?'); values.push(extra.course_request_id); }
    if (extra.reject_reason !== undefined) { sets.push('reject_reason = ?'); values.push(extra.reject_reason); }
    const [result] = await getPool().query<ResultSetHeader>(
      `UPDATE inbound_emails SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
      [...values, id, from]
    );
    return result.affectedRows === 1;
  }

  /** Emails already turned into a request or dismissed, newest first. */
  async findHandled(): Promise<(InboundEmail & { handled_by_name: string | null })[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT e.*, u.username AS handled_by_name
         FROM inbound_emails e
         LEFT JOIN users u ON u.id = e.handled_by
        WHERE e.status IN ('created_request', 'rejected')
        ORDER BY e.handled_at DESC
        LIMIT 200`
    );
    return (rows as (InboundEmail & { handled_by_name: string | null })[])
      .map((row) => ({ ...row, extracted: parseExtracted(row.extracted) }));
  }

  /**
   * Nightly clean-up: blank the text of emails that became a request, and
   * delete dismissed ones, once they were handled more than 90 days ago.
   * Emails still waiting for review are never touched.
   */
  async purgeHandled(days: number = HANDLED_EMAIL_RETENTION_DAYS): Promise<{ blanked: number; deleted: number }> {
    const [blanked] = await getPool().query<ResultSetHeader>(
      `UPDATE inbound_emails SET body_text = NULL
        WHERE status = 'created_request' AND body_text IS NOT NULL
          AND handled_at IS NOT NULL AND handled_at < NOW() - INTERVAL ? DAY`,
      [days]
    );
    const [deleted] = await getPool().query<ResultSetHeader>(
      `DELETE FROM inbound_emails
        WHERE status = 'rejected' AND handled_at IS NOT NULL AND handled_at < NOW() - INTERVAL ? DAY`,
      [days]
    );
    return { blanked: blanked.affectedRows, deleted: deleted.affectedRows };
  }

  async findNeedsReview(): Promise<InboundEmail[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT * FROM inbound_emails WHERE status IN ('unmatched_sender', 'needs_review') ORDER BY created_at DESC LIMIT 100`
    );
    // MariaDB's JSON type is LONGTEXT, so mysql2 returns it as a string.
    return (rows as InboundEmail[]).map((row) => ({ ...row, extracted: parseExtracted(row.extracted) }));
  }
}

function parseExtracted(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
