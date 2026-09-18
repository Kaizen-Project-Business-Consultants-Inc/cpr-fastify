import { getInvoicePayments as apiGetInvoicePayments, recordInvoicePayment } from './api';
import type { PaymentData } from '../types/api';

export const getInvoicePayments = async (invoiceId: number) => {
  return apiGetInvoicePayments(invoiceId);
};

// Callers (outside this package's ownership) pass payloads that don't match the
// PaymentData shape 1:1 (e.g. amount_paid vs amount), so we accept a broader
// record here rather than the strict PaymentData type used by api.ts internally.
export const recordPayment = async (invoiceId: number, paymentData: Record<string, unknown>) => {
  return recordInvoicePayment(invoiceId, paymentData as unknown as PaymentData);
};

export default {
  getInvoicePayments,
  recordPayment,
};
