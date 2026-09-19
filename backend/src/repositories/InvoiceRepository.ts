import { BaseRepository } from './BaseRepository.js';
import { getPool } from '../config/database.js';
import { RowDataPacket } from 'mysql2/promise';
import { getHSTRate } from '../utils/taxConfig.js';
import { PaginationParams, PaginatedResult, paginatedQuery } from '../utils/pagination.js';
import type { PaymentRow, AgingInvoiceRow, BillingQueueRow } from '../types/billing.js';

/** Canonical WHERE clause for counting verified, non-deleted payments. */
export const VERIFIED_PAYMENT_FILTER = "status = 'verified' AND deleted_at IS NULL";

export interface Invoice {
  id: number;
  invoice_number: string;
  organization_id: number;
  course_request_id: number;
  invoice_date: Date;
  due_date: Date;
  amount: number;
  base_cost: number;
  tax_amount: number;
  students_billed: number;
  rate_per_student: number;
  status: string;
  approval_status: string;
  posted_to_org: boolean;
  posted_to_org_at: Date | null;
  email_sent_at: Date | null;
  rejection_reason: string | null;
  rejected_at: Date | null;
  rejected_by: number | null;
  approved_by: number | null;
  approved_at: Date | null;
  course_type_name: string | null;
  location: string | null;
  date_completed: Date | null;
  notes: string | null;
  paid_date: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface InvoiceWithDetails extends Invoice {
  organization_name: string;
  contact_email: string | null;
  amount_paid: number;
  balance_due: number;
  payment_status: string;
  aging_bucket: string;
}

export interface DashboardData {
  totalBilled: number;
  totalPaid: number;
  outstandingInvoices: { count: number; amount: number };
  paymentsThisMonth: { count: number; amount: number };
  completedCoursesThisMonth: number;
}

export class InvoiceRepository extends BaseRepository<Invoice> {
  constructor() {
    super('invoices');
  }

  async getDashboard(): Promise<DashboardData> {
    const pool = getPool();

    const [[billed], [paid], [outstanding], [monthly], [courses]] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(base_cost + tax_amount), 0) as total
         FROM invoice_with_breakdown WHERE posted_to_org = TRUE`
      ),
      pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM payments WHERE status = 'verified' AND deleted_at IS NULL`
      ),
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count,
                COALESCE(SUM(i.base_cost + i.tax_amount - COALESCE(p.total_paid, 0)), 0) as total
         FROM invoice_with_breakdown i
         LEFT JOIN (SELECT invoice_id, SUM(amount) as total_paid FROM payments
                    WHERE status = 'verified' AND deleted_at IS NULL GROUP BY invoice_id) p
           ON p.invoice_id = i.id
         WHERE i.posted_to_org = TRUE
         AND (i.base_cost + i.tax_amount - COALESCE(p.total_paid, 0)) > 0`
      ),
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
         FROM payments WHERE status = 'verified' AND deleted_at IS NULL
         AND MONTH(payment_date) = MONTH(CURRENT_DATE)
         AND YEAR(payment_date) = YEAR(CURRENT_DATE)`
      ),
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM course_requests
         WHERE status = 'completed' AND deleted_at IS NULL
         AND MONTH(completed_at) = MONTH(CURRENT_DATE)
         AND YEAR(completed_at) = YEAR(CURRENT_DATE)`
      ),
    ]);

    return {
      totalBilled: Number(billed[0]?.total ?? 0),
      totalPaid: Number(paid[0]?.total ?? 0),
      outstandingInvoices: { count: Number(outstanding[0]?.count ?? 0), amount: Number(outstanding[0]?.total ?? 0) },
      paymentsThisMonth: { count: Number(monthly[0]?.count ?? 0), amount: Number(monthly[0]?.total ?? 0) },
      completedCoursesThisMonth: Number(courses[0]?.count ?? 0),
    };
  }

  async getBillingQueue(): Promise<BillingQueueRow[]> {
    return this.query<BillingQueueRow>(
      `SELECT
         cr.id as course_id, cr.organization_id,
         o.name as organization_name, o.contact_email,
         ct.name as course_type_name, cr.location,
         DATE(cr.completed_at) as date_completed, cr.registered_students,
         (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id AND cs.attended = true) as students_attended,
         cp.price_per_student as rate_per_student,
         ((SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id AND cs.attended = true)
           * cp.price_per_student * ?) as total_amount,
         COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username) as instructor_name,
         u.email as instructor_email,
         cr.ready_for_billing_at
       FROM course_requests cr
       JOIN organizations o ON cr.organization_id = o.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       JOIN course_pricing cp ON cr.organization_id = cp.organization_id
         AND cr.course_type_id = cp.course_type_id AND cp.is_active = true
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cr.ready_for_billing = true AND cr.ready_for_billing_at IS NOT NULL
         AND (cr.invoiced IS NULL OR cr.invoiced = FALSE)
       ORDER BY cr.ready_for_billing_at DESC
       LIMIT 200`,
      [1 + getHSTRate()]
    );
  }

  async findAllWithDetails(pg?: PaginationParams): Promise<InvoiceWithDetails[] | PaginatedResult<InvoiceWithDetails>> {
    const dataSQL = `SELECT
         i.id, i.invoice_number, i.organization_id, i.course_request_id,
         COALESCE(i.invoice_date, i.created_at) as invoice_date,
         i.due_date, i.amount, i.base_cost, i.tax_amount,
         i.students_billed, i.rate_per_student,
         i.status, i.approval_status, i.posted_to_org, i.posted_to_org_at,
         i.paid_date, i.created_at,
         o.name as organization_name, o.contact_email,
         cr.location, ct.name as course_type_name, cr.completed_at as date_completed,
         COALESCE(p.total_paid, 0) as amount_paid,
         GREATEST(0, i.amount - COALESCE(p.total_paid, 0)) as balance_due,
         CASE
           WHEN COALESCE(p.total_paid, 0) >= i.amount THEN 'paid'
           WHEN CURRENT_DATE > i.due_date THEN 'overdue'
           ELSE 'pending'
         END as payment_status,
         CASE
           WHEN CURRENT_DATE <= i.due_date THEN 'current'
           WHEN CURRENT_DATE <= i.due_date + INTERVAL 30 DAY THEN '1-30 days'
           WHEN CURRENT_DATE <= i.due_date + INTERVAL 60 DAY THEN '31-60 days'
           WHEN CURRENT_DATE <= i.due_date + INTERVAL 90 DAY THEN '61-90 days'
           ELSE '90+ days'
         END as aging_bucket
       FROM invoice_with_breakdown i
       JOIN organizations o ON i.organization_id = o.id
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN (SELECT invoice_id, SUM(amount) as total_paid FROM payments
                  WHERE ${VERIFIED_PAYMENT_FILTER} GROUP BY invoice_id) p ON p.invoice_id = i.id
       ORDER BY i.created_at DESC`;

    if (pg) {
      return paginatedQuery<InvoiceWithDetails>(
        dataSQL,
        `SELECT COUNT(*) as count FROM invoice_with_breakdown i
         JOIN organizations o ON i.organization_id = o.id`,
        [],
        pg,
      );
    }
    return this.query<InvoiceWithDetails>(`${dataSQL} LIMIT 500`);
  }

  async findByIdWithDetails(id: number): Promise<InvoiceWithDetails | null> {
    const rows = await this.query<InvoiceWithDetails>(
      `SELECT
         i.*, o.name as organization_name, o.contact_email, o.address, o.contact_phone,
         cr.location, cr.scheduled_date as course_date, cr.completed_at as date_completed,
         cr.course_type_id, ct.name as course_type_name,
         COALESCE(cp.price_per_student, i.rate_per_student) as rate_per_student,
         COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username) as instructor_name,
         COALESCE(p.total_paid, 0) as amount_paid,
         GREATEST(0, i.amount - COALESCE(p.total_paid, 0)) as balance_due
       FROM invoices i
       JOIN organizations o ON i.organization_id = o.id
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN course_pricing cp ON cr.organization_id = cp.organization_id
         AND cr.course_type_id = cp.course_type_id AND cp.is_active = true
       LEFT JOIN (SELECT invoice_id, SUM(amount) as total_paid FROM payments
                  WHERE ${VERIFIED_PAYMENT_FILTER} GROUP BY invoice_id) p ON p.invoice_id = i.id
       WHERE i.id = ?`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findPendingApproval(pg?: PaginationParams): Promise<InvoiceWithDetails[] | PaginatedResult<InvoiceWithDetails>> {
    // PendingApprovalsView reads course_type_name (snake_case, correctly)
    // but nothing here ever joined to get it — the column was always
    // blank regardless of casing. Added the same course_requests/class_types
    // join findRejected() already has.
    const dataSQL = `SELECT i.*, o.name as organization_name,
              ct.name as course_type_name,
              COALESCE(p.total_paid, 0) as amount_paid,
              GREATEST(0, i.amount - COALESCE(p.total_paid, 0)) as balance_due
       FROM invoices i
       LEFT JOIN organizations o ON i.organization_id = o.id
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN (SELECT invoice_id, SUM(amount) as total_paid FROM payments
                  WHERE ${VERIFIED_PAYMENT_FILTER} GROUP BY invoice_id) p ON p.invoice_id = i.id
       WHERE i.approval_status = 'pending'
       ORDER BY i.created_at ASC`;

    if (pg) {
      return paginatedQuery<InvoiceWithDetails>(
        dataSQL,
        `SELECT COUNT(*) as count FROM invoices WHERE approval_status = 'pending'`,
        [],
        pg,
      );
    }
    return this.query<InvoiceWithDetails>(`${dataSQL} LIMIT 200`);
  }

  async findRejected(pg?: PaginationParams): Promise<InvoiceWithDetails[] | PaginatedResult<InvoiceWithDetails>> {
    // RejectedInvoicesView reads these in camelCase; i.* alone left every
    // field but `id`/`amount`/`status` undefined on this screen.
    const dataSQL = `SELECT i.*, o.name as organization_name, o.name as organizationName,
              ct.name as course_type_name, ct.name as courseTypeName,
              u.username as rejected_by_name,
              i.invoice_number as invoiceNumber, i.base_cost as baseCost, i.tax_amount as taxAmount,
              i.rejected_at as rejectedAt, i.rejection_reason as rejectionReason
       FROM invoices i
       LEFT JOIN organizations o ON i.organization_id = o.id
       LEFT JOIN course_requests cr ON i.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN users u ON i.rejected_by = u.id
       WHERE i.approval_status = 'rejected'
       ORDER BY i.rejected_at DESC`;

    if (pg) {
      return paginatedQuery(
        dataSQL,
        `SELECT COUNT(*) as count FROM invoices WHERE approval_status = 'rejected'`,
        [],
        pg,
      );
    }
    return this.query(`${dataSQL} LIMIT 200`);
  }

  async getPayments(invoiceId: number): Promise<PaymentRow[]> {
    return this.query<PaymentRow>(
      `SELECT * FROM payments WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY payment_date DESC`,
      [invoiceId]
    );
  }

  /**
   * Shared aging report query used by both /reports/ar-aging and /aging-report.
   * Returns invoice rows with balance, days overdue, and aging bucket.
   */
  async getAgingReport(options: {
    asOfDate: string;
    organizationId?: number;
    postedOnly?: boolean;
    threshold?: number;
  }): Promise<AgingInvoiceRow[]> {
    const { asOfDate, organizationId, postedOnly = false, threshold = 0 } = options;
    const pool = getPool();

    let orgFilter = '';
    const params: unknown[] = [asOfDate, asOfDate, asOfDate, asOfDate, asOfDate, asOfDate];
    if (organizationId) { orgFilter = 'AND i.organization_id = ?'; params.push(organizationId); }

    const postedFilter = postedOnly ? 'AND i.posted_to_org = TRUE' : '';

    const [rows] = await pool.query<(RowDataPacket & AgingInvoiceRow)[]>(
      `SELECT i.id, i.invoice_number, i.organization_id,
              o.name as organization_name, i.amount,
              COALESCE(pp.total_paid, 0) as paid_amount,
              i.amount - COALESCE(pp.total_paid, 0) as balance_due,
              i.invoice_date, i.due_date,
              CASE WHEN i.due_date IS NULL THEN 0
                   ELSE GREATEST(0, DATEDIFF(?, i.due_date)) END as days_outstanding,
              i.status,
              CASE
                WHEN i.due_date IS NULL OR i.due_date >= ? THEN 'Current'
                WHEN DATEDIFF(?, i.due_date) BETWEEN 1 AND 30 THEN '1-30 Days'
                WHEN DATEDIFF(?, i.due_date) BETWEEN 31 AND 60 THEN '31-60 Days'
                WHEN DATEDIFF(?, i.due_date) BETWEEN 61 AND 90 THEN '61-90 Days'
                ELSE '90+ Days'
              END as aging_bucket
       FROM invoices i
       LEFT JOIN organizations o ON i.organization_id = o.id
       LEFT JOIN (SELECT invoice_id, SUM(amount) as total_paid FROM payments
                  WHERE ${VERIFIED_PAYMENT_FILTER} GROUP BY invoice_id) pp ON pp.invoice_id = i.id
       WHERE i.status NOT IN ('paid', 'void', 'cancelled')
         ${postedFilter}
         AND (i.amount - COALESCE(pp.total_paid, 0)) > ?
         ${orgFilter}
       ORDER BY days_outstanding DESC, o.name, i.invoice_date`,
      [...params.slice(0, 6), threshold, ...(organizationId ? [organizationId] : [])]
    );

    return rows;
  }
}
