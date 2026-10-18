import { getPool } from '../config/database.js';
import type { RowDataPacket } from 'mysql2/promise';
import { verifiedPayment } from '../utils/paymentSql.js';

/** Most transactions listed per side; totals and the monthly breakdown always cover every payment. */
export const MAX_SUMMARY_TRANSACTIONS = 1000;

interface MonthRow extends RowDataPacket { src: 'in' | 'vendor' | 'payroll'; ym: string; amount: string | number; count: number }

/**
 * Money in (verified organization payments) and money out (processed vendor
 * payments and completed instructor payroll) for a date range, by payment date.
 * Totals come from SQL aggregates, so they are right however many payments exist.
 */
export class FinancialSummaryService {
  async getSummary(startDate: string, endDate: string) {
    const pool = getPool();
    const range = [startDate, endDate];
    const limit = MAX_SUMMARY_TRANSACTIONS + 1; // one extra row tells us the list was cut

    const inWhere = `${verifiedPayment('p')} AND p.payment_date BETWEEN ? AND ?`;
    const vendorDate = 'COALESCE(vp.payment_date, DATE(vp.processed_at))';
    const vendorWhere = `vp.status = 'processed' AND ${vendorDate} BETWEEN ? AND ?`;
    const payrollWhere = `pp.status = 'completed' AND pp.payment_date BETWEEN ? AND ?`;

    // Four queries (the pool has six connections): one for every monthly total, one list per source.
    const [[monthRows], [inRows], [vendorRows], [payrollRows]] = await Promise.all([
      pool.query<MonthRow[]>(
        `SELECT 'in' AS src, DATE_FORMAT(p.payment_date, '%Y-%m') AS ym, SUM(p.amount) AS amount, COUNT(*) AS count
           FROM payments p WHERE ${inWhere} GROUP BY ym
         UNION ALL
         SELECT 'vendor', DATE_FORMAT(${vendorDate}, '%Y-%m'), SUM(vp.amount), COUNT(*)
           FROM vendor_payments vp WHERE ${vendorWhere} GROUP BY 2
         UNION ALL
         SELECT 'payroll', DATE_FORMAT(pp.payment_date, '%Y-%m'), SUM(pp.amount), COUNT(*)
           FROM payroll_payments pp WHERE ${payrollWhere} GROUP BY 2`,
        [...range, ...range, ...range]),
      pool.query<RowDataPacket[]>(
        `SELECT p.id, DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS date, o.name AS organization_name,
                i.invoice_number, p.payment_method, p.reference_number, p.amount, p.status
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN organizations o ON o.id = i.organization_id
         WHERE ${inWhere}
         ORDER BY p.payment_date DESC, p.id DESC LIMIT ?`, [...range, limit]),
      pool.query<RowDataPacket[]>(
        `SELECT vp.id, DATE_FORMAT(${vendorDate}, '%Y-%m-%d') AS date, v.name AS payee_name,
                vi.invoice_number, vi.description, vp.reference_number, vp.amount
         FROM vendor_payments vp
         JOIN vendor_invoices vi ON vi.id = vp.vendor_invoice_id
         LEFT JOIN vendors v ON v.id = vi.vendor_id
         WHERE ${vendorWhere}
         ORDER BY date DESC, vp.id DESC LIMIT ?`, [...range, limit]),
      pool.query<RowDataPacket[]>(
        `SELECT pp.id, DATE_FORMAT(pp.payment_date, '%Y-%m-%d') AS date,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.username) AS payee_name,
                pp.transaction_id AS reference_number, pp.notes AS description, pp.amount
         FROM payroll_payments pp
         LEFT JOIN users u ON u.id = pp.instructor_id
         WHERE ${payrollWhere}
         ORDER BY pp.payment_date DESC, pp.id DESC LIMIT ?`, [...range, limit]),
    ]);
    const inMonths = monthRows.filter((r) => r.src === 'in');
    const vendorMonths = monthRows.filter((r) => r.src === 'vendor');
    const payrollMonths = monthRows.filter((r) => r.src === 'payroll');

    const totals = (rows: MonthRow[]) => ({
      amount: round2(rows.reduce((s, r) => s + Number(r.amount), 0)),
      count: rows.reduce((s, r) => s + Number(r.count), 0),
    });
    const moneyIn = totals(inMonths);
    const vendor = totals(vendorMonths);
    const payroll = totals(payrollMonths);
    const totalOut = round2(vendor.amount + payroll.amount);

    const months = new Map<string, { money_in: number; money_out: number }>();
    const bump = (rows: MonthRow[], key: 'money_in' | 'money_out') => rows.forEach((r) => {
      const m = months.get(r.ym) ?? { money_in: 0, money_out: 0 };
      m[key] += Number(r.amount);
      months.set(r.ym, m);
    });
    bump(inMonths, 'money_in');
    bump(vendorMonths, 'money_out');
    bump(payrollMonths, 'money_out');

    // Money out merges two capped lists. Keep one consistent window: nothing older
    // than the oldest row kept from a source that was cut, then the newest 1,000.
    const vendorCut = vendorRows.length > MAX_SUMMARY_TRANSACTIONS;
    const payrollCut = payrollRows.length > MAX_SUMMARY_TRANSACTIONS;
    const cutoffs = [
      vendorCut ? vendorRows[MAX_SUMMARY_TRANSACTIONS - 1].date : null,
      payrollCut ? payrollRows[MAX_SUMMARY_TRANSACTIONS - 1].date : null,
    ].filter((d): d is string => d !== null);
    const cutoff = cutoffs.sort().pop(); // the later of the two
    const merged = [
      ...vendorRows.slice(0, MAX_SUMMARY_TRANSACTIONS).map((r) => ({
        id: r.id, date: r.date, category: 'vendor' as const, payee_name: r.payee_name ?? '',
        invoice_number: r.invoice_number, description: r.description ?? '', reference_number: r.reference_number ?? '',
        amount: Number(r.amount),
      })),
      ...payrollRows.slice(0, MAX_SUMMARY_TRANSACTIONS).map((r) => ({
        id: r.id, date: r.date, category: 'instructor' as const, payee_name: r.payee_name ?? '',
        description: r.description ?? '', reference_number: r.reference_number ?? '',
        amount: Number(r.amount),
      })),
    ]
      .filter((t) => !cutoff || t.date >= cutoff)
      .sort((a, b) => b.date.localeCompare(a.date));
    const moneyOutRows = merged.slice(0, MAX_SUMMARY_TRANSACTIONS);

    return {
      period: { start_date: startDate, end_date: endDate },
      money_in: {
        organization_payments: moneyIn,
        total: moneyIn.amount,
        transactions: inRows.slice(0, MAX_SUMMARY_TRANSACTIONS).map((r) => ({
          id: r.id, date: r.date, organization_name: r.organization_name ?? '', invoice_number: r.invoice_number,
          payment_method: r.payment_method ?? '', reference_number: r.reference_number ?? '',
          amount: Number(r.amount), status: r.status,
        })),
        transactions_truncated: inRows.length > MAX_SUMMARY_TRANSACTIONS,
      },
      money_out: {
        vendor_payments: vendor,
        instructor_payments: payroll,
        total: totalOut,
        transactions: moneyOutRows,
        transactions_truncated: vendorCut || payrollCut || merged.length > MAX_SUMMARY_TRANSACTIONS,
      },
      net_cash_flow: round2(moneyIn.amount - totalOut),
      monthly_breakdown: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month,
          month_label: monthLabel(month),
          money_in: round2(v.money_in),
          money_out: round2(v.money_out),
        })),
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
