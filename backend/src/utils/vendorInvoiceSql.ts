/** camelCase aliases for vendor_invoices columns, as the vendor and accounting screens read them. */
export const VI_CAMEL_COLS = `vi.invoice_number as invoiceNumber, vi.due_date as dueDate,
              vi.invoice_date as invoiceDate, vi.manual_type as item,
              vi.payment_date as paymentDate, vi.pdf_filename as pdfFilename,
              vi.created_at as createdAt, vi.updated_at as updatedAt,
              vi.admin_notes as adminNotes, vi.rejection_reason as rejectionReason,
              vi.sent_to_accounting_at as sentToAccountingAt, vi.paid_at as paidAt,
              vi.approved_by as approvedBy, vi.approved_at as approvedAt,
              vi.vendor_id as vendorId`;

/**
 * Columns from a `payments` join on PROCESSED_PAID_BY_VENDOR_INVOICE (utils/paymentSql.ts)
 * and the vendor row `v`, in snake and
 * camelCase: what was paid, what is still owed, and how the vendor was paid.
 * `paymentStatus` is derived (vendor_invoices has no such column): paid when
 * the payments cover the total, partially_paid when some money was paid, else unpaid.
 */
export const VI_PAYMENT_COLS = `COALESCE(payments.total_paid, 0) as total_paid, COALESCE(payments.total_paid, 0) as totalPaid,
              (COALESCE(vi.total, vi.amount) - COALESCE(payments.total_paid, 0)) as balance_due,
              (COALESCE(vi.total, vi.amount) - COALESCE(payments.total_paid, 0)) as balanceDue,
              payments.last_payment_method as vendorPaymentMethod,
              CASE WHEN COALESCE(payments.total_paid, 0) >= COALESCE(vi.total, vi.amount) AND COALESCE(payments.total_paid, 0) > 0 THEN 'paid'
                   WHEN COALESCE(payments.total_paid, 0) > 0 THEN 'partially_paid'
                   ELSE 'unpaid' END as paymentStatus,
              v.contact_name as vendorContact`;
