import type { FastifyReply } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../config/database.js';
import { completedClassDate } from '../utils/classDateSql.js';
import type { InvoicePDFData } from './PDFService.js';

type AttendanceRow = NonNullable<InvoicePDFData['attendance_list']>[number];

/** Accounting: any invoice, with everything its PDF and preview show. */
export function loadInvoiceForAccounting(id: number) {
  return loadInvoice(id, { scoped: false });
}

/** An organization's own invoice. A missing organization id finds nothing (404). */
export function loadInvoiceForOrganization(id: number, orgId: number | null) {
  return loadInvoice(id, { scoped: true, orgId });
}

/**
 * An invoice with everything its PDF and HTML preview show: organization,
 * course, rate and the attendance list (removed students left out).
 */
async function loadInvoice(id: number, scope: { scoped: false } | { scoped: true; orgId: number | null }): Promise<InvoicePDFData | null> {
  const pool = getPool();
  const { scoped } = scope;
  const orgId = scope.scoped ? scope.orgId : undefined;
  const [rows] = await pool.query<(RowDataPacket & InvoicePDFData)[]>(
    `SELECT i.*, o.name as organization_name, o.contact_email,
            cr.location, ${completedClassDate('cr')} as date_completed, cr.registered_students as students_billed,
            ct.name as course_type_name,
            COALESCE(i.rate_per_student, op.price_per_student) as rate_per_student
     FROM invoices i
     JOIN organizations o ON i.organization_id = o.id
     JOIN course_requests cr ON i.course_request_id = cr.id
     JOIN class_types ct ON cr.course_type_id = ct.id
     LEFT JOIN organization_pricing op ON op.organization_id = i.organization_id AND op.class_type_id = cr.course_type_id AND op.is_active = true
     WHERE i.id = ?${scoped ? ' AND i.organization_id = ?' : ''}`,
    scoped ? [id, orgId] : [id]
  );
  if (rows.length === 0) return null;

  const invoice = rows[0];
  const [students] = await pool.query<(RowDataPacket & AttendanceRow)[]>(
    `SELECT first_name, last_name, email, attended FROM course_students
     WHERE course_request_id = ? AND deleted_at IS NULL ORDER BY last_name, first_name`,
    [invoice.course_request_id]
  );
  invoice.attendance_list = students;
  invoice.invoice_id = invoice.id;
  return invoice;
}

/** Replies with the invoice as a PDF download named `Invoice-<number>.pdf`. */
export async function sendInvoicePdf(reply: FastifyReply, invoice: InvoicePDFData) {
  const { PDFService } = await import('./PDFService.js');
  const pdfBuffer = await PDFService.generateInvoicePDF(invoice);
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `attachment; filename="Invoice-${invoice.invoice_number}.pdf"`);
  reply.header('Content-Length', pdfBuffer.length);
  return reply.send(pdfBuffer);
}

/** Replies with the invoice as an HTML page, the same layout as the PDF. */
export async function sendInvoicePreview(reply: FastifyReply, invoice: InvoicePDFData) {
  const { PDFService } = await import('./PDFService.js');
  reply.header('Content-Type', 'text/html');
  return reply.send(PDFService.getInvoicePreviewHTML(invoice));
}
