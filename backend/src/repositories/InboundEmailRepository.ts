import { BaseRepository } from './BaseRepository.js';
import { getPool } from '../config/database.js';
import type { RowDataPacket } from 'mysql2/promise';

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
}

export class InboundEmailRepository extends BaseRepository<InboundEmail> {
  constructor() {
    super('inbound_emails', null, false);
  }

  async findByResendId(resendEmailId: string): Promise<InboundEmail | null> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT * FROM inbound_emails WHERE resend_email_id = ?',
      [resendEmailId]
    );
    return (rows[0] as InboundEmail) ?? null;
  }

  async findNeedsReview(): Promise<InboundEmail[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT * FROM inbound_emails WHERE status IN ('unmatched_sender', 'needs_review') ORDER BY created_at DESC LIMIT 100`
    );
    return rows as InboundEmail[];
  }
}
