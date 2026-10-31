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
    // Only organization logins may request by email: the From address is not proven, so a staff or
    // instructor address must never be enough to create a request.
    `SELECT id, organization_id FROM users
     WHERE LOWER(email) = ? AND organization_id IS NOT NULL AND role IN ('org_admin', 'organization')
       AND status = 'active' LIMIT 1`,
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

/**
 * Picks the active course type that best matches the course name in an email.
 * An exact name (after normalizing) scores 1, one name containing the other
 * 0.85, otherwise the share of words in common. Returns the highest score, so
 * a weak match still comes back: the caller decides whether the confidence is
 * high enough. Null only when the text is empty or there are no course types.
 */
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

/**
 * Turns a date written in an email into YYYY-MM-DD. Accepts `2026-11-04` (also
 * with `/`, `.` or spaces, used the same way twice), `11/15/2026` (month first),
 * `15/11/2026` (day first, only when the first number can't be a month) and
 * written months in either order: `Nov 15, 2026`, `November 15th 2026`,
 * `15 Nov 2026`, `Mon, Nov 15, 2026`. A weekday that doesn't match the date is
 * refused as a probable typo. A date with no year is refused, and so is a
 * numeric one with dots, dashes or spaces that starts with the day or month
 * (`04.11.2026`), because it could be read two ways. Slashes are read month
 * first, as they always were. Returns null for a day that doesn't exist (Feb 30).
 */
export function normalizeDateText(text: string): string | null {
  const trimmed = text.trim();
  const weekdayMatch = trimmed.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i);
  const weekday = weekdayMatch ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekdayMatch[1].toLowerCase()) : null;

  // Drop the weekday, "of", ordinal endings (1st, 2nd, 3rd, 4th) and commas.
  const t = trimmed
    .slice(weekdayMatch ? weekdayMatch[0].length : 0)
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
    .replace(/\bof\b/gi, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const ok = (y: number, mo: number, d: number): string | null => {
    if (!isRealCalendarDate(y, mo, d)) return null;
    if (weekday !== null && new Date(y, mo - 1, d).getDay() !== weekday) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  };

  let m = t.match(/^(\d{4})([-/. ])(\d{1,2})\2(\d{1,2})$/);
  if (m) return ok(Number(m[1]), Number(m[3]), Number(m[4]));

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    // Month first by default; day first only when the first number can't be a month.
    return a > 12 ? ok(y, b, a) : ok(y, a, b);
  }

  m = t.match(/^([A-Za-z]+)\.? (\d{1,2}) (\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo ? ok(Number(m[3]), mo, Number(m[2])) : null;
  }

  m = t.match(/^(\d{1,2}) ([A-Za-z]+)\.? (\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? ok(Number(m[3]), mo, Number(m[1])) : null;
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

/**
 * Reads the fixed "Course: / Date: / Location: / Students:" email format.
 * Course, date and location are required (null if any is missing); students is
 * optional because colleges often don't know the count yet.
 */
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

  // Students is optional: colleges often don't know the count yet (TBC).
  if (!courseTypeText || !dateText || !location) return null;

  const scheduledDate = normalizeDateText(dateText);
  const registeredStudents = studentsText && /^\d+$/.test(studentsText.trim()) ? parseInt(studentsText, 10) : null;

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

    const scheduledDate = typeof parsed.scheduledDate === 'string' ? normalizeDateText(parsed.scheduledDate) : null;
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

/**
 * Checks that a webhook really came from Resend (Svix signature: HMAC-SHA256
 * over `id.timestamp.body`). False when the secret is not configured, a header
 * is missing, the timestamp is more than 5 minutes old, or no signature matches.
 */
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

/**
 * Why an email can't become a course request on its own, in plain words for
 * the Email Requests screen. An empty list means it is safe to auto-create.
 */
export function findReviewReasons(
  tier: 'template' | 'llm',
  fields: ExtractedFields,
  courseTypeMatch: CourseTypeMatch | null,
  llmConfidence?: LlmExtraction['confidence'],
  today: string = new Date().toISOString().slice(0, 10),
): string[] {
  const reasons: string[] = [];

  if (!fields.courseTypeText) {
    reasons.push('Course type missing');
  } else if (!courseTypeMatch || courseTypeMatch.confidence < AUTO_CREATE_COURSE_TYPE_MIN[tier]) {
    reasons.push(`"${fields.courseTypeText}" isn't a clear match for any of our courses`);
  }

  if (!fields.scheduledDate) {
    reasons.push('Date missing or not understood');
  } else if (fields.scheduledDate <= today) {
    // A same-day-or-past date is more likely a misparse than a real booking request.
    reasons.push(`Date (${fields.scheduledDate}) is today or in the past`);
  }

  if (!fields.location) reasons.push('Location missing');
  // No student count is fine: colleges often don't know it yet (owner
  // 2026-10-19). The request is booked with 0, shown as "TBC".

  if (tier === 'llm' && reasons.length === 0) {
    if (!llmConfidence) {
      reasons.push('The AI did not say how sure it was');
    } else {
      const unsure = [
        llmConfidence.scheduledDate < AUTO_CREATE_FIELD_MIN_LLM && 'date',
        llmConfidence.location < AUTO_CREATE_FIELD_MIN_LLM && 'location',
        fields.registeredStudents != null && llmConfidence.registeredStudents < AUTO_CREATE_FIELD_MIN_LLM && 'number of students',
      ].filter(Boolean);
      if (unsure.length) reasons.push(`The AI wasn't sure of the ${unsure.join(', ')}`);
    }
  }
  return reasons;
}

// --- Orchestration ---

/**
 * Turns an inbound email into a course request when it safely can, otherwise
 * files it for a person to review. Every email is saved as an `inbound_emails`
 * row with a status: `created_request`, `needs_review` (with the reason),
 * or `unmatched_sender` (the sender is not an organization login).
 */
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
      await this.repo.create({ ...row, status: 'needs_review', reject_reason: "The email's text couldn't be downloaded from Resend" } as Partial<InboundEmail>);
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
          reject_reason: "Not in the template format, and the AI couldn't read it",
        } as Partial<InboundEmail>);
        return;
      }
      fields = llm;
      llmConfidence = llm.confidence;
    }

    const courseTypeMatch = fields.courseTypeText ? resolveCourseType(fields.courseTypeText, classTypes) : null;
    const extracted = { ...fields, matchedCourseType: courseTypeMatch };

    const reasons = findReviewReasons(tier, fields, courseTypeMatch, llmConfidence);
    if (reasons.length > 0) {
      await this.repo.create({
        ...row, status: 'needs_review', parse_tier: tier,
        parse_confidence: courseTypeMatch?.confidence ?? null,
        extracted: extracted as unknown as Record<string, unknown>,
        reject_reason: reasons.join('; '),
      } as Partial<InboundEmail>);
      return;
    }

    try {
      const course = await this.courseService.createRequest({
        organizationId: sender.organizationId,
        courseTypeId: courseTypeMatch!.id,
        scheduledDate: fields.scheduledDate!,
        location: fields.location!,
        registeredStudents: fields.registeredStudents ?? 0,
        notes: [
          subject ? `Received by email — subject: "${subject}"` : 'Received by email',
          fields.registeredStudents == null ? 'Number of students to be confirmed.' : null,
        ].filter(Boolean).join(' '),
        source: 'email',
        requestedByUserId: sender.userId,
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
