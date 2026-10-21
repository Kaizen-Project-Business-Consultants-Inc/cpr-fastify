import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Field check 2026-10-21: the vendor portal, the vendor-invoice screens (Course
// Admin + Accounting) and the Email Template Manager read fields the server never
// sent, and some writes named columns that do not exist. These pin the shapes.
const { mockQuery, mockConnQuery } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockConnQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({
    query: mockQuery,
    getConnection: async () => ({
      query: mockConnQuery, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    }),
  }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../services/EmailService.js', () => ({ emailService: { verifyConnection: vi.fn() } }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number; userRole: string }) => {
    request.userId = 12;
    request.userRole = 'admin';
  },
}));

import { vendorAdminRoutes } from '../routes/vendor-admin.js';
import { vendorRoutes } from '../routes/vendors.js';
import { emailTemplateRoutes } from '../routes/email-templates.js';
import { errorHandler } from '../plugins/errorHandler.js';

async function appWith(register: (app: FastifyInstance) => Promise<void>) {
  const app = Fastify();
  app.decorateRequest('userId', 0);
  app.decorateRequest('userRole', '');
  app.setErrorHandler(errorHandler);
  await register(app);
  await app.ready();
  return app;
}

const sqlOf = (mock: ReturnType<typeof vi.fn>, start: string) =>
  mock.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.trimStart().startsWith(start));

describe('vendor invoice lists and detail (Course Admin + Accounting)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([[]]);
    app = await appWith((a) => a.register(vendorAdminRoutes));
  });
  afterEach(() => app.close());

  it('admin list sends item, invoiceDate, payments, approver/rejecter names and how it was paid', async () => {
    await app.inject({ method: 'GET', url: '/admin/vendor-invoices?status=paid' });
    const [sql] = sqlOf(mockQuery, 'SELECT vi.*');
    for (const col of [
      'vi.manual_type as item', 'vi.invoice_date as invoiceDate',
      'as totalPaid', 'as balanceDue', 'as vendorPaymentMethod', 'as paymentStatus',
      'v.contact_name as vendorContact', 'u_approved.username as approvedByName', 'u_rejected.username as rejectedByName',
    ]) expect(sql).toContain(col);
    expect(sql).toContain('ON vi.rejected_by = u_rejected.id');
  });

  it('admin list count needs only the vendor join', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ count: 0 }]]);
    await app.inject({ method: 'GET', url: '/admin/vendor-invoices?page=1&limit=25' });
    const [count] = sqlOf(mockQuery, 'SELECT COUNT(*)');
    expect(count).toContain('LEFT JOIN vendors v');
    expect(count).not.toContain('vendor_payments');
  });

  it('accounting list and detail send the derived payment fields', async () => {
    await app.inject({ method: 'GET', url: '/accounting/vendor-invoices' });
    mockQuery.mockResolvedValueOnce([[{ id: 3 }]]).mockResolvedValueOnce([[]]);
    await app.inject({ method: 'GET', url: '/accounting/vendor-invoices/3' });
    const [list, detail] = sqlOf(mockQuery, 'SELECT vi.*');
    for (const sql of [list, detail]) {
      expect(sql).toContain('as vendorPaymentMethod');
      expect(sql).toContain("THEN 'partially_paid'");
      expect(sql).toContain('vi.manual_type as item');
    }
    expect(detail).toContain('u_rejected.username as rejectedByName');
  });

  it('payment rows are camelCase (paymentMethod may be NULL)', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 3 }]])
      .mockResolvedValueOnce([[{ id: 1, payment_method: null, paymentMethod: null, referenceNumber: 'R1' }]]);
    const res = await app.inject({ method: 'GET', url: '/accounting/vendor-invoices/3' });
    expect(res.json().data.payments[0]).toMatchObject({ paymentMethod: null, referenceNumber: 'R1' });
    expect(sqlOf(mockQuery, 'SELECT vp.*')[0]).toContain('vp.payment_method as paymentMethod');
  });

  it('Course Admin reject records who rejected it and never names the missing rejected_at column', async () => {
    mockConnQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM vendor_invoices vi WHERE') ? [[{ id: 5, invoice_number: 'V-5', total: '10.00' }]] : [{ affectedRows: 1 }]);
    const res = await app.inject({
      method: 'POST', url: '/admin/vendor-invoices/5/approve', payload: { action: 'reject', notes: 'Wrong rate' },
    });
    expect(res.statusCode).toBe(200);
    const update = mockConnQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE vendor_invoices'))!;
    expect(String(update[0])).toContain('rejected_by = ?');
    expect(String(update[0])).not.toContain('rejected_at');
    expect(update[1]).toEqual(['Wrong rate', 'Wrong rate', 12, '5']);
  });

  it('Course Admin approve stamps approved_at', async () => {
    mockConnQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM vendor_invoices vi WHERE') ? [[{ id: 5, invoice_number: 'V-5', total: '10.00' }]] : [{ affectedRows: 1 }]);
    await app.inject({ method: 'POST', url: '/admin/vendor-invoices/5/approve', payload: { action: 'approve' } });
    const update = mockConnQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE vendor_invoices'))!;
    expect(String(update[0])).toContain('approved_at = CURRENT_TIMESTAMP');
  });

  it('Accounting reject does not name rejected_at', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ id: 4, status: 'submitted_to_accounting', invoice_number: 'V-4' }]])
      .mockResolvedValueOnce([[{ n: 0 }]])
      .mockResolvedValue([{ affectedRows: 1 }]);
    const res = await app.inject({ method: 'POST', url: '/accounting/vendor-invoices/4/reject', payload: { notes: 'No PO' } });
    expect(res.statusCode).toBe(200);
    const update = mockConnQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE vendor_invoices'))!;
    expect(String(update[0])).not.toContain('rejected_at');
  });
});

describe('vendor portal', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await appWith((a) => a.register(vendorRoutes, { prefix: '/vendor' }));
  });
  afterEach(() => app.close());

  const asVendor = (rest: (sql: string, params: unknown[]) => unknown) =>
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT email FROM users')) return [[{ email: 'v@x.com' }]];
      if (sql.startsWith('SELECT id FROM vendors')) return [[{ id: 3 }]];
      return rest(sql, params);
    });

  it('profile update writes the real vendors columns', async () => {
    asVendor(() => [{ affectedRows: 1 }]);
    const res = await app.inject({
      method: 'PUT', url: '/vendor/profile',
      payload: { name: ' Acme ', contact_name: 'Pat Lee', contact_phone: '416-555-0100', address: '1 Main St, Toronto', vendor_type: 'supplier' },
    });
    expect(res.statusCode).toBe(200);
    const update = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE vendors'))!;
    expect(String(update[0])).toContain('SET name = ?, contact_name = ?, contact_phone = ?, address = ?');
    expect(String(update[0])).not.toMatch(/vendor_name|address_street|contact_first_name|\bphone = /);
    expect(update[1]).toEqual(['Acme', 'Pat Lee', '416-555-0100', '1 Main St, Toronto', 'supplier', 'v@x.com']);
  });

  it('profile update needs a company name', async () => {
    asVendor(() => [{ affectedRows: 1 }]);
    const res = await app.inject({ method: 'PUT', url: '/vendor/profile', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });

  it('dashboard counts invoices awaiting review, sums paid totals and times payment to paid_at', async () => {
    asVendor(() => [[{ pending: '2', total: 5, paid_total: '150.50', avg_days: '3.6' }]]);
    const res = await app.inject({ method: 'GET', url: '/vendor/dashboard' });
    expect(res.json().data).toEqual({ pendingInvoices: 2, totalInvoices: 5, totalPaid: 150.5, averagePaymentTime: 4 });
    const [sql] = sqlOf(mockQuery, 'SELECT SUM(');
    expect(sql).toContain("status IN ('submitted_to_admin', 'submitted_to_accounting')");
    expect(sql).toContain('COALESCE(total, amount)');
    expect(sql).toContain('DATEDIFF(paid_at');
    expect(sql).not.toContain('payment_date');
  });

  it('invoice details: camelCase payments and the approver name', async () => {
    asVendor((sql) => sql.startsWith('SELECT vi.*')
      ? [[{ id: 7, approvedByName: 'admin' }]]
      : [[{ id: 1, paymentMethod: null }]]);
    const res = await app.inject({ method: 'GET', url: '/vendor/invoices/7/details' });
    expect(res.json().data).toMatchObject({ approvedByName: 'admin', payments: [{ paymentMethod: null }] });
    expect(sqlOf(mockQuery, 'SELECT vp.*')[0]).toContain('vp.payment_method as paymentMethod');
    expect(sqlOf(mockQuery, 'SELECT vi.*')[0]).toContain('vi.manual_type as item');
  });

  it('invoice list sends item', async () => {
    asVendor(() => [[]]);
    await app.inject({ method: 'GET', url: '/vendor/invoices' });
    expect(sqlOf(mockQuery, 'SELECT vi.*')[0]).toContain('vi.manual_type as item');
  });

  it('resending a rejected invoice does not name rejected_at', async () => {
    asVendor(() => [{ affectedRows: 1 }]);
    await app.inject({ method: 'POST', url: '/vendor/invoices/7/resend-to-admin', payload: { notes: 'Fixed' } });
    const update = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE vendor_invoices'))!;
    expect(String(update[0])).not.toContain('rejected_at');
  });
});

describe('email templates', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await appWith((a) => a.register(emailTemplateRoutes, { prefix: '/email-templates' }));
  });
  afterEach(() => app.close());

  it('lists templates with camelCase fields and real booleans', async () => {
    mockQuery
      .mockResolvedValueOnce([[{
        id: 1, name: 'Welcome', category: 'system', sub_category: null, body: '<p>Hi</p>',
        is_active: 1, is_system: 1, updated_at: '2026-10-01T12:00:00.000Z',
      }]])
      .mockResolvedValueOnce([[{ count: 1 }]]);
    const res = await app.inject({ method: 'GET', url: '/email-templates' });
    expect(res.json().data[0]).toMatchObject({
      isActive: true, isSystem: true, subCategory: '', htmlContent: '<p>Hi</p>', updatedAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('refuses to delete a system template', async () => {
    mockQuery.mockResolvedValueOnce([[{ is_system: 1 }]]);
    const res = await app.inject({ method: 'DELETE', url: '/email-templates/1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/System templates cannot be deleted/);
    expect(sqlOf(mockQuery, 'DELETE')).toHaveLength(0);
  });

  it('deletes a non-system template', async () => {
    mockQuery.mockResolvedValueOnce([[{ is_system: 0 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await app.inject({ method: 'DELETE', url: '/email-templates/2' });
    expect(res.statusCode).toBe(200);
    expect(sqlOf(mockQuery, 'DELETE')[0]).toContain('is_system = 0');
  });

  it('test-send accepts { to } (what the screen now sends), not the old { recipientEmail }', async () => {
    const old = await app.inject({ method: 'POST', url: '/email-templates/1/test-send', payload: { recipientEmail: 'a@b.com' } });
    expect(old.statusCode).toBe(400);
    // Past validation it looks the template up; the mocked email service is "not configured".
    mockQuery.mockResolvedValueOnce([[{ id: 1, subject: 'Hi', body: '<p>Hi</p>' }]]);
    const res = await app.inject({ method: 'POST', url: '/email-templates/1/test-send', payload: { to: 'a@b.com' } });
    expect(res.statusCode).toBe(503);
  });
});
