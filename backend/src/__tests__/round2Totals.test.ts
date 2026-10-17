import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Round 2 of the 2026-10-17 code sweep: totals that were wrong.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async () => {},
}));

import { monthRange } from '../utils/monthRange.js';
import { FinancialSummaryService, MAX_SUMMARY_TRANSACTIONS } from '../services/FinancialSummaryService.js';
import { payrollRoutes } from '../routes/payroll.js';
import { timesheetRoutes } from '../routes/timesheets.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';

describe('monthRange', () => {
  it('turns YYYY-MM into that month only', () => {
    expect(monthRange('2026-03')).toEqual(['2026-03-01', '2026-04-01']);
    expect(monthRange('2026-12')).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('accepts a single-digit month typed into a plain text box', () => {
    expect(monthRange('2026-3')).toEqual(['2026-03-01', '2026-04-01']);
  });

  it('reads a bare month number as this year, never every year', () => {
    expect(monthRange('3', new Date(2027, 5, 1))).toEqual(['2027-03-01', '2027-04-01']);
  });

  it('ignores values that are not a month', () => {
    expect(monthRange('13')).toBeNull();
    expect(monthRange('2026-00')).toBeNull();
    expect(monthRange('March')).toBeNull();
  });
});

describe('FinancialSummaryService', () => {
  beforeEach(() => vi.clearAllMocks());

  // Four queries run in this order: every monthly total (tagged by src), then the
  // money-in, vendor and payroll lists.
  function answer(results: unknown[][]) {
    results.forEach((rows) => mockQuery.mockResolvedValueOnce([rows]));
  }

  it('totals every payment by payment date, including instructor payroll', async () => {
    answer([
      [
        { src: 'in', ym: '2026-01', amount: '1000.50', count: 600 },
        { src: 'in', ym: '2026-02', amount: '250.00', count: 1 },
        { src: 'vendor', ym: '2026-02', amount: '100.00', count: 1 },
        { src: 'payroll', ym: '2026-01', amount: '300.00', count: 2 },
      ],
      [{ id: 1, date: '2026-02-03', organization_name: 'Acme', invoice_number: 'INV-1', payment_method: 'cheque', reference_number: 'C-9', amount: '250.00', status: 'verified' }],
      [{ id: 7, date: '2026-02-10', payee_name: 'Supplies Co', invoice_number: 'V-1', description: 'Manikins', reference_number: null, amount: '100.00' }],
      [{ id: 3, date: '2026-01-31', payee_name: 'Pat Lee', reference_number: 'TX-1', description: null, amount: '150.00' }],
    ]);

    const s = await new FinancialSummaryService().getSummary('2026-01-01', '2026-12-31');

    expect(s.money_in.organization_payments).toEqual({ amount: 1250.5, count: 601 });
    expect(s.money_out.vendor_payments).toEqual({ amount: 100, count: 1 });
    expect(s.money_out.instructor_payments).toEqual({ amount: 300, count: 2 });
    expect(s.money_out.total).toBe(400);
    expect(s.net_cash_flow).toBe(850.5);
    expect(s.monthly_breakdown).toEqual([
      { month: '2026-01', month_label: expect.any(String), money_in: 1000.5, money_out: 300 },
      { month: '2026-02', month_label: expect.any(String), money_in: 250, money_out: 100 },
    ]);
    expect(s.money_out.transactions.map((t) => t.category)).toEqual(['vendor', 'instructor']);
    expect(s.money_in.transactions_truncated).toBe(false);

    const [monthSql, monthParams] = mockQuery.mock.calls[0];
    expect(monthSql).toContain("p.status = 'verified' AND p.deleted_at IS NULL AND p.payment_date BETWEEN ? AND ?");
    expect(monthParams).toEqual(['2026-01-01', '2026-12-31', '2026-01-01', '2026-12-31', '2026-01-01', '2026-12-31']);
  });

  it('caps the listed transactions but says so', async () => {
    const many = Array.from({ length: MAX_SUMMARY_TRANSACTIONS + 1 }, (_, i) => ({ id: i, date: '2026-01-01', amount: '1.00' }));
    answer([[{ src: 'in', ym: '2026-01', amount: '1001.00', count: 1001 }], many, [], []]);

    const s = await new FinancialSummaryService().getSummary('2026-01-01', '2026-01-31');

    expect(s.money_in.transactions).toHaveLength(MAX_SUMMARY_TRANSACTIONS);
    expect(s.money_in.transactions_truncated).toBe(true);
    expect(s.money_in.total).toBe(1001);
  });

  it('keeps money out to one window when a source is cut', async () => {
    // Vendor list is cut: its 1,000th newest row is dated 2026-06-01, so payroll rows
    // older than that would make the merged list a mix of two different windows.
    const vendor = Array.from({ length: MAX_SUMMARY_TRANSACTIONS + 1 }, (_, i) => ({ id: i, date: i < 1000 ? '2026-06-01' : '2026-05-01', amount: '1.00' }));
    const payroll = [{ id: 1, date: '2026-07-01', amount: '5.00' }, { id: 2, date: '2026-01-15', amount: '5.00' }];
    answer([[], [], vendor, payroll]);

    const s = await new FinancialSummaryService().getSummary('2026-01-01', '2026-12-31');

    expect(s.money_out.transactions).toHaveLength(MAX_SUMMARY_TRANSACTIONS);
    expect(s.money_out.transactions[0]).toMatchObject({ category: 'instructor', date: '2026-07-01' });
    expect(s.money_out.transactions.some((t) => t.date < '2026-06-01')).toBe(false);
    expect(s.money_out.transactions_truncated).toBe(true);
  });
});

describe('payroll month filter', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (sql: string) => (sql.includes('COUNT(') ? [[{ total: 0, count: 0 }]] : [[]]));
    app = Fastify();
    await app.register(payrollRoutes, { prefix: '/payroll' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('filters payments to the chosen month of the chosen year', async () => {
    const res = await app.inject({ method: 'GET', url: '/payroll/payments?month=2026-03' });

    expect(res.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.payment_date >= ? AND p.payment_date < ?');
    expect(sql).not.toContain('MONTH(p.payment_date)');
    expect(params).toEqual(expect.arrayContaining(['2026-03-01', '2026-04-01']));
  });

  it('says what to type when the month is unreadable', async () => {
    const res = await app.inject({ method: 'GET', url: '/payroll/payments?month=March' });

    expect(res.statusCode).toBe(400);
    // The app's errorHandler sends this as { error }; bare Fastify (this test) uses { message }.
    expect(res.json().message).toBe('Month must look like 2026-03');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('timesheet month filter', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (sql: string) => (sql.includes('COUNT(') ? [[{ total: 0, count: 0 }]] : [[]]));
    app = Fastify();
    app.decorateRequest('userId', 0);
    app.decorateRequest('userRole', '');
    // An instructor sees only their own timesheets: the scope param comes before the month.
    app.addHook('preHandler', async (request) => { request.userId = 9; request.userRole = 'instructor'; });
    await app.register(timesheetRoutes, { prefix: '/timesheet' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('filters by week start within the chosen month and year', async () => {
    const res = await app.inject({ method: 'GET', url: '/timesheet?month=2026-03' });

    expect(res.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('t.week_start_date >= ? AND t.week_start_date < ?');
    expect(params.slice(0, 3)).toEqual([9, '2026-03-01', '2026-04-01']);
  });
});

describe('organization course date filter', () => {
  it('filters on scheduled_date, the column that exists', async () => {
    mockQuery.mockResolvedValue([[{ total: 0 }]]);

    await new OrganizationRepository().getOrgCourses(5, { archived: false, limit: 10, offset: 0, from: '2026-01-01', to: '2026-01-31' });

    const sqls = mockQuery.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sqls).toContain('cr.scheduled_date >= ?');
    expect(sqls).not.toContain('date_scheduled');
  });
});
