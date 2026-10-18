import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 5b of the 2026-10-17 code sweep: one definition of "paid", one invoice loader.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));

import { VERIFIED_PAYMENT_FILTER, VERIFIED_PAID_BY_INVOICE, verifiedPayment, pendingPayment } from '../utils/paymentSql.js';
import { loadInvoiceForAccounting, loadInvoiceForOrganization } from '../services/invoiceDocument.js';

describe('payment rules', () => {
  it('counts only verified, non-deleted payments as paid', () => {
    expect(VERIFIED_PAYMENT_FILTER).toBe("status = 'verified' AND deleted_at IS NULL");
    expect(verifiedPayment('p')).toBe("p.status = 'verified' AND p.deleted_at IS NULL");
    expect(pendingPayment('p')).toBe("p.status = 'pending_verification' AND p.deleted_at IS NULL");
    expect(VERIFIED_PAID_BY_INVOICE).toContain(VERIFIED_PAYMENT_FILTER);
  });
});

describe('invoice document loaders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('limits an organization to its own invoices and skips removed students', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 3, invoice_number: 'INV-3', course_request_id: 9 }]])
      .mockResolvedValueOnce([[{ first_name: 'Ana', last_name: 'Bo', email: '', attended: 1 }]]);

    const invoice = await loadInvoiceForOrganization(3, 12);

    const [invoiceSql, invoiceParams] = mockQuery.mock.calls[0];
    expect(invoiceSql).toContain('AND i.organization_id = ?');
    expect(invoiceParams).toEqual([3, 12]);
    const [rosterSql, rosterParams] = mockQuery.mock.calls[1];
    expect(rosterSql).toContain('deleted_at IS NULL');
    expect(rosterParams).toEqual([9]);
    expect(invoice).toMatchObject({ invoice_id: 3, attendance_list: [{ first_name: 'Ana' }] });
  });

  it('never matches when the organization is unknown', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    expect(await loadInvoiceForOrganization(3, null)).toBeNull();
    expect(mockQuery.mock.calls[0][1]).toEqual([3, null]);
  });

  it('lets accounting load any invoice', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    await loadInvoiceForAccounting(3);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('organization_id = ?');
    expect(params).toEqual([3]);
  });
});
