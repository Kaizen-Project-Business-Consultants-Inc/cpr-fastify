import crypto from 'crypto';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { InboundEmailRepository, InboundEmail } from '../repositories/InboundEmailRepository.js';
import { CourseService, CourseError } from './CourseService.js';
import type { RowDataPacket } from 'mysql2/promise';

// --- Sender matching ---

interface MatchedSender {
  organizationId: number;
  userId: number;
}

async function matchSender(fromHeader: string): Promise<MatchedSender | null> {
  const emailMatch = fromHeader.match(/<([^>]+)>/);
  const address = (emailMatch ? emailMatch[1] : fromHeader).trim().toLowerCase();
  if (!address) return null;

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, organization_id FROM users
     WHERE LOWER(email) = ? AND organization_id IS NOT NULL AND status = 'active' LIMIT 1`,
    [address]
  );
  const row = rows[0];
  if (!row?.organization_id) return null;
  return { organizationId: row.organization_id, userId: row.id };
}

// --- Course type fuzzy matching ---

interface CourseTypeMatch {
  id: number;
  name: string;
  confidence: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveCourseType(text: string, classTypes: { id: number; name: string }[]): CourseTypeMatch | null {
  const target = normalize(text);
  if (!target) return null;

  let best: CourseTypeMatch | null = null;
  for (const ct of classTypes) {
    const candidate = normalize(ct.name);
    let score: number;
    if (candidate === target) {
      score = 1;
    } else if (candidate.includes(target) || target.includes(candidate)) {
      score = 0.85;
    } else {
      const targetWords = new Set(target.split(' '));
      const candidateWords = new Set(candidate.split(' '));
      const overlap = [...targetWords].filter((w) => candidateWords.has(w)).length;
      const union = new Set([...targetWords, ...candidateWords]).size;
      score = union > 0 ? overlap / union : 0;
    }
    if (!best || score > best.confidence) best = { id: ct.id, name: ct.name, confidence: score };
  }
  return best;
}

async function getActiveClassTypes(): Promise<{ id: number; name: string }[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, name FROM class_types WHERE is_active = true');
  return rows as { id: number; name: string }[];
}

// --- Date normalization (deliberately not Date.parse — its local/UTC
// handling differs by input shape, which is exactly the bug class that bit
// this codebase's own test code earlier; parse explicit formats instead) ---

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function normalizeDateText(text: string): string | null {
  const t = text.trim();

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m.map(Number) as unknown as number[];
    return isRealCalendarDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m.map(Number) as unknown as number[];
    return isRealCalendarDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }

  m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (!mo) return null;
    return isRealCalendarDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }

  return null;
}

// --- Tier 1: fixed-template parser ---

interface ExtractedFields {
  courseTypeText: string | null;
  scheduledDate: string | null;
  location: string | null;
  registeredStudents: number | null;
}

export function parseTemplate(body: string): ExtractedFields | null {
  const get = (label: string): string | null => {
    const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
    const m = body.match(re);
    return m ? m[1].trim() : null;
  };

  const courseTypeText = get('course');
  const dateText = get('date');
  const location = get('location');
  const studentsText = get('students');

  if (!courseTypeText || !dateText || !location || !studentsText) return null;

  const scheduledDate = normalizeDateText(dateText);
  const registeredStudents = /^\d+$/.test(studentsText.trim()) ? parseInt(studentsText, 10) : null;

  return { courseTypeText, scheduledDate, location, registeredStudents };
}

// --- Tier 2: LLM extraction fallback ---

interface LlmExtraction extends ExtractedFields {
  confidence: { courseType: number; scheduledDate: number; location: number; registeredStudents: number };
}

async function parseWithLlm(body: string, classTypeNames: string[]): Promise<LlmExtraction | null> {
  if (!env.ANTHROPIC_API_KEY) return null;

  const prompt = `A client emailed a CPR training company asking to book a course. Extract the request as JSON only, no other text.

Known course types: ${classTypeNames.join(', ')}

Return exactly this JSON shape:
{"courseType": string|null, "scheduledDate": "YYYY-MM-DD"|null, "location": string|null, "registeredStudents": number|null,
 "confidence": {"courseType": 0-1, "scheduledDate": 0-1, "location": 0-1, "registeredStudents": 0-1}}

Rules: set a field to null (and its confidence to 0) if it isn't clearly stated in the email. Never guess a date, course type, or headcount that isn't reasonably implied by the text.

Email body:
"""
${body.slice(0, 4000)}
"""`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.error({ status: response.status }, 'Anthropic API error during inbound-email extraction');
      return null;
    }

    const data = await response.json() as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) return null;

    // The model is asked for JSON only, but never trust it blindly — parse
    // defensively and validate every field's shape before using it.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const scheduledDate = typeof parsed.scheduledDate === 'string' ? normalizeDateText(parsed.scheduledDate) ?? (/^\d{4}-\d{2}-\d{2}$/.test(parsed.scheduledDate) ? parsed.scheduledDate : null) : null;
    const registeredStudents = typeof parsed.registeredStudents === 'number' && Number.isInteger(parsed.registeredStudents) && parsed.registeredStudents > 0
      ? parsed.registeredStudents : null;
    const location = typeof parsed.location === 'string' && parsed.location.trim() ? parsed.location.trim() : null;
    const courseTypeText = typeof parsed.courseType === 'string' && parsed.courseType.trim() ? parsed.courseType.trim() : null;
    const conf = (parsed.confidence ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : 0);

    return {
      courseTypeText, scheduledDate, location, registeredStudents,
      confidence: {
        courseType: num(conf.courseType),
        scheduledDate: num(conf.scheduledDate),
        location: num(conf.location),
        registeredStudents: num(conf.registeredStudents),
      },
    };
  } catch (err) {
    logger.error({ err }, 'Inbound-email LLM extraction failed');
    return null;
  }
}

// --- Webhook signature verification (Standard Webhooks / Svix scheme) ---

export function verifyResendSignature(
  rawBody: string,
  headers: { 'svix-id'?: string; 'svix-timestamp'?: string; 'svix-signature'?: string }
): boolean {
  if (!env.RESEND_WEBHOOK_SECRET) return false;
  const { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Reject stale timestamps (> 5 min) to limit replay of a captured payload.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  return signature.split(' ').some((sig) => {
    const [, value] = sig.split(',');
    if (!value) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

// --- Fetch the actual body via Resend's Received Emails API (the webhook
// payload itself is metadata-only) ---

async function fetchEmailBody(emailId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!response.ok) {
      logger.error({ emailId, status: response.status }, 'Resend receiving-email fetch failed');
      return null;
    }
    const data = await response.json() as { text?: string; html?: string };
    return data.text ?? data.html ?? null;
  } catch (err) {
    logger.error({ err, emailId }, 'Resend receiving-email fetch threw');
    return null;
  }
}

// --- Confidence gate for auto-creating a request ---

const AUTO_CREATE_COURSE_TYPE_MIN = { template: 0.6, llm: 0.8 };
const AUTO_CREATE_FIELD_MIN_LLM = 0.85;

function isReadyToAutoCreate(
  tier: 'template' | 'llm',
  fields: ExtractedFields,
  courseTypeMatch: CourseTypeMatch | null,
  llmConfidence?: LlmExtraction['confidence']
): boolean {
  if (!courseTypeMatch || courseTypeMatch.confidence < AUTO_CREATE_COURSE_TYPE_MIN[tier]) return false;
  if (!fields.scheduledDate || !fields.location || !fields.registeredStudents) return false;
  if (fields.registeredStudents < 1) return false;
  // A same-day-or-past date is more likely a misparse than a real booking request.
  if (fields.scheduledDate <= new Date().toISOString().slice(0, 10)) return false;

  if (tier === 'llm') {
    if (!llmConfidence) return false;
    const values = [llmConfidence.scheduledDate, llmConfidence.location, llmConfidence.registeredStudents];
    if (values.some((v) => v < AUTO_CREATE_FIELD_MIN_LLM)) return false;
  }
  return true;
}

// --- Orchestration ---

export class InboundEmailService {
  constructor(
    private repo: InboundEmailRepository,
    private courseService: CourseService,
  ) {}

  async processReceivedEmail(emailId: string, fromHeader: string, subject: string | null): Promise<void> {
    const existing = await this.repo.findByResendId(emailId);
    if (existing) return; // idempotent — Resend/Svix may redeliver

    const body = await fetchEmailBody(emailId);
    const sender = body ? await matchSender(fromHeader) : null;

    const row: Partial<InboundEmail> = {
      resend_email_id: emailId,
      from_address: fromHeader,
      subject,
      body_text: body,
      matched_organization_id: sender?.organizationId ?? null,
      matched_user_id: sender?.userId ?? null,
    };

    if (!body) {
      await this.repo.create({ ...row, status: 'needs_review', reject_reason: 'Could not fetch email body from Resend' } as Partial<InboundEmail>);
      return;
    }
    if (!sender) {
      await this.repo.create({ ...row, status: 'unmatched_sender' } as Partial<InboundEmail>);
      return;
    }

    const classTypes = await getActiveClassTypes();

    let tier: 'template' | 'llm' = 'template';
    let fields = parseTemplate(body);
    let llmConfidence: LlmExtraction['confidence'] | undefined;

    if (!fields) {
      tier = 'llm';
      const llm = await parseWithLlm(body, classTypes.map((c) => c.name));
      if (!llm) {
        await this.repo.create({
          ...row, status: 'needs_review',
          reject_reason: 'Did not match the email template and LLM extraction was unavailable or failed',
        } as Partial<InboundEmail>);
        return;
      }
      fields = llm;
      llmConfidence = llm.confidence;
    }

    const courseTypeMatch = fields.courseTypeText ? resolveCourseType(fields.courseTypeText, classTypes) : null;
    const extracted = { ...fields, matchedCourseType: courseTypeMatch };

    if (!isReadyToAutoCreate(tier, fields, courseTypeMatch, llmConfidence)) {
      await this.repo.create({
        ...row, status: 'needs_review', parse_tier: tier,
        parse_confidence: courseTypeMatch?.confidence ?? null,
        extracted: extracted as unknown as Record<string, unknown>,
      } as Partial<InboundEmail>);
      return;
    }

    try {
      const course = await this.courseService.createRequest({
        organizationId: sender.organizationId,
        courseTypeId: courseTypeMatch!.id,
        scheduledDate: fields.scheduledDate!,
        location: fields.location!,
        registeredStudents: fields.registeredStudents!,
        notes: subject ? `Received by email — subject: "${subject}"` : 'Received by email',
        source: 'email',
      });
      await this.repo.create({
        ...row, status: 'created_request', parse_tier: tier,
        parse_confidence: courseTypeMatch!.confidence,
        extracted: extracted as unknown as Record<string, unknown>,
        course_request_id: course.id,
      } as Partial<InboundEmail>);
      logger.info({ emailId, courseId: course.id }, 'Course request auto-created from inbound email');
    } catch (err) {
      const reason = err instanceof CourseError ? err.message : 'Failed to create course request';
      await this.repo.create({
        ...row, status: 'needs_review', parse_tier: tier,
        parse_confidence: courseTypeMatch?.confidence ?? null,
        extracted: extracted as unknown as Record<string, unknown>,
        reject_reason: reason,
      } as Partial<InboundEmail>);
    }
  }
}
