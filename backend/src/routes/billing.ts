import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BillingService, BillingError } from '../services/BillingService.js';
import { InvoiceRepository } from '../repositories/InvoiceRepository.js';
import { CoursePricingRepository } from '../repositories/CoursePricingRepository.js';
import { InvoiceNumberService } from '../services/InvoiceNumberService.js';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { parsePagination } from '../utils/pagination.js';
import { toCSV } from '../utils/csv.js';
import type { InvoicePDFRow, StudentAttendanceRow, RevenueMonthRow } from '../types/billing.js';
import type { InvoicePDFData } from '../services/PDFService.js';
import { httpError } from '../utils/httpError.js';
import { RowDataPacket } from 'mysql2/promise';

// --- Schemas ---

const createPricingSchema = z.object({
  organizationId: z.number().int().positive(),
  courseTypeId: z.number().int().positive(),
  pricePerStudent: z.number().positive(),
});

const updatePricingSchema = z.object({
  pricePerStudent: z.number().positive(),
});

const createInvoiceSchema = z.object({
  courseId: z.number().int().positive(),
});

const approvalSchema = z.object({
  approvalStatus: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.string().min(1),
  reference: z.string().optional(),
});

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof BillingError) return reply.status(err.statusCode).send({ error: err.message });
  throw err;
}

// --- Routes ---

export async function billingRoutes(app: FastifyInstance) {
  const service = new BillingService(new InvoiceRepository(), new CoursePricingRepository());
  const acctRole = [requireRole('accountant', 'admin', 'sysadmin')];

  // ===== Dashboard =====
  // Cross-org aggregation is intentional: accountants/admins need full financial visibility.
  // Org-scoped dashboards are served via /organization/dashboard (filtered by userOrgId).
  app.get('/dashboard', { preHandler: acctRole }, async () => {
    return { success: true, data: await service.getDashboard() };
  });

  // ===== Pricing =====
  app.get('/course-pricing', { preHandler: [requireAuth] }, async (request) => {
    const isAdmin = ['accountant', 'admin', 'sysadmin'].includes(request.userRole);
    const data = isAdmin
      ? await service.getAllPricing()
      : request.userOrgId ? await service.getOrgPricing(request.userOrgId) : [];
    return { success: true, data };
  });

  app.post('/course-pricing', { preHandler: acctRole }, async (request, reply) => {
    const { organizationId, courseTypeId, pricePerStudent } = createPricingSchema.parse(request.body);
    try {
      const pricing = await service.upsertPricing(organizationId, courseTypeId, pricePerStudent);
      return { success: true, message: 'Pricing saved', data: pricing };
    } catch (err) { return handleError(err, reply); }
  });

  app.put('/course-pricing/:id', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { pricePerStudent } = updatePricingSchema.parse(request.body);
    try {
      const pricing = await service.updatePricing(parseInt(id), pricePerStudent);
      return { success: true, data: pricing };
    } catch (err) { return handleError(err, reply); }
  });

  app.delete('/course-pricing/:id', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await service.deletePricing(parseInt(id));
      return { success: true, message: 'Pricing deleted' };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Billing queue =====
  app.get('/billing-queue', { preHandler: acctRole }, async () => {
    return { success: true, data: await service.getBillingQueue() };
  });

  // ===== Invoices =====
  app.post('/invoices', { preHandler: acctRole }, async (request, reply) => {
    const { courseId } = createInvoiceSchema.parse(request.body);
    try {
      const invoice = await service.createInvoice(courseId);
      return { success: true, message: 'Invoice created — pending approval', data: invoice };
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/invoices', { preHandler: acctRole }, async (request) => {
    const pg = parsePagination(request.query as Record<string, string>);
    const result = await service.getAllInvoices(pg);
    return { success: true, ...(Array.isArray(result) ? { data: result } : result) };
  });

  app.get('/invoices/pending-approval', { preHandler: acctRole }, async (request) => {
    const pg = parsePagination(request.query as Record<string, string>);
    const result = await service.getPendingApproval(pg);
    return { success: true, ...(Array.isArray(result) ? { data: result } : result) };
  });

  app.get('/invoices/rejected', { preHandler: acctRole }, async (request) => {
    const pg = parsePagination(request.query as Record<string, string>);
    const result = await service.getRejected(pg);
    return { success: true, ...(Array.isArray(result) ? { data: result } : result) };
  });

  // CSV Export: Invoices (must be before /invoices/:id to avoid param matching)
  app.get('/invoices/export/csv', { preHandler: acctRole }, async (_request, reply) => {
    const result = await service.getAllInvoices();
    const invoices = Array.isArray(result) ? result : result.data;
    const csv = toCSV(invoices as unknown as Record<string, unknown>[], [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'organization_name', label: 'Organization' },
      { key: 'course_type_name', label: 'Course' },
      { key: 'invoice_date', label: 'Invoice Date' },
      { key: 'due_date', label: 'Due Date' },
      { key: 'students_billed', label: 'Students' },
      { key: 'rate_per_student', label: 'Rate/Student' },
      { key: 'base_cost', label: 'Subtotal' },
      { key: 'tax_amount', label: 'Tax' },
      { key: 'amount', label: 'Total' },
      { key: 'amount_paid', label: 'Paid' },
      { key: 'balance_due', label: 'Balance' },
      { key: 'approval_status', label: 'Approval' },
      { key: 'payment_status', label: 'Payment Status' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="invoices-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  app.get('/invoices/:id', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { success: true, data: await service.getInvoiceById(parseInt(id)) };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Approval workflow =====
  app.put('/invoices/:id/approval', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { approvalStatus, notes } = approvalSchema.parse(request.body);
    try {
      const invoice = approvalStatus === 'approved'
        ? await service.approve(parseInt(id), request.userId)
        : await service.reject(parseInt(id), notes ?? '', request.userId);
      return { success: true, message: `Invoice ${approvalStatus}`, data: invoice };
    } catch (err) { return handleError(err, reply); }
  });

  app.put('/invoices/:id/resubmit', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const invoice = await service.resubmit(parseInt(id));
      return { success: true, message: 'Invoice resubmitted for approval', data: invoice };
    } catch (err) { return handleError(err, reply); }
  });

  app.put('/invoices/:id/fix-calculations', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await service.fixCalculations(parseInt(id));
      return { success: true, message: 'Calculations fixed', data: result };
    } catch (err) { return handleError(err, reply); }
  });

  app.put('/invoices/:id/post-to-org', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const invoice = await service.postToOrg(parseInt(id), request.userId);
      return { success: true, message: 'Invoice posted to organization', data: invoice };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Payments =====
  app.get('/invoices/:id/payments', { preHandler: acctRole }, async (request) => {
    const { id } = request.params as { id: string };
    return { success: true, data: await service.getPayments(parseInt(id)) };
  });

  app.post('/invoices/:id/payments', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { amount, paymentMethod, reference } = paymentSchema.parse(request.body);
    try {
      const payment = await service.recordPayment(parseInt(id), amount, paymentMethod, reference);
      return { success: true, message: 'Payment recorded', data: payment };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Organizations list (for pricing dropdowns) =====
  app.get('/organizations', { preHandler: acctRole }, async () => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, contact_email, contact_phone FROM organizations ORDER BY name LIMIT 500'
    );
    return { success: true, data: rows };
  });

  // ===== Course types (for pricing dropdowns) =====
  app.get('/course-types', { preHandler: [requireAuth] }, async () => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, description, duration_minutes FROM class_types ORDER BY name LIMIT 200'
    );
    return { success: true, data: rows };
  });

  // ===== Revenue report =====
  app.get('/reports/revenue', { preHandler: acctRole }, async (request, reply) => {
    const { year } = request.query as { year?: string };
    if (!year) return reply.status(400).send({ error: 'Year parameter is required' });

    const pool = getPool();
    const yearInt = parseInt(year);

    // Two queries with GROUP BY MONTH instead of 24 sequential queries
    const [[invoicedRows], [paidRows]] = await Promise.all([
      pool.query<(RowDataPacket & RevenueMonthRow)[]>(
        `SELECT MONTH(COALESCE(invoice_date, created_at)) as m,
                COALESCE(SUM(amount), 0) as total
         FROM invoices
         WHERE YEAR(COALESCE(invoice_date, created_at)) = ?
         GROUP BY m`,
        [yearInt]
      ),
      pool.query<(RowDataPacket & RevenueMonthRow)[]>(
        `SELECT MONTH(payment_date) as m,
                COALESCE(SUM(amount), 0) as total
         FROM payments
         WHERE status = 'verified' AND deleted_at IS NULL
           AND YEAR(payment_date) = ?
         GROUP BY m`,
        [yearInt]
      ),
    ]);

    const invoicedMap = new Map(invoicedRows.map((r) => [r.m, Number(r.total)]));
    const paidMap = new Map(paidRows.map((r) => [r.m, Number(r.total)]));

    const months = [];
    for (let m = 1; m <= 12; m++) {
      months.push({
        month: `${yearInt}-${String(m).padStart(2, '0')}`,
        total_invoiced: invoicedMap.get(m) ?? 0,
        total_paid_in_month: paidMap.get(m) ?? 0,
      });
    }
    return { success: true, data: months };
  });

  // ===== AR Aging report (simple) =====
  app.get('/reports/ar-aging', { preHandler: acctRole }, async (request) => {
    const { organization_id, as_of_date } = request.query as Record<string, string>;
    const invoiceRepo = new InvoiceRepository();
    const asOfDate = as_of_date || new Date().toISOString().split('T')[0];

    const rows = await invoiceRepo.getAgingReport({
      asOfDate,
      organizationId: organization_id ? parseInt(organization_id) : undefined,
    });

    // Map to legacy field names for backwards compatibility
    const mappedRows = rows.map((row) => ({
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      amount: row.amount,
      paid_amount: Number(row.paid_amount),
      balance: Number(row.balance_due),
      invoice_date: row.invoice_date,
      due_date: row.due_date,
      days_overdue: row.days_outstanding,
      status: row.status,
      aging_bucket: row.aging_bucket.replace(' Days', ''),
    }));

    // Calculate summary
    const summary: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };
    mappedRows.forEach((row) => {
      const balance = Number(row.balance) || 0;
      const key = row.aging_bucket === 'Current' ? 'current' : row.aging_bucket;
      if (summary[key] !== undefined) summary[key] += balance;
      summary.total += balance;
    });

    return { success: true, data: { asOfDate, invoices: mappedRows, summary } };
  });

  // ===== Comprehensive aging report (for AgingReportView) =====
  app.get('/aging-report', { preHandler: acctRole }, async (request) => {
    const { organization_id, as_of_date } = request.query as Record<string, string>;
    const pool = getPool();
    const invoiceRepo = new InvoiceRepository();
    const asOfDate = as_of_date || new Date().toISOString().split('T')[0];

    const invoices = await invoiceRepo.getAgingReport({
      asOfDate,
      organizationId: organization_id ? parseInt(organization_id) : undefined,
      postedOnly: true,
      threshold: 0.01,
    });

    // Build summaries
    let totalOutstanding = 0, totalOverdue = 0;
    const buckets: Record<string, { count: number; total: number; daysSum: number }> = {
      'Current': { count: 0, total: 0, daysSum: 0 },
      '1-30 Days': { count: 0, total: 0, daysSum: 0 },
      '31-60 Days': { count: 0, total: 0, daysSum: 0 },
      '61-90 Days': { count: 0, total: 0, daysSum: 0 },
      '90+ Days': { count: 0, total: 0, daysSum: 0 },
    };
    interface OrgBucket {
      organization_id: number;
      organization_name: string;
      total_balance: number;
      current_balance: number;
      days_1_30: number;
      days_31_60: number;
      days_61_90: number;
      days_90_plus: number;
    }
    const orgBreakdown: Record<number, OrgBucket> = {};

    invoices.forEach((inv) => {
      const balance = Number(inv.balance_due) || 0;
      const days = Number(inv.days_outstanding) || 0;
      const bucket = inv.aging_bucket;

      totalOutstanding += balance;
      if (bucket !== 'Current') totalOverdue += balance;

      if (buckets[bucket]) {
        buckets[bucket].count++;
        buckets[bucket].total += balance;
        buckets[bucket].daysSum += days;
      }

      if (!orgBreakdown[inv.organization_id]) {
        orgBreakdown[inv.organization_id] = {
          organization_id: inv.organization_id, organization_name: inv.organization_name,
          total_balance: 0, current_balance: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0,
        };
      }
      const org = orgBreakdown[inv.organization_id];
      org.total_balance += balance;
      if (bucket === 'Current') org.current_balance += balance;
      else if (bucket === '1-30 Days') org.days_1_30 += balance;
      else if (bucket === '31-60 Days') org.days_31_60 += balance;
      else if (bucket === '61-90 Days') org.days_61_90 += balance;
      else if (bucket === '90+ Days') org.days_90_plus += balance;
    });

    // Collection efficiency
    const [effRows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(i.amount), 0) as total_invoiced,
              COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i2 ON p.invoice_id = i2.id
                        WHERE p.status = 'verified' AND p.deleted_at IS NULL
                          AND i2.invoice_date >= DATE_SUB(?, INTERVAL 90 DAY)), 0) as total_collected
       FROM invoices i WHERE i.invoice_date >= DATE_SUB(?, INTERVAL 90 DAY) AND i.posted_to_org = TRUE`,
      [asOfDate, asOfDate]
    );
    const totalInvoiced = Number(effRows[0]?.total_invoiced) || 0;
    const totalCollected = Number(effRows[0]?.total_collected) || 0;
    const collectionEfficiency = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 100;

    const agingSummary = Object.entries(buckets).map(([bucket, data]) => ({
      aging_bucket: bucket, invoice_count: data.count,
      total_balance: Math.round(data.total * 100) / 100,
      percentage_of_total: totalOutstanding > 0 ? Math.round((data.total / totalOutstanding) * 1000) / 10 : 0,
      avg_days_outstanding: data.count > 0 ? Math.round(data.daysSum / data.count) : 0,
    }));

    const r = (n: number) => Math.round(n * 100) / 100;
    const organizationBreakdown = Object.values(orgBreakdown).map((org) => ({
      ...org, total_balance: r(org.total_balance), current_balance: r(org.current_balance),
      days_1_30: r(org.days_1_30), days_31_60: r(org.days_31_60),
      days_61_90: r(org.days_61_90), days_90_plus: r(org.days_90_plus),
      risk_score: org.total_balance > 0 ? Math.min(100, Math.round(
        ((org.days_1_30 * 1) + (org.days_31_60 * 2) + (org.days_61_90 * 3) + (org.days_90_plus * 4))
        / org.total_balance * 25
      )) : 0,
    })).sort((a, b) => b.total_balance - a.total_balance);

    const overdueInvoices = invoices.filter((i) => i.aging_bucket !== 'Current').length;

    return {
      success: true,
      data: {
        report_metadata: { generated_at: new Date().toISOString(), as_of_date: asOfDate },
        executive_summary: {
          total_outstanding: r(totalOutstanding), total_overdue: r(totalOverdue),
          collection_efficiency: collectionEfficiency, total_invoices: invoices.length,
          overdue_invoices: overdueInvoices,
          overdue_percentage: invoices.length > 0 ? Math.round((overdueInvoices / invoices.length) * 100) : 0,
        },
        aging_summary: agingSummary,
        organization_breakdown: organizationBreakdown,
        invoice_details: invoices.map((inv) => ({
          id: inv.id, invoice_number: inv.invoice_number, organization_name: inv.organization_name,
          amount: r(Number(inv.amount) || 0), balance_due: r(Number(inv.balance_due) || 0),
          due_date: inv.due_date, days_outstanding: inv.days_outstanding, aging_bucket: inv.aging_bucket,
        })),
      },
    };
  });

  // Accounting: Download invoice PDF
  app.get('/invoices/:id/pdf', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();

    const [rows] = await pool.query<(RowDataPacket & InvoicePDFRow)[]>(
      `SELECT i.*, o.name as organization_name, o.contact_email,
              cr.location, cr.scheduled_date as date_completed, cr.registered_students as students_billed,
              ct.name as course_type_name,
              COALESCE(i.rate_per_student, op.price_per_student) as rate_per_student
       FROM invoices i
       JOIN organizations o ON i.organization_id = o.id
       JOIN course_requests cr ON i.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organization_pricing op ON op.organization_id = i.organization_id AND op.class_type_id = cr.course_type_id AND op.is_active = true
       WHERE i.id = ?`,
      [parseInt(id)]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Invoice not found' });

    const invoice = rows[0] as InvoicePDFRow & Record<string, unknown>;
    const [students] = await pool.query<(RowDataPacket & StudentAttendanceRow)[]>(
      `SELECT first_name, last_name, email, attended FROM course_students WHERE course_request_id = ? ORDER BY last_name, first_name`,
      [invoice.course_request_id]
    );
    invoice.attendance_list = students;
    invoice.invoice_id = invoice.id;

    const { PDFService } = await import('../services/PDFService.js');
    const pdfBuffer = await PDFService.generateInvoicePDF(invoice as unknown as InvoicePDFData);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="Invoice-${invoice.invoice_number}.pdf"`);
    reply.header('Content-Length', pdfBuffer.length);
    return reply.send(pdfBuffer);
  });

  // Accounting: Invoice preview HTML
  app.get('/invoices/:id/preview', { preHandler: acctRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pool = getPool();

    const [rows] = await pool.query<(RowDataPacket & InvoicePDFRow)[]>(
      `SELECT i.*, o.name as organization_name, o.contact_email,
              cr.location, cr.scheduled_date as date_completed, cr.registered_students as students_billed,
              ct.name as course_type_name,
              COALESCE(i.rate_per_student, op.price_per_student) as rate_per_student
       FROM invoices i
       JOIN organizations o ON i.organization_id = o.id
       JOIN course_requests cr ON i.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organization_pricing op ON op.organization_id = i.organization_id AND op.class_type_id = cr.course_type_id AND op.is_active = true
       WHERE i.id = ?`,
      [parseInt(id)]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Invoice not found' });

    const invoice = rows[0] as InvoicePDFRow & Record<string, unknown>;
    const [students] = await pool.query<(RowDataPacket & StudentAttendanceRow)[]>(
      `SELECT first_name, last_name, email, attended FROM course_students WHERE course_request_id = ? ORDER BY last_name, first_name`,
      [invoice.course_request_id]
    );
    invoice.attendance_list = students;
    invoice.invoice_id = invoice.id;

    const { PDFService } = await import('../services/PDFService.js');
    const html = PDFService.getInvoicePreviewHTML(invoice as unknown as InvoicePDFData);
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  });

  // ===== Invoice Number Sequences =====
  const invoiceNumberService = new InvoiceNumberService();

  const sequenceSchema = z.object({
    organizationId: z.number().int().positive(),
    prefix: z.string().min(1).max(20).optional(),
    formatString: z.string().min(1).max(100).optional(),
    padding: z.number().int().min(1).max(10).optional(),
    nextNumber: z.number().int().min(1).optional(),
    step: z.number().int().min(1).max(100).optional(),
    resetPolicy: z.enum(['none', 'yearly', 'monthly']).optional(),
  });

  // List all configured sequences
  app.get('/invoice-sequences', { preHandler: acctRole }, async () => {
    return { success: true, data: await invoiceNumberService.getAllSequences() };
  });

  // Get sequence for a specific org
  app.get('/invoice-sequences/:orgId', { preHandler: acctRole }, async (request, _reply) => {
    const { orgId } = request.params as { orgId: string };
    const seq = await invoiceNumberService.getSequence(parseInt(orgId));
    return { success: true, data: seq };
  });

  // Preview next invoice number for an org
  app.get('/invoice-sequences/:orgId/preview', { preHandler: acctRole }, async (request) => {
    const { orgId } = request.params as { orgId: string };
    const preview = await invoiceNumberService.preview(parseInt(orgId));
    return { success: true, data: { nextInvoiceNumber: preview } };
  });

  // Create or update a sequence
  app.put('/invoice-sequences', { preHandler: acctRole }, async (request, reply) => {
    const data = sequenceSchema.parse(request.body);
    try {
      const seq = await invoiceNumberService.upsert(data.organizationId, {
        prefix: data.prefix,
        format_string: data.formatString,
        padding: data.padding,
        next_number: data.nextNumber,
        step: data.step,
        reset_policy: data.resetPolicy,
      });
      return { success: true, data: seq };
    } catch (err) {
      return reply.status(400).send({ error: httpError(err).message });
    }
  });

  // Delete a sequence (org reverts to system default)
  app.delete('/invoice-sequences/:orgId', { preHandler: acctRole }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const deleted = await invoiceNumberService.deleteSequence(parseInt(orgId));
    if (!deleted) return reply.status(404).send({ error: 'No sequence found for this organization' });
    return { success: true, message: 'Sequence deleted — organization will use system default' };
  });
}
