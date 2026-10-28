import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { emailService } from './EmailService.js';
import { CertificatePDFService, type CertificatePDFData } from './CertificatePDFService.js';
import { completedClassDate } from '../utils/classDateSql.js';
import { torontoTodaySql } from '../utils/torontoDate.js';

const EMAIL_SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const NUMBER_SHAPE = /^GTACPR-\d{4}-\d{6,}$/;

export const formatCertificateNumber = (year: number, sequence: number) =>
  `GTACPR-${year}-${String(sequence).padStart(6, '0')}`;

/** Where a certificate can be checked by anyone. */
export const verifyUrl = (number?: string) =>
  `${env.FRONTEND_URL.replace(/\/+$/, '')}/verify${number ? `/${encodeURIComponent(number)}` : ''}`;

/**
 * Gives a number to every student in the scope who has certificate dates but no
 * number yet, and returns their ids. Run inside the transaction that sets the
 * dates: the counter row is locked until it commits, so two classes completing
 * together never share a number.
 */
export async function assignCertificateNumbers(
  conn: PoolConnection,
  scope: { classId: number | string } | { studentId: number | string }
): Promise<number[]> {
  const [where, id] = 'studentId' in scope ? ['cs.id = ?', scope.studentId] : ['cs.course_request_id = ?', scope.classId];
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT cs.id, YEAR(cs.certificate_issued_at) AS yr FROM course_students cs
     WHERE ${where} AND cs.certificate_issued_at IS NOT NULL AND cs.certificate_number IS NULL AND cs.deleted_at IS NULL
     ORDER BY cs.id FOR UPDATE`,
    [id]
  );
  if (!Array.isArray(rows)) return [];

  const numbered: number[] = [];
  for (const row of rows) {
    await conn.query('UPDATE certificate_counter SET last_number = LAST_INSERT_ID(last_number + 1) WHERE id = 1');
    const [seq] = await conn.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS n');
    await conn.query('UPDATE course_students SET certificate_number = ? WHERE id = ?',
      [formatCertificateNumber(Number(row.yr), Number(seq[0].n)), row.id]);
    numbered.push(Number(row.id));
  }
  return numbered;
}

export interface LoadedCertificate extends CertificatePDFData {
  course_student_id: number;
  organization_id: number | null;
  email: string | null;
}

/** A student's certificate, or null when they were not marked present or it has no number yet. */
export async function loadCertificate(courseStudentId: number | string): Promise<LoadedCertificate | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT cs.id, cs.email, cs.first_name, cs.last_name, cs.certificate_number,
            DATE_FORMAT(${completedClassDate('cr')}, '%Y-%m-%d') AS class_date,
            DATE_FORMAT(cs.certificate_expires_at, '%Y-%m-%d') AS expires_on,
            cr.organization_id, ct.name AS course_name,
            NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS instructor_name
     FROM course_students cs
     JOIN course_requests cr ON cs.course_request_id = cr.id
     JOIN class_types ct ON cr.course_type_id = ct.id
     LEFT JOIN users u ON u.id = cr.instructor_id
     WHERE cs.id = ? AND cs.deleted_at IS NULL AND cs.attended = true
       AND cs.certificate_number IS NOT NULL AND cs.certificate_issued_at IS NOT NULL`,
    [courseStudentId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    course_student_id: Number(r.id),
    organization_id: r.organization_id == null ? null : Number(r.organization_id),
    email: r.email ?? null,
    certificate_number: r.certificate_number,
    student_name: `${r.first_name} ${r.last_name}`.trim(),
    course_name: r.course_name,
    class_date: r.class_date,
    expires_on: r.expires_on ?? null,
    instructor_name: r.instructor_name ?? null,
    verify_url: verifyUrl(r.certificate_number),
  };
}

/** Every numbered certificate from one class, by surname, with the organization that booked it. */
export async function loadClassCertificates(classId: number | string): Promise<{ organization_id: number | null; certificates: LoadedCertificate[] }> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT cs.id FROM course_students cs
     WHERE cs.course_request_id = ? AND cs.deleted_at IS NULL AND cs.attended = true
       AND cs.certificate_number IS NOT NULL AND cs.certificate_issued_at IS NOT NULL
     ORDER BY cs.last_name, cs.first_name, cs.id`,
    [classId]
  );
  const certificates: LoadedCertificate[] = [];
  for (const r of rows) {
    const c = await loadCertificate(r.id);
    if (c) certificates.push(c);
  }
  return { organization_id: certificates[0]?.organization_id ?? null, certificates };
}

/** The class's certificates as one PDF, six to a page; null when none were issued. */
export async function generateClassSheet(classId: number | string): Promise<{ pdf: Buffer; organization_id: number | null; courseName: string; classDate: string; count: number } | null> {
  const { organization_id, certificates } = await loadClassCertificates(classId);
  if (certificates.length === 0) return null;
  return {
    pdf: await CertificatePDFService.generateCertificateSheetPDF(certificates),
    organization_id,
    courseName: certificates[0].course_name,
    classDate: certificates[0].class_date,
    count: certificates.length,
  };
}

/**
 * Emails the organization that booked a class one PDF of all its certificates,
 * six to a page: to its contact, with its admins copied. Meant to run after the
 * class is completed; never throws.
 */
export async function emailClassCertificateSheet(classId: number | string): Promise<boolean> {
  try {
    const sheet = await generateClassSheet(classId);
    if (!sheet || sheet.organization_id == null) return false;

    const pool = getPool();
    const [orgs] = await pool.query<RowDataPacket[]>('SELECT name, contact_email FROM organizations WHERE id = ?', [sheet.organization_id]);
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT email FROM users
       WHERE organization_id = ? AND role IN ('org_admin', 'organization') AND status = 'active'
         AND email IS NOT NULL AND email != ''`,
      [sheet.organization_id]
    );
    const seen = new Set<string>();
    const usable = [orgs[0]?.contact_email, ...admins.map((a) => a.email)]
      .map((e) => String(e ?? '').trim())
      .filter((e) => {
        const key = e.toLowerCase();
        if (!EMAIL_SHAPE.test(e) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (usable.length === 0) {
      logger.warn({ classId }, 'Class certificates not emailed: the organization has no usable email');
      return false;
    }
    const [to, ...cc] = usable;
    return await emailService.sendCertificateSheetEmail(to, {
      organizationName: String(orgs[0]?.name ?? ''),
      courseName: sheet.courseName,
      classDate: sheet.classDate,
      count: sheet.count,
      portalUrl: env.FRONTEND_URL,
    }, sheet.pdf, cc);
  } catch (err) {
    logger.error({ err, classId }, 'Failed to email the class certificate sheet');
    return false;
  }
}

export async function generateCertificatePdf(courseStudentId: number | string): Promise<{ pdf: Buffer; certificate: LoadedCertificate } | null> {
  const certificate = await loadCertificate(courseStudentId);
  if (!certificate) return null;
  return { pdf: await CertificatePDFService.generateCertificatePDF(certificate), certificate };
}

/**
 * Emails each of these students their certificate, once. Meant to run after the
 * transaction commits and never throws: a student without a usable email, or a
 * failed send, is logged and left for an admin to download the PDF instead.
 */
export async function emailCertificates(courseStudentIds: number[]): Promise<void> {
  for (const id of courseStudentIds) {
    try {
      const made = await generateCertificatePdf(id);
      if (!made || !made.certificate.email || !EMAIL_SHAPE.test(made.certificate.email)) continue;
      const { certificate: c, pdf } = made;

      // Claim first so a retry or a second click can never send it twice.
      const [claim] = await getPool().query<ResultSetHeader>(
        'UPDATE course_students SET certificate_emailed_at = CURRENT_TIMESTAMP WHERE id = ? AND certificate_emailed_at IS NULL', [id]);
      if (!claim.affectedRows) continue;

      const sent = await emailService.sendCertificateEmail(c.email!, {
        studentName: c.student_name, courseName: c.course_name, certificateNumber: c.certificate_number,
        expiresOn: c.expires_on, verifyUrl: c.verify_url,
      }, pdf);
      if (!sent) {
        await getPool().query('UPDATE course_students SET certificate_emailed_at = NULL WHERE id = ?', [id]);
      }
    } catch (err) {
      logger.error({ err, courseStudentId: id }, 'Failed to email certificate');
    }
  }
}

export interface CertificateCheck {
  number: string;
  /** First name and last initial only: enough to match a card, not to identify a person from a guessed number. */
  studentName: string;
  courseName: string;
  issuedOn: string;
  expiresOn: string | null;
  status: 'valid' | 'expired';
}

/** Public lookup by certificate number; null when there is no such certificate. */
export async function checkCertificate(rawNumber: string): Promise<CertificateCheck | null> {
  const number = rawNumber.trim().toUpperCase();
  if (!NUMBER_SHAPE.test(number)) return null;
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT cs.first_name, cs.last_name, cs.certificate_number, ct.name AS course_name,
            DATE_FORMAT(cs.certificate_issued_at, '%Y-%m-%d') AS issued_on,
            DATE_FORMAT(cs.certificate_expires_at, '%Y-%m-%d') AS expires_on,
            (cs.certificate_expires_at IS NOT NULL AND DATE(cs.certificate_expires_at) < ${torontoTodaySql()}) AS is_expired
     FROM course_students cs
     JOIN course_requests cr ON cs.course_request_id = cr.id
     JOIN class_types ct ON cr.course_type_id = ct.id
     WHERE cs.certificate_number = ? AND cs.deleted_at IS NULL AND cs.attended = true AND cs.certificate_issued_at IS NOT NULL`,
    [number]
  );
  const r = rows[0];
  if (!r) return null;
  const initial = String(r.last_name ?? '').trim().charAt(0).toUpperCase();
  return {
    number: r.certificate_number,
    studentName: `${String(r.first_name ?? '').trim()}${initial ? ` ${initial}.` : ''}`,
    courseName: r.course_name,
    issuedOn: r.issued_on,
    expiresOn: r.expires_on ?? null,
    status: Number(r.is_expired) ? 'expired' : 'valid',
  };
}
