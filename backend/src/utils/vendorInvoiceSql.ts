/** camelCase aliases for vendor_invoices columns, as the vendor and accounting screens read them. */
export const VI_CAMEL_COLS = `vi.invoice_number as invoiceNumber, vi.due_date as dueDate,
              vi.payment_date as paymentDate, vi.pdf_filename as pdfFilename,
              vi.created_at as createdAt, vi.updated_at as updatedAt,
              vi.admin_notes as adminNotes, vi.rejection_reason as rejectionReason,
              vi.sent_to_accounting_at as sentToAccountingAt, vi.paid_at as paidAt,
              vi.approved_by as approvedBy, vi.approved_at as approvedAt,
              vi.vendor_id as vendorId`;
