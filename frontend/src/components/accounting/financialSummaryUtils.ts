export interface MoneyInTransaction {
  id: number;
  date: string;
  organization_name: string;
  invoice_number: string;
  payment_method: string;
  reference_number: string;
  amount: number;
  status: string;
}

export interface MoneyOutTransaction {
  id: number;
  date: string;
  category: 'vendor' | 'instructor';
  payee_name: string;
  invoice_number?: string;
  description?: string;
  reference_number?: string;
  amount: number;
}

export interface FinancialSummary {
  period: {
    start_date: string;
    end_date: string;
  };
  money_in: {
    organization_payments: { amount: number; count: number };
    total: number;
    transactions: MoneyInTransaction[];
    /** The list stops at the server's cap; totals still cover every payment. */
    transactions_truncated?: boolean;
  };
  money_out: {
    vendor_payments: { amount: number; count: number };
    instructor_payments: { amount: number; count: number };
    total: number;
    transactions: MoneyOutTransaction[];
    transactions_truncated?: boolean;
  };
  net_cash_flow: number;
  monthly_breakdown: Array<{
    month: string;
    month_label: string;
    money_in: number;
    money_out: number;
  }>;
}

/** Escape one CSV cell: quote, double inner quotes, neutralise formula-leading characters. */
export const csvCell = (value: unknown): string => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
