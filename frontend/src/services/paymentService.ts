import { getInvoicePayments as apiGetInvoicePayments, recordInvoicePayment } from './api';
import type { InvoicePaymentData } from '../types/api';

export const getInvoicePayments = async (invoiceId: number) => {
  return apiGetInvoicePayments(invoiceId);
};

/**
 * POST /accounting/invoices/:id/payments. The backend validates the body with a
 * zod schema that accepts exactly `{ amount, paymentMethod, reference? }` and
 * strips everything else, so the payload is typed to that shape.
 */
export const recordPayment = async (invoiceId: number, paymentData: InvoicePaymentData) => {
  return recordInvoicePayment(invoiceId, paymentData);
};

export default {
  getInvoicePayments,
  recordPayment,
};
