import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// The accounting billing screens read the SQL names as sent (there is no case
// conversion anywhere). These pin the fields each screen reads, so a renamed
// alias shows up here instead of as a blank or empty screen.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async () => {},
}));
vi.mock('../utils/taxConfig.js', () => ({
  getHSTRate: () => 0.13,
  getHSTLabel: () => 'HST (13%)',
}));

import { billingRoutes } from '../routes/billing.js';
import { orgBillingRoutes } from '../routes/org-billing.js';
import { completedClassDate } from '../utils/classDateSql.js';

/** Answer each query with `rows`, and any COUNT(*) with a count. */
const answerWith = (rows: unknown[]) =>
  mockQuery.mockImplementation(async (sql: string) =>
    /^\s*SELECT COUNT\(\*\)/i.test(sql) ? [[{ count: rows.length }]] : [rows]);

const sqlOf = (match: RegExp) => {
  const call = mockQuery.mock.calls.find(([sql]) => match.test(sql as string));
  expect(call, `no query matching ${match}`).toBeTruthy();
  return call![0] as string;
};

describe('accounting billing screens: billing routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(billingRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('Organization Receivables and Invoice History get the snake_case fields they read', async () => {
    const row = {
      id: 7, invoice_number: 'INV-1', organization_id: 3, course_request_id: 12,
      invoice_date: '2026-10-01T00:00:00.000Z', due_date: '2026-10-31T00:00:00.000Z',
      amount: '113.00', base_cost: '100.00', tax_amount: '13.00', students_billed: 2, rate_per_student: '50.00',
      approval_status: 'approved', approved_at: '2026-10-02T14:00:00.000Z', posted_to_org: 1, posted_to_org_at: null,
      organization_name: 'Acme', course_type_name: 'CPR-C', location: 'Hall', date_completed: null,
      amount_paid: '0.00', balance_due: '113.00', payment_status: 'pending', aging_bucket: 'current',
    };
    answerWith([row]);

    const res = await app.inject({ method: 'GET', url: '/invoices?page=1&limit=25' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([row]);
    const sql = sqlOf(/FROM invoice_with_breakdown i\s+JOIN invoices ia/);
    for (const field of [
      'i.id', 'i.invoice_number', 'i.organization_id', 'i.course_request_id', 'as invoice_date', 'i.due_date',
      'i.base_cost', 'i.tax_amount', 'i.students_billed', 'i.rate_per_student', 'i.approval_status',
      'i.posted_to_org', 'i.posted_to_org_at', 'ia.approved_at', 'as organization_name', 'as course_type_name',
      'as date_completed', 'as amount_paid', 'as balance_due', 'as payment_status', 'as aging_bucket',
    ]) expect(sql).toContain(field);
  });

  it('Ready for Billing gets course_id and the figures the screen maps', async () => {
    answerWith([]);

    await app.inject({ method: 'GET', url: '/billing-queue' });

    const sql = sqlOf(/FROM course_requests cr/);
    for (const field of [
      'cr.id as course_id', 'as organization_name', 'o.contact_email', 'as course_type_name', 'cr.location',
      'as date_completed', 'cr.registered_students', 'as students_attended', 'as rate_per_student',
      'as total_amount', 'as instructor_name',
    ]) expect(sql).toContain(field);
  });

  it('Invoice Detail gets the approver name, payment status and address parts', async () => {
    answerWith([{ id: 7, invoice_number: 'INV-1', approved_by: 2, approved_by_name: 'Ann Accountant', payment_status: 'pending' }]);

    const res = await app.inject({ method: 'GET', url: '/invoices/7' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ approved_by_name: 'Ann Accountant', payment_status: 'pending' });
    const sql = sqlOf(/FROM invoices i\s+JOIN organizations o/);
    expect(sql).toContain('LEFT JOIN users au ON i.approved_by = au.id');
    for (const field of [
      'i.*', 'as organization_name', 'o.contact_email', 'o.contact_name', 'o.address_street', 'o.address_city',
      'o.address_province', 'o.address_postal_code', 'as course_date', 'as date_completed', 'as course_type_name',
      'as rate_per_student', 'as approved_by_name', 'as amount_paid', 'as balance_due', 'as payment_status',
    ]) expect(sql).toContain(field);
  });

  it('payment history rows carry camelCase copies next to the raw columns', async () => {
    answerWith([]);

    await app.inject({ method: 'GET', url: '/invoices/7/payments' });

    const sql = sqlOf(/FROM payments WHERE invoice_id = \?/);
    expect(sql).toMatch(/SELECT \*,/);
    for (const field of [
      'invoice_id AS invoiceId', 'payment_date AS paymentDate', 'payment_method AS paymentMethod',
      'reference_number AS referenceNumber', 'submitted_by_org_at AS submittedByOrgAt',
      'verified_by_accounting_at AS verifiedByAccountingAt', 'created_at AS createdAt',
    ]) expect(sql).toContain(field);
  });

  it('the invoice CSV holds every invoice and prints dates as YYYY-MM-DD', async () => {
    answerWith([{
      invoice_number: 'INV-1', organization_name: 'Acme',
      invoice_date: new Date('2026-10-01T00:00:00.000Z'), due_date: new Date('2026-10-31T00:00:00.000Z'),
      amount: '113.00',
    }]);

    const res = await app.inject({ method: 'GET', url: '/invoices/export/csv' });

    expect(res.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('LIMIT 500');
    expect(sql).toMatch(/LIMIT \?$/);
    expect(params).toEqual([100000]);
    const dataLine = res.body.split('\n')[1];
    expect(dataLine).toContain('"2026-10-01","2026-10-31"');
    expect(res.body).not.toMatch(/GMT|Coordinated Universal Time/);
  });
});

describe('accounting billing screens: payment verification', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(orgBillingRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('sends the course block the detail dialog reads', async () => {
    answerWith([]);

    const res = await app.inject({ method: 'GET', url: '/accounting/payment-verifications' });

    expect(res.statusCode).toBe(200);
    const sql = sqlOf(/p\.id as paymentId/);
    for (const field of [
      'as invoiceId', 'as invoiceNumber', 'as courseRequestId', 'as organizationName',
      'i.course_type_name as courseTypeName', 'i.location', 'i.students_billed as studentsAttended',
      'i.rate_per_student as ratePerStudent', 'i.base_cost as baseCost', 'i.tax_amount as taxAmount',
      'i.amount as invoiceAmount',
    ]) expect(sql).toContain(field);
  });
});

// UAT 2026-10-21: a class finished at 8:26 pm Toronto showed as completed the
// next day, because completed_at is UTC. Billing dates use the class's own day.
describe('billing dates use the day the class was held', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    answerWith([]);
    app = Fastify();
    await app.register(billingRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it.each([
    ['the billing queue', '/billing-queue', /FROM course_requests cr/],
    ['the invoice list', '/invoices', /FROM invoice_with_breakdown i/],
    ['an invoice', '/invoices/7', /FROM invoices i/],
  ])('%s', async (_label, url, match) => {
    await app.inject({ method: 'GET', url });
    const sql = sqlOf(match);
    expect(sql).toContain(`${completedClassDate('cr')} as date_completed`);
    expect(sql).not.toMatch(/completed_at\)? as date_completed/);
  });

  it('falls back to the completion day only when the class has no date', () => {
    expect(completedClassDate('cr')).toBe(
      'CASE WHEN cr.completed_at IS NOT NULL THEN COALESCE(cr.confirmed_date, cr.scheduled_date, DATE(cr.completed_at)) END');
  });
});
