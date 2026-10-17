import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Money routes must leave an audit entry: who changed what, and when.
const { mockPoolQuery, mockConnQuery, mockCommit, mockRollback } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockConnQuery: vi.fn(),
  mockCommit: vi.fn(),
  mockRollback: vi.fn(),
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({
    query: mockPoolQuery,
    getConnection: async () => ({
      query: mockConnQuery,
      beginTransaction: vi.fn(),
      commit: mockCommit,
      rollback: mockRollback,
      release: vi.fn(),
    }),
  }),
}));

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/taxConfig.js', () => ({
  getHSTRate: () => 0.13,
}));

// Skip JWT checks: every request acts as user 7.
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async (request: { userId: number }) => { request.userId = 7; },
  requireRole: () => async (request: { userId: number }) => { request.userId = 7; },
}));

import { organizationPricingRoutes } from '../routes/organization-pricing.js';
import { payrollRoutes } from '../routes/payroll.js';

const auditCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO audit_logs'));

describe('money routes write audit entries', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue([{}]);
    app = Fastify();
    app.decorateRequest('userId', 0);
    await app.register(organizationPricingRoutes, { prefix: '/organization-pricing' });
    await app.register(payrollRoutes, { prefix: '/payroll' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('records who deleted an organization price', async () => {
    mockPoolQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await app.inject({ method: 'DELETE', url: '/organization-pricing/admin/12' });

    expect(res.statusCode).toBe(200);
    const audits = auditCalls(mockPoolQuery);
    expect(audits).toHaveLength(1);
    expect(audits[0][1].slice(0, 5)).toEqual([7, null, 'delete_organization_pricing', 'organization_pricing', 12]);
  });

  it('writes no audit entry when nothing was deleted', async () => {
    mockPoolQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const res = await app.inject({ method: 'DELETE', url: '/organization-pricing/admin/99' });

    expect(res.statusCode).toBe(404);
    expect(auditCalls(mockPoolQuery)).toHaveLength(0);
  });

  it('records a processed payroll payment inside the same transaction, before commit', async () => {
    const order: string[] = [];
    mockConnQuery.mockImplementation(async (sql: string) => {
      order.push(sql.includes('audit_logs') ? 'audit' : 'query');
      return sql.startsWith('SELECT') ? [[{ id: 5, instructor_id: 3, amount: '250.00' }]] : [{ affectedRows: 1 }];
    });
    mockCommit.mockImplementation(async () => { order.push('commit'); });

    const res = await app.inject({
      method: 'POST', url: '/payroll/payments/5/process',
      payload: { action: 'approve', transaction_id: 'TX-1' },
    });

    expect(res.statusCode).toBe(200);
    const audits = auditCalls(mockConnQuery);
    expect(audits).toHaveLength(1);
    expect(audits[0][1].slice(0, 5)).toEqual([7, null, 'complete_payroll_payment', 'payroll_payment', 5]);
    expect(JSON.parse(audits[0][1][5])).toMatchObject({ instructorId: 3, amount: 250, transactionId: 'TX-1' });
    expect(order.slice(-2)).toEqual(['audit', 'commit']);
    expect(auditCalls(mockPoolQuery)).toHaveLength(0);
  });

  it('writes no audit entry when the payroll payment is not found', async () => {
    mockConnQuery.mockResolvedValueOnce([[]]);

    const res = await app.inject({
      method: 'POST', url: '/payroll/payments/5/process',
      payload: { action: 'approve' },
    });

    expect(res.statusCode).toBe(404);
    expect(mockRollback).toHaveBeenCalled();
    expect(auditCalls(mockConnQuery)).toHaveLength(0);
  });
});

describe('org-billing and vendor money routes write audit entries', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue([{}]);
    const { orgBillingRoutes } = await import('../routes/org-billing.js');
    const { vendorAdminRoutes } = await import('../routes/vendor-admin.js');
    app = Fastify();
    app.decorateRequest('userId', 0);
    await app.register(orgBillingRoutes);
    await app.register(vendorAdminRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('refuses a payment reversal after 48 hours without writing an audit entry', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    mockConnQuery.mockResolvedValueOnce([[{ id: 8, invoice_id: 2, amount: '90.00', verified_by_accounting_at: threeDaysAgo }]]);

    const res = await app.inject({
      method: 'POST', url: '/accounting/payments/8/reverse', payload: { reason: 'typo' },
    });

    expect(res.statusCode).toBe(400);
    expect(auditCalls(mockConnQuery)).toHaveLength(0);
  });

  it('records a vendor invoice payment inside the transaction', async () => {
    mockConnQuery.mockImplementation(async (sql: string) =>
      sql.trim().startsWith('SELECT')
        ? [[{ id: 3, total: '500.00', amount: '500.00', total_paid: '0', balance_due: '500.00' }]]
        : [{ insertId: 41, affectedRows: 1 }]);

    const res = await app.inject({
      method: 'POST', url: '/accounting/vendor-invoices/3/payments',
      payload: { amount: 200, paymentMethod: 'etransfer' },
    });

    expect(res.statusCode).toBe(200);
    const audits = auditCalls(mockConnQuery);
    expect(audits).toHaveLength(1);
    expect(audits[0][1].slice(0, 5)).toEqual([7, null, 'pay_vendor_invoice', 'vendor_payment', 41]);
    expect(JSON.parse(audits[0][1][5])).toMatchObject({ vendorInvoiceId: 3, amount: 200 });
  });
});
