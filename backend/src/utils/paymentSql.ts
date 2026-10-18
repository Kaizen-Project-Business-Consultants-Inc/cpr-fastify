/**
 * The one definition of "paid" in SQL. Every balance, total and status check
 * uses these, so the organization's view and accounting's can't drift apart.
 */

/** A verified, non-deleted organization payment (unaliased `payments` row). */
export const VERIFIED_PAYMENT_FILTER = "status = 'verified' AND deleted_at IS NULL";

/** The same test for an aliased `payments` row, e.g. `verifiedPayment('p')`. */
export const verifiedPayment = (alias: string) => `${alias}.status = 'verified' AND ${alias}.deleted_at IS NULL`;

/** A payment the organization submitted that accounting hasn't checked yet (aliased). */
export const pendingPayment = (alias: string) => `${alias}.status = 'pending_verification' AND ${alias}.deleted_at IS NULL`;

/** Derived table `(invoice_id, total_paid)`: verified payments per invoice. */
export const VERIFIED_PAID_BY_INVOICE =
  `(SELECT invoice_id, SUM(amount) AS total_paid FROM payments WHERE ${VERIFIED_PAYMENT_FILTER} GROUP BY invoice_id)`;

/** Derived table `(vendor_invoice_id, total_paid)`: processed payments per vendor invoice. */
export const PROCESSED_PAID_BY_VENDOR_INVOICE =
  "(SELECT vendor_invoice_id, SUM(amount) AS total_paid FROM vendor_payments WHERE status = 'processed' GROUP BY vendor_invoice_id)";
