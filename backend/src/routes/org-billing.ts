import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { writeAudit } from '../utils/auditLog.js';
import { toCSV } from '../utils/csv.js';
import { maybePaginate, rowsOf, metaOf } from '../utils/pagination.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { PaymentPDFData } from '../services/PDFService.js';
import { VERIFIED_PAYMENT_FILTER, VERIFIED_PAID_BY_INVOICE, verifiedPayment, pendingPayment } from '../utils/paymentSql.js';
import { loadInvoiceForOrganization, sendInvoicePdf } from '../services/invoiceDocument.js';
import { completedClassDate } from '../utils/classDateSql.js';

const INVOICE_SORT_COLS = new Set(['created_at', 'due_date', 'amount', 'status', 'invoice_date', 'invoice_number']);
const PAID_SORT_COLS = new Set(['paid_date', 'created_at', 'amount', 'invoice_number']);

const paymentSubmissionSchema = z.object({
  payment_method: z.string().min(1, 'Payment method is required'),
  reference_number: z.string().optional(),
  payment_date: z.string().optional(),
  amount: z.number().positive('Valid payment amount is required'),
  notes: z.string().optional(),
});

export async function orgBillingRoutes(app: FastifyInstance) {
  const pool = getPool();
  const orgRole = [requireRole('organization')];
  const acctRole = [requireRole('accountant', 'admin')];

  // ===== Organization: List invoices (bills payable) =====
  app.get('/organization/invoices', { preHandler: orgRole }, async (request) => {
    const { status, page = '1', limit = '10', sort_by = 'created_at', sort_order = 'desc' } = request.query as Record<string, string>;
    const safeLimit = Math.min(parseInt(limit), 200);
    const offset = (parseInt(page) - 1) * safeLimit;
    const safeSortBy = INVOICE_SORT_COLS.has(sort_by) ? sort_by : 'created_at';
    const safeSortOrder = sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let where = 'WHERE i.organization_id = ? AND i.posted_to_org = TRUE';
    const params: unknown[] = [request.userOrgId];

    if (status) { where += ' AND i.status = ?'; params.push(status); }
    // Exclude fully paid invoices from AR
    where += ` AND (i.status != 'paid' AND (i.base_cost + i.tax_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND ${VERIFIED_PAYMENT_FILTER}), 0)) > 0)`;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT i.id, i.invoice_number, i.created_at as invoice_date, i.due_date, i.amount,
              i.status, i.students_billed, i.paid_date,
              cr.location, ct.name as course_type_name, ${completedClassDate('cr')} as course_date,
              cr.id as course_request_id,
              COALESCE(SUM(CASE WHEN ${verifiedPayment('p')} THEN p.amount ELSE 0 END), 0) as amount_paid,
              GREATEST(0, (i.base_cost + i.tax_amount) - COALESCE(SUM(CASE WHEN ${verifiedPayment('p')} THEN p.amount ELSE 0 END), 0)) as balance_due,
              cp.price_per_student as rate_per_student,
              i.base_cost, i.tax_amount,
              CASE
                WHEN COALESCE(SUM(CASE WHEN ${verifiedPayment('p')} THEN p.amount ELSE 0 END), 0) >= (i.base_cost + i.tax_amount) THEN 'paid'
                WHEN CURRENT_DATE > i.due_date THEN 'overdue'
                ELSE 'pending'
              END as payment_status
       FROM invoice_with_breakdown i
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN course_pricing cp ON cr.organization_id = cp.organization_id AND cr.course_type_id = cp.course_type_id AND cp.is_active = true
       LEFT JOIN payments p ON i.id = p.invoice_id
       ${where}
       GROUP BY i.id, i.invoice_number, i.created_at, i.due_date, i.amount, i.status, i.students_billed, i.paid_date, i.base_cost, i.tax_amount, cr.id, ct.id, cp.price_per_student
       ORDER BY i.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT i.id) as total FROM invoice_with_breakdown i
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id ${where}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    return {
      success: true,
      data: {
        invoices: rows.map(r => ({ ...r, rate_per_student: r.rate_per_student ? parseFloat(r.rate_per_student) : null })),
        pagination: { current_page: parseInt(page), total_pages: Math.ceil(total / safeLimit), total_records: total, per_page: safeLimit },
      },
    };
  });

  // ===== Organization: Export invoices CSV =====
  app.get('/organization/invoices/export/csv', { preHandler: orgRole }, async (request, reply) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT i.invoice_number, i.created_at as invoice_date, i.due_date,
              ct.name as course_type, i.students_billed,
              i.base_cost, i.tax_amount,
              (i.base_cost + i.tax_amount) as total,
              CASE
                WHEN COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount) THEN 'paid'
                WHEN CURRENT_DATE > i.due_date THEN 'overdue'
                ELSE 'pending'
              END as payment_status
       FROM invoice_with_breakdown i
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN ${VERIFIED_PAID_BY_INVOICE} payments ON payments.invoice_id = i.id
       WHERE i.organization_id = ? AND i.posted_to_org = TRUE
       ORDER BY i.created_at DESC`,
      [request.userOrgId]
    );
    const csv = toCSV(rows, [
      { key: 'invoice_number', label: 'Invoice Number' },
      { key: 'invoice_date', label: 'Date' },
      { key: 'due_date', label: 'Due Date' },
      { key: 'course_type', label: 'Course' },
      { key: 'students_billed', label: 'Students Billed' },
      { key: 'base_cost', label: 'Amount' },
      { key: 'tax_amount', label: 'Tax' },
      { key: 'total', label: 'Total' },
      { key: 'payment_status', label: 'Payment Status' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="invoices-${new Date().toISOString().split('T')[0]}.csv"`);
    return reply.send(csv);
  });

  // ===== Organization: Invoice payment history =====
  app.get('/organization/invoices/:id/payments', { preHandler: orgRole }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [check] = await pool.query<RowDataPacket[]>('SELECT id FROM invoices WHERE id = ? AND organization_id = ?', [id, request.userOrgId]);
    if (check.length === 0) return reply.status(404).send({ error: 'Invoice not found' });

    // Snake_case names are kept for older readers; the camelCase aliases are
    // what the shared PaymentHistoryTable reads.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, invoice_id, invoice_id as invoiceId,
              amount, amount as amount_paid, amount as amountPaid,
              payment_date, payment_date as paymentDate,
              payment_method, payment_method as paymentMethod,
              reference_number, reference_number as referenceNumber,
              notes, status, created_at, created_at as createdAt,
              submitted_by_org_at, submitted_by_org_at as submittedByOrgAt,
              verified_by_accounting_at, verified_by_accounting_at as verifiedByAccountingAt,
              reversed_at, reversed_by
       FROM payments WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY payment_date DESC`,
      [id]
    );
    return { success: true, data: rows };
  });

  // ===== Calculate balance (any authenticated user) =====
  app.get('/invoices/:id/calculate-balance', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rawAmount = parseFloat(String((request.query as { amount?: string }).amount));
    if (isNaN(rawAmount) || rawAmount < 0 || rawAmount > 9999999) return reply.status(400).send({ error: 'Invalid payment amount' });

    const isOrgUser = request.userRole === 'organization';
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT i.id, i.amount, i.status, i.organization_id,
              COALESCE(SUM(CASE WHEN ${verifiedPayment('p')} THEN p.amount ELSE 0 END), 0) as verified_payments,
              COALESCE(SUM(CASE WHEN ${pendingPayment('p')} THEN p.amount ELSE 0 END), 0) as pending_payments
       FROM invoices i LEFT JOIN payments p ON i.id = p.invoice_id
       WHERE i.id = ? AND (? IS NULL OR i.organization_id = ?)
       GROUP BY i.id, i.amount, i.status, i.organization_id`,
      [id, isOrgUser ? request.userOrgId : null, isOrgUser ? request.userOrgId : null]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Invoice not found' });

    const inv = rows[0];
    const total = parseFloat(inv.amount) || 0;
    const verified = parseFloat(inv.verified_payments) || 0;
    const pending = parseFloat(inv.pending_payments) || 0;
    const outstanding = total - verified - pending;
    const remaining = outstanding - rawAmount;

    return {
      success: true,
      data: {
        invoice_total: total,
        verified_payments: verified,
        pending_payments: pending,
        current_outstanding_balance: Math.max(0, outstanding),
        proposed_payment: rawAmount,
        remaining_balance_after_payment: Math.max(0, remaining),
        is_valid_payment: rawAmount > 0 && rawAmount <= outstanding + 0.01,
        is_overpayment: rawAmount > outstanding + 0.01,
        is_full_payment: Math.abs(remaining) < 0.01,
        can_submit_payment: rawAmount > 0 && rawAmount <= outstanding + 0.01 && inv.status !== 'paid',
      },
    };
  });

  // ===== Organization: Submit payment =====
  app.post('/organization/invoices/:id/payment-submission', { preHandler: orgRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = paymentSubmissionSchema.parse(request.body);

    // Verify invoice belongs to org and get balance
    const [invRows] = await pool.query<RowDataPacket[]>(
      `SELECT i.id, i.amount, i.status, i.organization_id,
              COALESCE(SUM(CASE WHEN ${verifiedPayment('p')} THEN p.amount ELSE 0 END), 0) as verified_payments,
              COALESCE(SUM(CASE WHEN ${pendingPayment('p')} THEN p.amount ELSE 0 END), 0) as pending_payments
       FROM invoices i LEFT JOIN payments p ON i.id = p.invoice_id
       WHERE i.id = ? AND i.organization_id = ?
       GROUP BY i.id, i.amount, i.status, i.organization_id`,
      [id, request.userOrgId]
    );
    if (invRows.length === 0) return reply.status(404).send({ error: 'Invoice not found' });

    const inv = invRows[0];
    const totalAmount = parseFloat(inv.amount) || 0;
    const verified = parseFloat(inv.verified_payments) || 0;
    const pending = parseFloat(inv.pending_payments) || 0;
    const outstanding = totalAmount - verified - pending;

    if (data.amount > outstanding + 0.01) {
      return reply.status(400).send({
        error: `Payment amount ($${data.amount.toFixed(2)}) exceeds outstanding balance ($${outstanding.toFixed(2)}). You already have pending payments of $${pending.toFixed(2)} awaiting verification.`,
      });
    }
    if (inv.status === 'paid') return reply.status(400).send({ error: 'Invoice is already marked as paid.' });

    // Idempotency: prevent duplicate within 60s
    const [dups] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM payments WHERE invoice_id = ? AND amount = ? AND status = 'pending_verification' AND deleted_at IS NULL AND created_at > NOW() - INTERVAL 60 SECOND LIMIT 1`,
      [id, data.amount]
    );
    if (dups.length > 0) return reply.status(409).send({ error: 'A payment with this amount was already submitted within the last minute.' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Lock the invoice row to prevent concurrent overpayment
      const [lockedRows] = await conn.query<RowDataPacket[]>(
        `SELECT i.id, i.amount, i.status,
                COALESCE(SUM(CASE WHEN p.status IN ('verified', 'pending_verification') AND p.deleted_at IS NULL THEN p.amount ELSE 0 END), 0) as total_submitted
         FROM invoices i LEFT JOIN payments p ON i.id = p.invoice_id
         WHERE i.id = ? AND i.organization_id = ?
         GROUP BY i.id, i.amount, i.status
         FOR UPDATE`,
        [id, request.userOrgId]
      );
      if (lockedRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Invoice not found' }); }

      const locked = lockedRows[0];
      const lockedOutstanding = parseFloat(locked.amount) - parseFloat(locked.total_submitted);
      if (data.amount > lockedOutstanding + 0.01) {
        await conn.rollback();
        return reply.status(400).send({ error: `Payment amount ($${data.amount.toFixed(2)}) exceeds outstanding balance ($${lockedOutstanding.toFixed(2)}).` });
      }

      const [payResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO payments (invoice_id, amount, payment_date, payment_method, reference_number, notes, status, submitted_by_org_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', NOW())`,
        [id, data.amount, data.payment_date ?? new Date().toISOString().split('T')[0], data.payment_method, data.reference_number ?? null, data.notes ?? null]
      );

      const totalAfter = verified + pending + data.amount;
      const isFullPayment = totalAfter >= totalAmount - 0.01;
      const newStatus = isFullPayment ? 'payment_submitted' : 'partial_payment';

      await conn.query('UPDATE invoices SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, id]);
      await writeAudit(conn, { userId: request.userId, action: 'submit_payment', entityType: 'payment', entityId: payResult.insertId, details: { invoiceId: parseInt(id), amount: data.amount, paymentMethod: data.payment_method, reference: data.reference_number }, ipAddress: request.ip });
      await conn.commit();

      const remainingBalance = Math.max(0, totalAmount - totalAfter);
      const paymentType = isFullPayment ? 'full payment' : 'partial payment';

      return {
        success: true,
        message: `Payment submission recorded successfully. This is a ${paymentType}. It will be verified by accounting.`,
        data: {
          id: payResult.insertId,
          payment_type: paymentType,
          remaining_balance: remainingBalance,
          is_full_payment: isFullPayment,
          can_submit_additional_payments: !isFullPayment,
        },
      };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Organization: Billing summary =====
  app.get('/organization/billing-summary', { preHandler: orgRole }, async (request) => {
    const [summaryRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) as total_invoices,
         COUNT(CASE WHEN CASE WHEN COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount) THEN 'paid' WHEN CURRENT_DATE > i.due_date THEN 'overdue' ELSE 'pending' END = 'pending' THEN 1 END) as pending_invoices,
         COUNT(CASE WHEN CASE WHEN COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount) THEN 'paid' WHEN CURRENT_DATE > i.due_date THEN 'overdue' ELSE 'pending' END = 'overdue' THEN 1 END) as overdue_invoices,
         COUNT(CASE WHEN CASE WHEN COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount) THEN 'paid' WHEN CURRENT_DATE > i.due_date THEN 'overdue' ELSE 'pending' END = 'paid' THEN 1 END) as paid_invoices,
         COUNT(CASE WHEN i.status = 'payment_submitted' THEN 1 END) as payment_submitted,
         COALESCE(SUM(i.base_cost + i.tax_amount), 0) as total_amount,
         COALESCE(SUM(CASE WHEN CASE WHEN COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount) THEN 'paid' WHEN CURRENT_DATE > i.due_date THEN 'overdue' ELSE 'pending' END = 'pending' THEN (i.base_cost + i.tax_amount) ELSE 0 END), 0) as pending_amount,
         COALESCE(SUM(CASE WHEN CASE WHEN COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount) THEN 'paid' WHEN CURRENT_DATE > i.due_date THEN 'overdue' ELSE 'pending' END = 'overdue' THEN (i.base_cost + i.tax_amount) ELSE 0 END), 0) as overdue_amount,
         COALESCE(SUM(COALESCE(payments.total_paid, 0)), 0) as paid_amount
       FROM invoice_with_breakdown i
       LEFT JOIN ${VERIFIED_PAID_BY_INVOICE} payments ON payments.invoice_id = i.id
       WHERE i.organization_id = ? AND i.posted_to_org = TRUE`,
      [request.userOrgId]
    );

    const [recentRows] = await pool.query<RowDataPacket[]>(
      `SELECT i.id as invoice_id, i.invoice_number, i.created_at as invoice_date, i.due_date,
              i.base_cost + i.tax_amount as amount, i.status, ct.name as course_type_name, cr.location
       FROM invoice_with_breakdown i
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       WHERE i.organization_id = ? AND i.posted_to_org = TRUE
       ORDER BY i.created_at DESC LIMIT 5`,
      [request.userOrgId]
    );

    const summary = summaryRows[0] ?? {};
    return { success: true, data: { ...summary, recent_invoices: recentRows } };
  });

  // ===== Organization: Paid invoices list =====
  app.get('/organization/paid-invoices', { preHandler: orgRole }, async (request) => {
    const { page = '1', limit = '10', sort_by = 'paid_date', sort_order = 'desc' } = request.query as Record<string, string>;
    const safeLimit = Math.min(parseInt(limit), 200);
    const offset = (parseInt(page) - 1) * safeLimit;
    const safeSortBy = PAID_SORT_COLS.has(sort_by) ? sort_by : 'paid_date';
    const safeSortOrder = sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT i.id, i.id as invoice_id, i.invoice_number, i.created_at as invoice_date, i.due_date,
              i.amount, i.status, i.students_billed, i.paid_date,
              cr.location, ct.name as course_type_name, ${completedClassDate('cr')} as course_date, cr.id as course_request_id,
              COALESCE(payments.total_paid, 0) as amount_paid,
              GREATEST(0, (i.base_cost + i.tax_amount) - COALESCE(payments.total_paid, 0)) as balance_due,
              cp.price_per_student as rate_per_student, i.base_cost, i.tax_amount,
              'paid' as payment_status
       FROM invoice_with_breakdown i
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN course_pricing cp ON cr.organization_id = cp.organization_id AND cr.course_type_id = cp.course_type_id AND cp.is_active = true
       LEFT JOIN ${VERIFIED_PAID_BY_INVOICE} payments ON payments.invoice_id = i.id
       WHERE i.organization_id = ? AND i.posted_to_org = TRUE AND COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount)
       ORDER BY i.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`,
      [request.userOrgId, safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM invoice_with_breakdown i
       LEFT JOIN ${VERIFIED_PAID_BY_INVOICE} payments ON payments.invoice_id = i.id
       WHERE i.organization_id = ? AND i.posted_to_org = TRUE AND COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount)`,
      [request.userOrgId]
    );
    const total = Number(countRows[0]?.total ?? 0);

    return {
      success: true,
      data: {
        invoices: rows.map(r => ({ ...r, rate_per_student: r.rate_per_student ? parseFloat(r.rate_per_student) : null })),
        pagination: { current_page: parseInt(page), total_pages: Math.ceil(total / safeLimit), total_records: total, per_page: safeLimit },
      },
    };
  });

  // ===== Organization: Paid invoices summary =====
  app.get('/organization/paid-invoices-summary', { preHandler: orgRole }, async (request) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total_paid_invoices,
              COALESCE(SUM(i.amount), 0) as total_paid_amount,
              COALESCE(AVG(i.amount), 0) as average_paid_amount,
              COUNT(CASE WHEN i.paid_date >= CURRENT_DATE - INTERVAL 30 DAY THEN 1 END) as paid_last_30_days,
              COALESCE(SUM(CASE WHEN i.paid_date >= CURRENT_DATE - INTERVAL 30 DAY THEN i.amount ELSE 0 END), 0) as amount_paid_last_30_days
       FROM invoice_with_breakdown i
       LEFT JOIN ${VERIFIED_PAID_BY_INVOICE} payments ON payments.invoice_id = i.id
       WHERE i.organization_id = ? AND i.posted_to_org = TRUE AND COALESCE(payments.total_paid, 0) >= (i.base_cost + i.tax_amount)`,
      [request.userOrgId]
    );
    return { success: true, data: rows[0] ?? {} };
  });

  // ===== Accounting: Pending payment verifications =====
  app.get('/accounting/payment-verifications', { preHandler: acctRole }, async (request) => {
    const fromClause = `FROM payments p JOIN invoices i ON p.invoice_id = i.id JOIN organizations o ON i.organization_id = o.id
       WHERE ${pendingPayment('p')}`;
    const result = await maybePaginate(
      `SELECT p.id as paymentId, p.amount, p.payment_date as paymentDate,
              p.payment_method as paymentMethod, p.reference_number as referenceNumber,
              p.notes, p.status, p.submitted_by_org_at as submittedByOrgAt,
              p.verified_by_accounting_at as verifiedByAccountingAt,
              i.id as invoiceId, i.invoice_number as invoiceNumber, i.course_request_id as courseRequestId,
              o.name as organizationName, o.contact_email as contactEmail,
              -- The detail dialog's course block: the invoice's own stored figures.
              i.course_type_name as courseTypeName, i.location,
              i.students_billed as studentsAttended, i.rate_per_student as ratePerStudent,
              i.base_cost as baseCost, i.tax_amount as taxAmount, i.amount as invoiceAmount
       ${fromClause} ORDER BY p.submitted_by_org_at DESC`,
      `SELECT COUNT(*) as count ${fromClause}`,
      [],
      request.query as Record<string, string>,
    );
    // Keep the historical `data.payments` envelope; pagination meta rides alongside.
    const meta = metaOf(result);
    return { success: true, data: { payments: rowsOf(result) }, ...(meta ? { pagination: meta } : {}) };
  });

  // ===== Accounting: Verified/reversed payments =====
  app.get('/accounting/verified-payments', { preHandler: acctRole }, async (request) => {
    const { status = 'verified' } = request.query as Record<string, string>;
    let statusFilter = "p.status = 'verified'";
    if (status === 'reversed') statusFilter = "p.status = 'reversed'";
    else if (status !== 'verified') statusFilter = "p.status IN ('verified', 'reversed')";

    const fromClause = `FROM payments p JOIN invoices i ON p.invoice_id = i.id JOIN organizations o ON i.organization_id = o.id
       WHERE ${statusFilter} AND p.deleted_at IS NULL`;
    const result = await maybePaginate(
      `SELECT p.id as payment_id, p.amount, p.payment_date, p.payment_method, p.reference_number,
              p.notes, p.status, p.verified_by_accounting_at, p.reversed_at, p.reversed_by,
              i.id as invoice_id, i.invoice_number, o.name as organization_name, o.contact_email
       ${fromClause} ORDER BY p.verified_by_accounting_at DESC`,
      `SELECT COUNT(*) as count ${fromClause}`,
      [],
      request.query as Record<string, string>,
    );
    const meta = metaOf(result);
    return { success: true, data: { payments: rowsOf(result) }, ...(meta ? { pagination: meta } : {}) };
  });

  // ===== Accounting: Verify payment (approve/reject) =====
  app.post('/accounting/payments/:id/verify', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action, notes } = z.object({ action: z.enum(['approve', 'reject']), notes: z.string().optional() }).parse(request.body);

    if (action === 'reject' && !notes?.trim()) return reply.status(400).send({ error: 'Notes are required when rejecting a payment' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [payRows] = await conn.query<RowDataPacket[]>(
        `SELECT p.*, i.organization_id, i.amount as invoice_amount FROM payments p JOIN invoices i ON p.invoice_id = i.id
         WHERE p.id = ? AND ${pendingPayment('p')}`,
        [id]
      );
      if (payRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Payment not found or already processed' }); }

      const payment = payRows[0];

      if (action === 'approve') {
        await conn.query(
          `UPDATE payments SET status = 'verified', verified_by_accounting_at = NOW(),
           notes = CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NOT NULL AND notes != '' THEN '\n\n' ELSE '' END, ?)
           WHERE id = ?`,
          [`Verified by user ${request.userId}: ${notes || 'Payment approved'}`, id]
        );

        const [totalRows] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ? AND ${VERIFIED_PAYMENT_FILTER}`,
          [payment.invoice_id]
        );
        const totalPaid = parseFloat(totalRows[0].total_paid);
        const invoiceAmount = parseFloat(payment.invoice_amount);

        if (totalPaid >= invoiceAmount) {
          await conn.query("UPDATE invoices SET status = 'paid', paid_date = NOW(), updated_at = NOW() WHERE id = ?", [payment.invoice_id]);
        } else {
          await conn.query("UPDATE invoices SET status = 'pending', updated_at = NOW() WHERE id = ?", [payment.invoice_id]);
        }
      } else {
        await conn.query(
          `UPDATE payments SET status = 'rejected', verified_by_accounting_at = NOW(),
           notes = CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NOT NULL AND notes != '' THEN '\n\n' ELSE '' END, ?)
           WHERE id = ?`,
          [`Rejected by user ${request.userId}: ${notes}`, id]
        );
        await conn.query("UPDATE invoices SET status = 'pending', updated_at = NOW() WHERE id = ?", [payment.invoice_id]);
      }

      await writeAudit(conn, { userId: request.userId, action: action === 'approve' ? 'verify_payment' : 'reject_payment', entityType: 'payment', entityId: parseInt(id), details: { invoiceId: payment.invoice_id, amount: Number(payment.amount), notes }, ipAddress: request.ip });
      await conn.commit();
      logger.info({ paymentId: id, action, invoiceId: payment.invoice_id }, `Payment ${action}d`);

      return {
        success: true,
        message: `Payment ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
        data: { paymentId: id, action, invoiceId: payment.invoice_id },
      };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Accounting: Reverse payment =====
  app.post('/accounting/payments/:id/reverse', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(1, 'Reason for reversal is required') }).parse(request.body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [payRows] = await conn.query<RowDataPacket[]>(
        `SELECT p.*, i.organization_id, i.amount as invoice_amount, i.invoice_number FROM payments p JOIN invoices i ON p.invoice_id = i.id
         WHERE p.id = ? AND ${verifiedPayment('p')}`,
        [id]
      );
      if (payRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Payment not found or not verified' }); }

      const payment = payRows[0];

      // 48-hour reversal window
      const verifiedAt = new Date(payment.verified_by_accounting_at);
      const hoursSince = (Date.now() - verifiedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince > 48) {
        await conn.rollback();
        return reply.status(400).send({ error: 'Payment can only be reversed within 48 hours of verification' });
      }

      await conn.query(
        `UPDATE payments SET status = 'reversed',
         notes = CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NOT NULL AND notes != '' THEN '\n\n' ELSE '' END, ?),
         reversed_at = NOW(), reversed_by = ? WHERE id = ?`,
        [`Reversed by user ${request.userId}: ${reason}`, request.userId, id]
      );

      // Recalculate invoice status
      const [totalRows] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ? AND ${VERIFIED_PAYMENT_FILTER}`,
        [payment.invoice_id]
      );
      const totalPaid = parseFloat(totalRows[0].total_paid);
      const invoiceAmount = parseFloat(payment.invoice_amount);

      if (totalPaid >= invoiceAmount) {
        await conn.query("UPDATE invoices SET status = 'paid', updated_at = NOW() WHERE id = ?", [payment.invoice_id]);
      } else {
        await conn.query("UPDATE invoices SET status = 'pending', paid_date = NULL, updated_at = NOW() WHERE id = ?", [payment.invoice_id]);
      }

      await writeAudit(conn, { userId: request.userId, action: 'reverse_payment', entityType: 'payment', entityId: parseInt(id), details: { invoiceId: payment.invoice_id, amount: Number(payment.amount), reason }, ipAddress: request.ip });
      await conn.commit();
      logger.info({ paymentId: id, invoiceId: payment.invoice_id, reason }, 'Payment reversed');

      return {
        success: true,
        message: 'Payment reversed successfully',
        data: { paymentId: id, invoiceId: payment.invoice_id, invoiceNumber: payment.invoice_number, reversedAmount: payment.amount, reason },
      };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // Download invoice PDF
  app.get('/invoices/:id/pdf', { preHandler: orgRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await loadInvoiceForOrganization(parseInt(id), request.userOrgId);
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    return sendInvoicePdf(reply, invoice);
  });

  // Download payment receipt PDF
  app.get('/payments/:id/receipt', { preHandler: [requireRole('organization', 'accountant', 'admin', 'sysadmin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Organization users are scoped to their own org; staff may fetch any receipt.
    const isOrgUser = request.userRole === 'organization';
    const orgId = request.userOrgId;

    const [rows] = await pool.query<(RowDataPacket & PaymentPDFData)[]>(
      `SELECT p.id as payment_id, p.amount as payment_amount, p.payment_date, p.payment_method,
              p.reference_number, p.notes as payment_notes, p.status as payment_status, p.created_at as payment_created_at,
              i.id as invoice_id, i.invoice_number, i.amount as invoice_amount, i.invoice_date, i.due_date,
              o.name as organization_name, o.contact_email,
              cr.location, cr.scheduled_date as course_date, ct.name as course_type_name
       FROM payments p
       JOIN invoices i ON p.invoice_id = i.id
       JOIN organizations o ON i.organization_id = o.id
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       WHERE p.id = ?${isOrgUser ? ' AND i.organization_id = ?' : ''}`,
      isOrgUser ? [parseInt(id), orgId] : [parseInt(id)]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Payment not found' });

    const { PDFService } = await import('../services/PDFService.js');
    const pdfBuffer = await PDFService.generatePaymentReceipt(rows[0]);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="Payment-Receipt-${rows[0].payment_id}.pdf"`);
    reply.header('Content-Length', pdfBuffer.length);
    return reply.send(pdfBuffer);
  });
}
