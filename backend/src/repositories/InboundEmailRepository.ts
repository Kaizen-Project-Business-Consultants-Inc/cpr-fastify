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

  // `extracted` is a JSON column with a json_valid() CHECK. mysql2 doesn't
  // serialize a plain object for it, so the INSERT failed and the whole row
  // was lost. Serialize it here.
  async create(data: Partial<InboundEmail>): Promise<number> {
    const { extracted, ...rest } = data;
    const record = extracted === undefined
      ? rest
      : { ...rest, extracted: extracted === null ? null : JSON.stringify(extracted) };
    return super.create(record as Partial<InboundEmail>);
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
