/**
 * Row shapes for invoice and payment query results.
 * Used to replace `any` in billing/admin routes and repositories.
 */

/** Shape returned by the main invoice list queries (findAllWithDetails, etc.). */
export interface InvoiceRow {
  id: number;
  invoice_number: string;
  organization_id: number;
  course_request_id: number;
  invoice_date: string | Date;
  due_date: string | Date;
  amount: number;
  base_cost: number;
  tax_amount: number;
  students_billed: number;
  rate_per_student: number;
  status: string;
  approval_status: string;
  posted_to_org: boolean;
  posted_to_org_at: string | Date | null;
  paid_date: string | Date | null;
  created_at: string | Date;
  organization_name: string;
  contact_email: string | null;
  location: string | null;
  course_type_name: string | null;
  date_completed: string | Date | null;
  amount_paid: number;
  balance_due: number;
  payment_status: string;
  aging_bucket: string;
}

/** Shape returned by the detailed single-invoice query (findByIdWithDetails). */
export interface InvoiceDetailRow extends InvoiceRow {
  address: string | null;
  contact_phone: string | null;
  course_date: string | Date | null;
  course_type_id: number;
  instructor_name: string | null;
  rejection_reason: string | null;
  rejected_at: string | Date | null;
  rejected_by: number | null;
  approved_by: number | null;
  approved_at: string | Date | null;
  email_sent_at: string | Date | null;
  notes: string | null;
  deleted_at: string | Date | null;
}

/** Shape returned by the PDF/preview invoice query. */
export interface InvoicePDFRow {
  id: number;
  invoice_number: string;
  organization_id: number;
  course_request_id: number;
  invoice_date: string | Date;
  due_date: string | Date;
  amount: number;
  base_cost: number;
  tax_amount: number;
  students_billed: number;
  rate_per_student: number;
  status: string;
  organization_name: string;
  contact_email: string | null;
  location: string | null;
  date_completed: string | Date | null;
  course_type_name: string;
  attendance_list?: StudentAttendanceRow[];
  invoice_id?: number;
}

/** Shape returned by the "ready for billing" queue query. */
export interface BillingQueueRow {
  course_id: number;
  organization_id: number;
  organization_name: string;
  contact_email: string | null;
  course_type_name: string;
  location: string | null;
  date_completed: string | Date | null;
  registered_students: number;
  students_attended: number;
  rate_per_student: number;
  total_amount: number;
  instructor_name: string | null;
  instructor_email: string | null;
  ready_for_billing_at: string | Date | null;
}

/** Shape for a payment row from the payments table. */
export interface PaymentRow {
  id: number;
  invoice_id: number;
  amount: number;
  payment_method: string;
  reference_number: string | null;
  payment_date: string | Date;
  status: string;
  deleted_at: string | Date | null;
  created_at: string | Date;
}

/** Shape for student attendance in PDF/preview. */
export interface StudentAttendanceRow {
  first_name: string;
  last_name: string;
  email: string;
  attended: boolean;
}

/** Shape for revenue report month rows. */
export interface RevenueMonthRow {
  m: number;
  total: number;
}

/** Shape for AR aging invoice rows. */
export interface AgingInvoiceRow {
  invoice_id?: number;
  id: number;
  invoice_number: string;
  organization_id: number;
  organization_name: string;
  amount: number;
  paid_amount: number;
  balance: number;
  balance_due: number;
  invoice_date: string | Date;
  due_date: string | Date;
  days_overdue: number;
  days_outstanding: number;
  status: string;
  aging_bucket: string;
}
