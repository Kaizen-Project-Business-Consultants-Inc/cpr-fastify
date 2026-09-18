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
  };
  money_out: {
    vendor_payments: { amount: number; count: number };
    instructor_payments: { amount: number; count: number };
    total: number;
    transactions: MoneyOutTransaction[];
  };
  net_cash_flow: number;
  monthly_breakdown: Array<{
    month: string;
    month_label: string;
    money_in: number;
    money_out: number;
  }>;
}

export type RawRow = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const dateKey = (v: unknown): string => str(v).slice(0, 10); // YYYY-MM-DD, no UTC shift
const round2 = (n: number) => Math.round(n * 100) / 100;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
};

/** Pull the row array out of the two list endpoints regardless of pagination wrapper. */
export const extractRows = (payload: unknown): RawRow[] => {
  const d = (payload as { data?: unknown } | undefined)?.data;
  if (Array.isArray(d)) return d as RawRow[];
  const inner = d as { invoices?: unknown; data?: unknown } | undefined;
  if (Array.isArray(inner?.invoices)) return inner!.invoices as RawRow[];
  if (Array.isArray(inner?.data)) return inner!.data as RawRow[];
  return [];
};

/**
 * There is no /accounting/financial-summary endpoint. Build the summary on the client from
 * the invoice list (money in = verified payments applied to invoices) and the vendor invoice
 * list (money out = processed vendor payments). Instructor payouts are not tracked here.
 */
export const buildFinancialSummary = (
  invoices: RawRow[],
  vendorInvoices: RawRow[],
  startDate: string,
  endDate: string
): FinancialSummary => {
  const inRange = (d: string) => !!d && d >= startDate && d <= endDate;

  const moneyIn: MoneyInTransaction[] = invoices
    .filter((i) => num(i.amount_paid ?? i.amountPaid) > 0)
    .map((i) => ({
      id: num(i.id),
      date: dateKey(i.paid_date ?? i.paidDate ?? i.invoice_date ?? i.invoiceDate),
      organization_name: str(i.organization_name ?? i.organizationName),
      invoice_number: str(i.invoice_number ?? i.invoiceNumber),
      payment_method: '—',
      reference_number: '—',
      amount: num(i.amount_paid ?? i.amountPaid),
      status: str(i.payment_status ?? i.paymentStatus ?? i.status),
    }))
    .filter((t) => inRange(t.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const moneyOut: MoneyOutTransaction[] = vendorInvoices
    .filter((v) => num(v.total_paid ?? v.totalPaid) > 0)
    .map((v) => ({
      id: num(v.id),
      date: dateKey(v.paid_at ?? v.paidAt ?? v.paid_date ?? v.payment_date ?? v.updated_at ?? v.invoice_date ?? v.invoiceDate),
      category: 'vendor' as const,
      payee_name: str(v.vendor_name ?? v.vendorName),
      invoice_number: str(v.invoice_number ?? v.invoiceNumber),
      description: str(v.description),
      reference_number: '—',
      amount: num(v.total_paid ?? v.totalPaid),
    }))
    .filter((t) => inRange(t.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const sum = (xs: { amount: number }[]) => round2(xs.reduce((a, x) => a + x.amount, 0));
  const months = new Map<string, { money_in: number; money_out: number }>();
  const bump = (d: string, k: 'money_in' | 'money_out', amt: number) => {
    const ym = d.slice(0, 7);
    const e = months.get(ym) ?? { money_in: 0, money_out: 0 };
    e[k] += amt;
    months.set(ym, e);
  };
  moneyIn.forEach((t) => bump(t.date, 'money_in', t.amount));
  moneyOut.forEach((t) => bump(t.date, 'money_out', t.amount));

  const totalIn = sum(moneyIn);
  const totalOut = sum(moneyOut);
  return {
    period: { start_date: startDate, end_date: endDate },
    money_in: {
      organization_payments: { amount: totalIn, count: moneyIn.length },
      total: totalIn,
      transactions: moneyIn,
    },
    money_out: {
      vendor_payments: { amount: totalOut, count: moneyOut.length },
      instructor_payments: { amount: 0, count: 0 },
      total: totalOut,
      transactions: moneyOut,
    },
    net_cash_flow: round2(totalIn - totalOut),
    monthly_breakdown: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        month_label: monthLabel(month),
        money_in: round2(v.money_in),
        money_out: round2(v.money_out),
      })),
  };
};

/** Escape one CSV cell: quote, double inner quotes, neutralise formula-leading characters. */
export const csvCell = (value: unknown): string => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
