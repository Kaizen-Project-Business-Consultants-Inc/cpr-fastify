import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { maybePaginate, paginatedResponse } from '../utils/pagination.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const approveSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
});

// The accounting UI's PaymentData (frontend/src/types/api.ts) sends
// camelCase — amount, paymentDate, paymentMethod, referenceNumber, notes.
// This schema previously required snake_case, which zod silently drops
// (they're all optional), so paying a vendor invoice from the UI has always
// thrown 500 "An unexpected error occurred" and no payment was ever
// recorded. Same bug class/fix as billing.ts's paymentSchema.
const paymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().optional(),
  paymentMethod: z.string().optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});


/**
 * vendor_invoices columns the UI reads in camelCase (invoice.invoiceNumber,
 * invoice.dueDate, ...). `vi.*` alone leaves every one of these undefined —
 * that's why every "View"/"Download" action on the admin and accounting
 * vendor-invoice screens rendered as "invoice undefined" regardless of which
 * row, same bug as the vendor's own invoice list (see routes/vendors.ts).
 * Every list/detail query below appends this alongside `vi.*`.
 */
const VI_CAMEL_COLS = `vi.invoice_number as invoiceNumber, vi.due_date as dueDate,
              vi.payment_date as paymentDate, vi.pdf_filename as pdfFilename,
              vi.created_at as createdAt, vi.updated_at as updatedAt,
              vi.admin_notes as adminNotes, vi.rejection_reason as rejectionReason,
              vi.sent_to_accounting_at as sentToAccountingAt, vi.paid_at as paidAt,
              vi.approved_by as approvedBy, vi.approved_at as approvedAt,
              vi.vendor_id as vendorId`;

/**
 * Optional `status` / `search` filter shared by the vendor-invoice list endpoints.
 * `status=paid` and `status=unpaid` are the two the UI needs (a "paid" screen and a
 * "awaiting payment" screen); any other value is matched literally against the column.
 * Returns a WHERE clause and its bind params so the data and COUNT queries stay in step.
 */
function invoiceFilter(query: Record<string, string>): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const status = (query.status ?? '').trim();
  const search = (query.search ?? '').trim();

  if (status === 'paid') conds.push("vi.status = 'paid'");
  else if (status === 'unpaid' || status === 'not_paid') conds.push("vi.status <> 'paid'");
  else if (status) { conds.push('vi.status = ?'); params.push(status); }

  if (search) {
    conds.push('(vi.invoice_number LIKE ? OR v.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

/** Every status a vendor invoice can hold, so the summary always returns all keys. */
const VENDOR_INVOICE_STATUSES = [
  'pending_submission',
  'submitted_to_admin',
  'submitted_to_accounting',
  'rejected_by_admin',
  'rejected_by_accountant',
  'paid',
] as const;

/**
 * Counts and money totals for the vendor-invoice screens, honouring the same
 * `status` / `search` filter as the list endpoints.
 *
 * This exists so a screen does not have to download every matching row just to add
 * it up, and does not have to issue one `limit=1` probe per status to count. All
 * figures describe the *filtered* set, so cards and table always agree.
 */
async function vendorInvoiceSummary(query: Record<string, string>) {
  const { where, params } = invoiceFilter(query);
  const paymentsJoin = `LEFT JOIN (
      SELECT vendor_invoice_id, SUM(amount) AS total_paid, COUNT(*) AS payment_count,
             MAX(payment_date) AS last_payment_at
      FROM vendor_payments WHERE status = 'processed' GROUP BY vendor_invoice_id
    ) p ON p.vendor_invoice_id = vi.id`;

  const statusCounts = VENDOR_INVOICE_STATUSES
    .map((s) => `SUM(vi.status = '${s}') AS count_${s}`)
    .join(',\n           ');

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            ${statusCounts},
            COALESCE(SUM(vi.total), 0) AS total_amount,
            COALESCE(SUM(p.total_paid), 0) AS total_paid,
            COALESCE(SUM(vi.total - COALESCE(p.total_paid, 0)), 0) AS outstanding,
            -- Partly settled: money received, but less than the invoice total. Derived from
            -- the payments themselves; vendor_invoices has no payment_status column (only
            -- ORGANISATION invoices compute one), so any UI reading vi.payment_status was
            -- always reading undefined.
            SUM(COALESCE(p.total_paid, 0) > 0 AND COALESCE(p.total_paid, 0) < vi.total) AS partially_paid,
            COALESCE(SUM(p.payment_count), 0) AS payments_processed,
            MAX(p.last_payment_at) AS most_recent_payment_at
     FROM vendor_invoices vi
     LEFT JOIN vendors v ON vi.vendor_id = v.id
     ${paymentsJoin}
     ${where}`,
    params
  );

  const r = rows[0] ?? {};
  const byStatus: Record<string, number> = {};
  for (const s of VENDOR_INVOICE_STATUSES) byStatus[s] = Number(r[`count_${s}`] ?? 0);

  return {
    total: Number(r.total ?? 0),
    byStatus,
    totalAmount: Number(r.total_amount ?? 0),
    totalPaid: Number(r.total_paid ?? 0),
    outstanding: Number(r.outstanding ?? 0),
    partiallyPaid: Number(r.partially_paid ?? 0),
    paymentsProcessed: Number(r.payments_processed ?? 0),
    mostRecentPaymentAt: r.most_recent_payment_at ?? null,
  };
}

export async function vendorAdminRoutes(app: FastifyInstance) {
  const pool = getPool();
  const adminRole = [requireRole('admin', 'sysadmin', 'courseadmin')];
  const acctRole = [requireRole('accountant', 'admin')];

  // ===== Admin: All vendor invoices =====
  app.get('/admin/vendor-invoices', { preHandler: adminRole }, async (request) => {
    const { where, params } = invoiceFilter(request.query as Record<string, string>);
    const fromClause = `FROM vendor_invoices vi
       LEFT JOIN vendors v ON vi.vendor_id = v.id
       LEFT JOIN users u_approved ON vi.approved_by = u_approved.id`;
    const result = await maybePaginate(
      `SELECT vi.*, ${VI_CAMEL_COLS},
              v.name as vendor_name, v.name as vendorName,
              v.contact_email as vendor_email, v.contact_email as vendorEmail,
              u_approved.username as approved_by_name, u_approved.username as approvedByName
       ${fromClause}
       ${where}
       ORDER BY vi.created_at DESC`,
      `SELECT COUNT(*) as count ${fromClause} ${where}`,
      params,
      request.query as Record<string, string>,
    );
    return paginatedResponse(result);
  });

  // Counts + money totals for the admin vendor-invoice screens (see vendorInvoiceSummary).
  app.get('/admin/vendor-invoices/summary', { preHandler: adminRole }, async (request) => ({
    success: true,
    data: await vendorInvoiceSummary(request.query as Record<string, string>),
  }));

  // ===== Admin: Ready for processing =====
  app.get('/admin/vendor-invoices/ready-for-processing', { preHandler: adminRole }, async (request) => {
    const result = await maybePaginate(
      `SELECT vi.*, ${VI_CAMEL_COLS},
              v.name as vendor_name, v.name as vendorName,
              v.contact_email as vendor_email, v.contact_email as vendorEmail
       FROM vendor_invoices vi LEFT JOIN vendors v ON vi.vendor_id = v.id
       WHERE vi.status = 'submitted_to_admin' ORDER BY vi.created_at ASC`,
      `SELECT COUNT(*) as count
       FROM vendor_invoices vi LEFT JOIN vendors v ON vi.vendor_id = v.id
       WHERE vi.status = 'submitted_to_admin'`,
      [],
      request.query as Record<string, string>,
    );
    return paginatedResponse(result);
  });

  // ===== Admin: Update notes =====
  app.put('/admin/vendor-invoices/:id/notes', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { notes } = z.object({ notes: z.string() }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE vendor_invoices SET admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [notes, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Vendor invoice not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM vendor_invoices WHERE id = ?', [id]);
    return { success: true, message: 'Notes updated successfully', data: rows[0] };
  });

  // ===== Admin: Approve/reject =====
  app.post('/admin/vendor-invoices/:id/approve', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action, notes } = approveSchema.parse(request.body);
    if (action === 'reject' && !notes?.trim()) return reply.status(400).send({ error: 'Notes are required when rejecting' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [invoiceRows] = await conn.query<RowDataPacket[]>(
        `SELECT vi.* FROM vendor_invoices vi WHERE vi.id = ? AND vi.status = 'submitted_to_admin'`, [id]
      );
      if (invoiceRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Invoice not found or not ready' }); }

      if (action === 'approve') {
        await conn.query(
          `UPDATE vendor_invoices SET status = 'submitted_to_accounting', approved_by = ?,
           admin_notes = ?, sent_to_accounting_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [request.userId, notes ?? '', id]
        );
      } else {
        await conn.query(
          `UPDATE vendor_invoices SET status = 'rejected_by_admin', admin_notes = ?, rejection_reason = ?,
           rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [notes, notes, id]
        );
      }
      await conn.commit();
      return { success: true, message: `Invoice ${action}d successfully.`, data: { invoiceId: id, status: action === 'approve' ? 'submitted_to_accounting' : 'rejected_by_admin' } };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Accounting: All vendor invoices =====
  app.get('/accounting/vendor-invoices', { preHandler: acctRole }, async (request) => {
    const fromClause = `FROM vendor_invoices vi
       LEFT JOIN vendors v ON vi.vendor_id = v.id
       LEFT JOIN users u_approved ON vi.approved_by = u_approved.id
       LEFT JOIN (SELECT vendor_invoice_id, SUM(amount) as total_paid FROM vendor_payments WHERE status = 'processed' GROUP BY vendor_invoice_id) payments
         ON payments.vendor_invoice_id = vi.id`;
    const { where, params } = invoiceFilter(request.query as Record<string, string>);
    const result = await maybePaginate(
      `SELECT vi.*, ${VI_CAMEL_COLS},
              v.name as vendor_name, v.name as vendorName,
              v.contact_email as vendor_email, v.contact_email as vendorEmail,
              u_approved.username as approved_by_name, u_approved.username as approvedByName,
              COALESCE(payments.total_paid, 0) as total_paid, COALESCE(payments.total_paid, 0) as totalPaid,
              (vi.total - COALESCE(payments.total_paid, 0)) as balance_due,
              (vi.total - COALESCE(payments.total_paid, 0)) as balanceDue
       ${fromClause}
       ${where}
       ORDER BY vi.created_at DESC`,
      `SELECT COUNT(*) as count ${fromClause} ${where}`,
      params,
      request.query as Record<string, string>,
    );
    return paginatedResponse(result);
  });

  // Counts + money totals for the accounting vendor-invoice screens.
  app.get('/accounting/vendor-invoices/summary', { preHandler: acctRole }, async (request) => ({
    success: true,
    data: await vendorInvoiceSummary(request.query as Record<string, string>),
  }));

  // ===== Accounting: Invoice detail =====
  app.get('/accounting/vendor-invoices/:id', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [invoiceRows] = await pool.query<RowDataPacket[]>(
      `SELECT vi.*, ${VI_CAMEL_COLS},
              v.name as vendor_name, v.name as vendorName,
              v.contact_email as vendor_email, v.contact_email as vendorEmail,
              v.address as vendor_address, v.address as vendorAddress,
              u_approved.username as approved_by_name, u_approved.username as approvedByName,
              COALESCE(payments.total_paid, 0) as total_paid, COALESCE(payments.total_paid, 0) as totalPaid,
              (vi.total - COALESCE(payments.total_paid, 0)) as balance_due,
              (vi.total - COALESCE(payments.total_paid, 0)) as balanceDue
       FROM vendor_invoices vi LEFT JOIN vendors v ON vi.vendor_id = v.id
       LEFT JOIN users u_approved ON vi.approved_by = u_approved.id
       LEFT JOIN (SELECT vendor_invoice_id, SUM(amount) as total_paid FROM vendor_payments WHERE status = 'processed' GROUP BY vendor_invoice_id) payments
         ON payments.vendor_invoice_id = vi.id
       WHERE vi.id = ?`,
      [id]
    );
    if (invoiceRows.length === 0) return reply.status(404).send({ error: 'Vendor invoice not found' });

    const [paymentRows] = await pool.query<RowDataPacket[]>(
      `SELECT vp.*, vp.payment_date as paymentDate, vp.payment_method as paymentMethod,
              vp.reference_number as referenceNumber, vp.processed_by as processedBy,
              vp.processed_at as processedAt,
              u_processed.username as processed_by_name, u_processed.username as processedByName
       FROM vendor_payments vp
       LEFT JOIN users u_processed ON vp.processed_by = u_processed.id
       WHERE vp.vendor_invoice_id = ? ORDER BY vp.payment_date DESC`,
      [id]
    );
    return { success: true, data: { invoice: invoiceRows[0], payments: paymentRows } };
  });

  // ===== Accounting: Process payment =====
  app.post('/accounting/vendor-invoices/:id/payments', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = paymentSchema.parse(request.body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [invoiceRows] = await conn.query<RowDataPacket[]>(
        `SELECT vi.*, COALESCE(payments.total_paid, 0) as total_paid,
                (vi.total - COALESCE(payments.total_paid, 0)) as balance_due
         FROM vendor_invoices vi
         LEFT JOIN (SELECT vendor_invoice_id, SUM(amount) as total_paid FROM vendor_payments WHERE status = 'processed' GROUP BY vendor_invoice_id) payments
           ON payments.vendor_invoice_id = vi.id
         WHERE vi.id = ? AND vi.status = 'submitted_to_accounting'`,
        [id]
      );
      if (invoiceRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Invoice not found or not ready for payment' }); }

      const balance = Number(invoiceRows[0].balance_due);
      if (data.amount > balance) { await conn.rollback(); return reply.status(400).send({ error: `Payment ($${data.amount.toFixed(2)}) exceeds balance ($${balance.toFixed(2)})` }); }

      const [payResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO vendor_payments (vendor_invoice_id, amount, payment_date, payment_method, reference_number, notes, status, processed_by, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'processed', ?, CURRENT_TIMESTAMP)`,
        [id, data.amount, data.paymentDate ?? new Date().toISOString().split('T')[0], data.paymentMethod ?? null,
         data.referenceNumber ?? null, data.notes ?? null, request.userId]
      );

      const invoiceTotal = Number(invoiceRows[0].total) || Number(invoiceRows[0].amount) || 0;
      const totalPaidAfter = Number(invoiceRows[0].total_paid) + data.amount;
      const newStatus = totalPaidAfter >= invoiceTotal ? 'paid' : 'submitted_to_accounting';

      await conn.query(
        `UPDATE vendor_invoices SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newStatus, newStatus, id]
      );
      await conn.commit();

      return { success: true, message: `Payment of $${data.amount.toFixed(2)} processed successfully.`, data: { paymentId: payResult.insertId, invoiceStatus: newStatus } };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Accounting: Reject =====
  app.post('/accounting/vendor-invoices/:id/reject', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { notes } = z.object({ notes: z.string().min(1) }).parse(request.body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [invoiceRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM vendor_invoices WHERE id = ? AND status = 'submitted_to_accounting'`, [id]
      );
      if (invoiceRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Invoice not found or not ready' }); }

      await conn.query(
        `UPDATE vendor_invoices SET status = 'rejected_by_accountant', admin_notes = ?, rejection_reason = ?,
         rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [notes, notes, id]
      );
      await conn.commit();
      return { success: true, message: 'Invoice rejected successfully.', data: { invoiceId: id, status: 'rejected_by_accountant' } };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Accounting: Payment history =====
  app.get('/accounting/vendor-payments', { preHandler: acctRole }, async (request) => {
    const fromClause = `FROM vendor_payments vp
       JOIN vendor_invoices vi ON vp.vendor_invoice_id = vi.id
       JOIN vendors v ON vi.vendor_id = v.id
       LEFT JOIN users u_processed ON vp.processed_by = u_processed.id`;
    const result = await maybePaginate(
      `SELECT vp.*, vp.payment_date as paymentDate, vp.payment_method as paymentMethod,
              vp.reference_number as referenceNumber, vp.processed_at as processedAt,
              vi.invoice_number, vi.invoice_number as invoiceNumber,
              vi.amount as invoice_amount, vi.amount as invoiceAmount,
              v.name as vendor_name, v.name as vendorName,
              u_processed.username as processed_by_name, u_processed.username as processedByName
       ${fromClause}
       ORDER BY vp.payment_date DESC`,
      `SELECT COUNT(*) as count ${fromClause}`,
      [],
      request.query as Record<string, string>,
    );
    return paginatedResponse(result);
  });
}
