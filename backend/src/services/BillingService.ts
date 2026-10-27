import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { InvoiceRepository, Invoice, InvoiceWithDetails, DashboardData } from '../repositories/InvoiceRepository.js';
import { CoursePricingRepository, CoursePricing } from '../repositories/CoursePricingRepository.js';
import { InvoiceNumberService } from './InvoiceNumberService.js';
import { getHSTRate } from '../utils/taxConfig.js';
import { PaginationParams } from '../utils/pagination.js';
import type { PaymentRow, BillingQueueRow } from '../types/billing.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { writeAudit, type AuditActor } from '../utils/auditLog.js';
import { verifiedPayment } from '../utils/paymentSql.js';
import { emailService } from './EmailService.js';
import { env } from '../config/env.js';
import { completedClassDate } from '../utils/classDateSql.js';
import { torontoToday } from '../utils/torontoDate.js';
import { loadInvoiceForAccounting } from './invoiceDocument.js';

/** Resend refuses a whole message if one recipient is malformed, so only well-formed addresses are used. */
const EMAIL_SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+$/;

const INVOICE_DUE_DAYS = 30;
const RESEND_COOLDOWN_MS = 60_000;
// A safety cap only: far above the number of invoices the business makes.
const EXPORT_MAX_ROWS = 100000;

export class BillingError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'BillingError';
  }
}

export class BillingService {
  private invoiceNumberService = new InvoiceNumberService();

  constructor(
    private invoiceRepo: InvoiceRepository,
    private pricingRepo: CoursePricingRepository,
  ) {}

  // --- Dashboard ---

  async getDashboard(): Promise<DashboardData> {
    return this.invoiceRepo.getDashboard();
  }

  // --- Pricing ---

  async getAllPricing(): Promise<CoursePricing[]> {
    return this.pricingRepo.findAllActive();
  }

  async getOrgPricing(orgId: number): Promise<CoursePricing[]> {
    return this.pricingRepo.findByOrg(orgId);
  }

  async upsertPricing(orgId: number, courseTypeId: number, pricePerStudent: number): Promise<CoursePricing> {
    if (!orgId || !courseTypeId || !pricePerStudent || pricePerStudent <= 0) {
      throw new BillingError('All fields are required and price must be greater than 0');
    }
    return this.pricingRepo.upsert(orgId, courseTypeId, pricePerStudent);
  }

  async updatePricing(id: number, pricePerStudent: number): Promise<CoursePricing> {
    if (!pricePerStudent || pricePerStudent <= 0) {
      throw new BillingError('Valid price per student is required');
    }
    const updated = await this.pricingRepo.updatePrice(id, pricePerStudent);
    if (!updated) throw new BillingError('Course pricing record not found', 404);
    return updated;
  }

  async deletePricing(id: number): Promise<void> {
    const deleted = await this.pricingRepo.remove(id);
    if (!deleted) throw new BillingError('Course pricing not found', 404);
  }

  // --- Billing queue ---

  async getBillingQueue(): Promise<BillingQueueRow[]> {
    return this.invoiceRepo.getBillingQueue();
  }

  // --- Invoice creation ---

  async createInvoice(courseId: number, actor?: AuditActor): Promise<Invoice> {
    if (!courseId) throw new BillingError('Course ID is required');

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Get course + pricing details
      const [courseRows] = await conn.query<RowDataPacket[]>(
        `SELECT cr.id, cr.organization_id, ${completedClassDate('cr')} as completed_on, cr.location,
                o.name as organization_name, o.contact_email,
                ct.name as course_type_name,
                (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id AND cs.attended = true) as students_attended,
                cp.price_per_student,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username) as instructor_name
         FROM course_requests cr
         JOIN organizations o ON cr.organization_id = o.id
         JOIN class_types ct ON cr.course_type_id = ct.id
         JOIN course_pricing cp ON cr.organization_id = cp.organization_id
           AND cr.course_type_id = cp.course_type_id AND cp.is_active = true
         LEFT JOIN users u ON cr.instructor_id = u.id
         WHERE cr.id = ? AND cr.ready_for_billing = true`,
        [courseId]
      );

      if (courseRows.length === 0) {
        throw new BillingError('Course not found, not ready for billing, or pricing not configured', 404);
      }

      const course = courseRows[0];

      if (!course.contact_email) {
        throw new BillingError('Organization has no billing contact email. Please add one before creating an invoice.', 422);
      }

      const baseCost = course.students_attended * course.price_per_student;
      const taxAmount = baseCost * getHSTRate();
      const totalAmount = baseCost + taxAmount;
      const invoiceNumber = await this.invoiceNumberService.allocate(course.organization_id, conn);
      // Toronto's date: CURRENT_DATE is UTC and moves to tomorrow at 8 pm Toronto time.
      const today = torontoToday();

      // invoices.date_completed is a record only: the screens and PDF compute the
      // class date from course_requests (utils/classDateSql.ts).
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO invoices (
           invoice_number, organization_id, course_request_id, invoice_date,
           amount, base_cost, tax_amount, students_billed, status, due_date,
           posted_to_org, course_type_name, location, date_completed,
           rate_per_student, approval_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending',
           DATE_ADD(?, INTERVAL ? DAY), FALSE, ?, ?, ?, ?, 'pending')`,
        [invoiceNumber, course.organization_id, courseId, today, totalAmount, baseCost, taxAmount,
         course.students_attended, today, INVOICE_DUE_DAYS, course.course_type_name,
         course.location, course.completed_on, course.price_per_student]
      );

      // Mark course as invoiced
      await conn.query(
        `UPDATE course_requests SET invoiced = TRUE, invoiced_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [courseId]
      );

      if (actor) {
        await writeAudit(conn, { ...actor, action: 'create_invoice', entityType: 'invoice', entityId: result.insertId, details: { courseId, invoiceNumber, amount: totalAmount } });
      }
      await conn.commit();

      const invoice = await this.invoiceRepo.findById(result.insertId);
      logger.info({ invoiceId: result.insertId, courseId, invoiceNumber }, 'Invoice created');
      return invoice!;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // --- Invoice queries ---

  async getAllInvoices(pg?: PaginationParams) {
    return this.invoiceRepo.findAllWithDetails(pg);
  }

  /** Every invoice for the CSV export (the screen promises all of them). */
  async getAllInvoicesForExport(): Promise<InvoiceWithDetails[]> {
    const rows = await this.invoiceRepo.findAllWithDetails(undefined, EXPORT_MAX_ROWS);
    return Array.isArray(rows) ? rows : rows.data;
  }

  async getInvoiceById(id: number): Promise<InvoiceWithDetails> {
    const invoice = await this.invoiceRepo.findByIdWithDetails(id);
    if (!invoice) throw new BillingError('Invoice not found', 404);
    return invoice;
  }

  async getPendingApproval(pg?: PaginationParams) {
    return this.invoiceRepo.findPendingApproval(pg);
  }

  async getRejected(pg?: PaginationParams) {
    return this.invoiceRepo.findRejected(pg);
  }

  // --- Approval workflow ---

  async approve(id: number, approvedBy: number): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) throw new BillingError('Invoice not found', 404);
    if (invoice.approval_status !== 'pending') {
      throw new BillingError(`Invoice is already ${invoice.approval_status}`);
    }

    await this.invoiceRepo.execute(
      `UPDATE invoices SET approval_status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [approvedBy, id]
    );

    return (await this.invoiceRepo.findById(id))!;
  }

  async reject(id: number, reason: string, rejectedBy: number): Promise<Invoice> {
    if (!reason?.trim()) throw new BillingError('Rejection reason is required');

    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) throw new BillingError('Invoice not found', 404);
    if (invoice.approval_status !== 'pending') {
      throw new BillingError(`Invoice is already ${invoice.approval_status}`);
    }

    await this.invoiceRepo.execute(
      `UPDATE invoices SET approval_status = 'rejected', rejection_reason = ?,
       rejected_at = CURRENT_TIMESTAMP, rejected_by = ? WHERE id = ?`,
      [reason, rejectedBy, id]
    );

    return (await this.invoiceRepo.findById(id))!;
  }

  async resubmit(id: number): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) throw new BillingError('Invoice not found', 404);
    if (invoice.approval_status !== 'rejected') {
      throw new BillingError(`Only rejected invoices can be resubmitted`);
    }

    await this.invoiceRepo.execute(
      `UPDATE invoices SET approval_status = 'pending', rejection_reason = NULL,
       rejected_at = NULL, rejected_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    return (await this.invoiceRepo.findById(id))!;
  }

  // --- Post to org ---

  async postToOrg(id: number, postedBy: number, actor?: AuditActor): Promise<Invoice> {
    const pool = getPool();
    const conn = await pool.getConnection();
    let invoice: RowDataPacket;

    try {
      await conn.beginTransaction();

      const [invoiceRows] = await conn.query<RowDataPacket[]>(
        `SELECT i.*, o.name as organization_name, o.contact_email
         FROM invoices i JOIN organizations o ON i.organization_id = o.id
         WHERE i.id = ? AND i.posted_to_org = FALSE`,
        [id]
      );
      if (invoiceRows.length === 0) {
        throw new BillingError('Invoice not found or already posted', 404);
      }

      // Claim the invoice: two accountants (or a retry) posting at once must
      // not both get through and send the email twice.
      const [claimed] = await conn.query<ResultSetHeader>(
        `UPDATE invoices SET posted_to_org = TRUE, posted_to_org_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND posted_to_org = FALSE`,
        [id]
      );
      if (claimed.affectedRows !== 1) {
        throw new BillingError('Invoice not found or already posted', 404);
      }

      // Archive the course. (There is no archived_by column; the audit row
      // below records who posted it.)
      invoice = invoiceRows[0];
      if (invoice.course_request_id) {
        await conn.query(
          `UPDATE course_requests SET archived = TRUE, archived_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'completed'`,
          [invoice.course_request_id]
        );
      }

      if (actor) {
        await writeAudit(conn, { ...actor, action: 'post_invoice_to_org', entityType: 'invoice', entityId: id, details: { invoiceNumber: invoice.invoice_number, postedBy } });
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    logger.info({ invoiceId: id }, 'Invoice posted to org');
    // After the connection is released, so a slow email doesn't hold it.
    await this.notifyInvoicePosted(id, invoice);
    return (await this.invoiceRepo.findById(id))!;
  }

  /**
   * Emails the organization's contact, with the organization's admins copied and a PDF copy attached.
   * Returns whether it was sent. A failed email never undoes the posting, and a PDF that can't be made
   * is left off rather than blocking the email.
   */
  private async notifyInvoicePosted(id: number, invoice: RowDataPacket): Promise<boolean> {
    const contact = String(invoice.contact_email ?? '').trim();
    if (!contact) {
      logger.warn({ invoiceId: id }, 'Invoice posted, but the organization has no contact email');
      return false;
    }
    try {
      const seen = new Set<string>([contact.toLowerCase()]);
      const keep = (addresses: string[]) => addresses.map((e) => e.trim()).filter((e) => {
        const key = e.toLowerCase();
        if (!EMAIL_SHAPE.test(e) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // Admins are a courtesy copy: a failed lookup must not stop the contact getting the invoice.
      const admins = await this.orgAdminEmails(invoice.organization_id).catch((err) => {
        logger.warn({ invoiceId: id, err: err instanceof Error ? err.message : err }, 'Organization admins not copied on invoice email');
        return [] as string[];
      });
      const cc = keep(admins);
      const bcc = keep((env.INVOICE_COPY_TO ?? '').split(','));
      const pdf = await this.invoicePdf(id);
      const sent = await emailService.sendInvoicePostedEmail(contact, {
        invoiceNumber: String(invoice.invoice_number ?? id),
        organizationName: String(invoice.organization_name ?? ''),
        amount: `$${Number(invoice.amount ?? 0).toFixed(2)}`,
        dueDate: invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : 'on receipt',
        portalUrl: env.FRONTEND_URL,
      }, { pdf, cc, bcc });
      if (sent) await getPool().query('UPDATE invoices SET email_sent_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      return !!sent;
    } catch (err) {
      logger.error({ invoiceId: id, err: err instanceof Error ? err.message : err }, 'Invoice email failed');
      return false;
    }
  }

  private async orgAdminEmails(organizationId: number): Promise<string[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT email FROM users
       WHERE organization_id = ? AND role IN ('org_admin', 'organization') AND status = 'active'
         AND email IS NOT NULL AND email != ''`,
      [organizationId]
    );
    return rows.map((r) => String(r.email));
  }

  /** The invoice's PDF, or undefined when it can't be made (the email then goes without it). */
  private async invoicePdf(id: number): Promise<Buffer | undefined> {
    try {
      const data = await loadInvoiceForAccounting(id);
      if (!data) return undefined;
      const { PDFService } = await import('./PDFService.js');
      return await PDFService.generateInvoicePDF(data);
    } catch (err) {
      logger.warn({ invoiceId: id, err: err instanceof Error ? err.message : err }, 'Invoice PDF not attached');
      return undefined;
    }
  }

  /** Sends a posted invoice's email again (a bounce, or a changed contact). Accounting only. */
  async resendInvoiceEmail(id: number, actor?: AuditActor): Promise<void> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT i.*, o.name as organization_name, o.contact_email
       FROM invoices i JOIN organizations o ON i.organization_id = o.id WHERE i.id = ?`,
      [id]
    );
    if (rows.length === 0) throw new BillingError('Invoice not found', 404);
    if (!rows[0].posted_to_org) throw new BillingError('Post the invoice to the organization first', 409);
    if (!String(rows[0].contact_email ?? '').trim()) {
      throw new BillingError('Organization has no billing contact email. Please add one first.', 422);
    }
    // A double click or a second accountant must not mail everyone twice.
    const lastSent = rows[0].email_sent_at ? new Date(rows[0].email_sent_at).getTime() : 0;
    if (Date.now() - lastSent < RESEND_COOLDOWN_MS) throw new BillingError('This invoice was emailed less than a minute ago.', 429);
    if (!(await this.notifyInvoicePosted(id, rows[0]))) throw new BillingError('The email could not be sent. Try again shortly.', 502);
    // The email is out, so a failed audit row must not turn this into an error (a retry would mail again).
    if (actor) {
      try {
        const conn = await getPool().getConnection();
        try { await writeAudit(conn, { ...actor, action: 'resend_invoice_email', entityType: 'invoice', entityId: id, details: { invoiceNumber: rows[0].invoice_number } }); }
        finally { conn.release(); }
      } catch (err) {
        logger.error({ invoiceId: id, err: err instanceof Error ? err.message : err }, 'Audit entry for invoice email resend failed');
      }
    }
  }

  // --- Payments ---

  async getPayments(invoiceId: number): Promise<PaymentRow[]> {
    return this.invoiceRepo.getPayments(invoiceId);
  }

  async recordPayment(
    invoiceId: number,
    amount: number,
    paymentMethod: string,
    reference?: string,
    extra?: { paymentDate?: string; notes?: string },
    actor?: AuditActor,
  ): Promise<{ id: number; amount: number; totalPaid: number }> {
    if (!amount || amount <= 0) throw new BillingError('Valid payment amount is required');

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Lock the invoice row and get current payment totals in one atomic query
      const [locked] = await conn.query<RowDataPacket[]>(
        `SELECT i.id, i.amount, i.status,
                COALESCE(SUM(CASE WHEN ${verifiedPayment('p')} THEN p.amount ELSE 0 END), 0) as total_paid
         FROM invoices i
         LEFT JOIN payments p ON i.id = p.invoice_id
         WHERE i.id = ? AND i.deleted_at IS NULL
         GROUP BY i.id, i.amount, i.status
         FOR UPDATE`,
        [invoiceId]
      );

      if (!locked.length) {
        await conn.rollback();
        throw new BillingError('Invoice not found', 404);
      }

      const invoice = locked[0];
      const alreadyPaid = Number(invoice.total_paid);
      const remaining = Number(invoice.amount) - alreadyPaid;

      if (remaining <= 0) {
        await conn.rollback();
        throw new BillingError('Invoice is already fully paid');
      }

      if (amount > remaining + 0.01) {
        await conn.rollback();
        throw new BillingError(
          `Payment of $${amount.toFixed(2)} exceeds remaining balance of $${remaining.toFixed(2)}`
        );
      }

      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO payments (invoice_id, amount, payment_method, reference_number,
         payment_date, notes, status) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?, 'verified')`,
        [invoiceId, amount, paymentMethod, reference ?? null, extra?.paymentDate ?? null, extra?.notes ?? null]
      );

      const totalPaid = alreadyPaid + amount;

      if (totalPaid >= Number(invoice.amount)) {
        await conn.query(
          `UPDATE invoices SET status = 'paid', paid_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [invoiceId]
        );
      }

      if (actor) {
        await writeAudit(conn, { ...actor, action: 'record_payment', entityType: 'payment', entityId: result.insertId, details: { invoiceId, amount, paymentMethod, reference } });
      }
      await conn.commit();
      logger.info({ invoiceId, amount, paymentId: result.insertId }, 'Payment recorded');
      return { id: result.insertId, amount, totalPaid };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}
