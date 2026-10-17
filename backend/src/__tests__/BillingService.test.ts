import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
const mockQuery = vi.fn();
const mockConnQuery = vi.fn();
const mockConn = {
  query: mockConnQuery,
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve(mockConn) }),
}));

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/taxConfig.js', () => ({
  getHSTRate: () => 0.13,
  getHSTLabel: () => 'HST (13%)',
}));

import { BillingService, BillingError } from '../services/BillingService.js';
import { InvoiceRepository } from '../repositories/InvoiceRepository.js';
import { CoursePricingRepository } from '../repositories/CoursePricingRepository.js';

describe('BillingService', () => {
  let service: BillingService;
  let invoiceRepo: InvoiceRepository;
  let pricingRepo: CoursePricingRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    invoiceRepo = {
      getDashboard: vi.fn(),
      getBillingQueue: vi.fn(),
      findAllWithDetails: vi.fn(),
      findByIdWithDetails: vi.fn(),
      findById: vi.fn(),
      findPendingApproval: vi.fn(),
      findRejected: vi.fn(),
      getPayments: vi.fn(),
      execute: vi.fn(),
    } as unknown as InvoiceRepository;

    pricingRepo = {
      findAllActive: vi.fn(),
      findByOrg: vi.fn(),
      upsert: vi.fn(),
      updatePrice: vi.fn(),
      remove: vi.fn(),
    } as unknown as CoursePricingRepository;

    service = new BillingService(invoiceRepo, pricingRepo);
  });

  describe('upsertPricing', () => {
    it('delegates to pricingRepo on valid input', async () => {
      const expected = { id: 1, organization_id: 1, course_type_id: 1, price_per_student: 50 };
      vi.mocked(pricingRepo.upsert).mockResolvedValue(expected as any);

      const result = await service.upsertPricing(1, 1, 50);
      expect(result).toEqual(expected);
      expect(pricingRepo.upsert).toHaveBeenCalledWith(1, 1, 50);
    });

    it('throws BillingError when price is zero', async () => {
      await expect(service.upsertPricing(1, 1, 0))
        .rejects.toThrow(BillingError);
    });

    it('throws BillingError when price is negative', async () => {
      await expect(service.upsertPricing(1, 1, -10))
        .rejects.toThrow('All fields are required and price must be greater than 0');
    });
  });

  describe('approve', () => {
    it('approves a pending invoice', async () => {
      const invoice = { id: 1, approval_status: 'pending' };
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce(invoice as any)
        .mockResolvedValueOnce({ ...invoice, approval_status: 'approved' } as any);
      vi.mocked(invoiceRepo.execute).mockResolvedValue(undefined as any);

      const result = await service.approve(1, 42);
      expect(result.approval_status).toBe('approved');
      expect(invoiceRepo.execute).toHaveBeenCalledWith(
        expect.stringContaining("approval_status = 'approved'"),
        [42, 1]
      );
    });

    it('throws when invoice not found', async () => {
      vi.mocked(invoiceRepo.findById).mockResolvedValue(null);

      await expect(service.approve(999, 42))
        .rejects.toThrow('Invoice not found');
    });

    it('throws when invoice already approved', async () => {
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 1, approval_status: 'approved' } as any);

      await expect(service.approve(1, 42))
        .rejects.toThrow('Invoice is already approved');
    });
  });

  describe('reject', () => {
    it('rejects a pending invoice with reason', async () => {
      const invoice = { id: 1, approval_status: 'pending' };
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce(invoice as any)
        .mockResolvedValueOnce({ ...invoice, approval_status: 'rejected' } as any);
      vi.mocked(invoiceRepo.execute).mockResolvedValue(undefined as any);

      const result = await service.reject(1, 'Incorrect amount', 42);
      expect(result.approval_status).toBe('rejected');
    });

    it('throws when no reason provided', async () => {
      await expect(service.reject(1, '', 42))
        .rejects.toThrow('Rejection reason is required');
    });

    it('throws when invoice already rejected', async () => {
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 1, approval_status: 'rejected' } as any);

      await expect(service.reject(1, 'reason', 42))
        .rejects.toThrow('Invoice is already rejected');
    });
  });

  describe('resubmit', () => {
    it('resubmits a rejected invoice', async () => {
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce({ id: 1, approval_status: 'rejected' } as any)
        .mockResolvedValueOnce({ id: 1, approval_status: 'pending' } as any);
      vi.mocked(invoiceRepo.execute).mockResolvedValue(undefined as any);

      const result = await service.resubmit(1);
      expect(result.approval_status).toBe('pending');
    });

    it('throws when invoice is not rejected', async () => {
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 1, approval_status: 'pending' } as any);

      await expect(service.resubmit(1))
        .rejects.toThrow('Only rejected invoices can be resubmitted');
    });
  });

  describe('recordPayment', () => {
    it('records payment and marks invoice paid when fully paid', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, amount: 100, status: 'pending', total_paid: 0 }]]) // FOR UPDATE lock
        .mockResolvedValueOnce([{ insertId: 10 }]) // INSERT payment
        .mockResolvedValueOnce([{}]);               // UPDATE invoice status

      const result = await service.recordPayment(1, 100, 'cheque', 'REF-001');

      expect(result).toEqual({ id: 10, amount: 100, totalPaid: 100 });
      expect(mockConn.commit).toHaveBeenCalled();
      expect(mockConnQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'paid'"),
        [1]
      );
    });

    it('records partial payment without marking paid', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, amount: 200, status: 'pending', total_paid: 0 }]]) // FOR UPDATE lock
        .mockResolvedValueOnce([{ insertId: 11 }]); // INSERT payment

      const result = await service.recordPayment(1, 50, 'etransfer');

      expect(result.totalPaid).toBe(50);
      expect(mockConn.commit).toHaveBeenCalled();
      // FOR UPDATE + INSERT = 2 queries, no UPDATE to paid
      expect(mockConnQuery).toHaveBeenCalledTimes(2);
    });

    it('writes the audit entry inside the transaction, before commit', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, amount: 200, status: 'pending', total_paid: 0 }]]) // FOR UPDATE lock
        .mockResolvedValueOnce([{ insertId: 12 }]) // INSERT payment
        .mockResolvedValueOnce([{}]);               // INSERT audit_logs

      await service.recordPayment(1, 50, 'cheque', 'REF-9', undefined, { userId: 4, ipAddress: '10.0.0.1' });

      const [sql, params] = mockConnQuery.mock.calls[2];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toEqual([4, null, 'record_payment', 'payment', 12,
        JSON.stringify({ invoiceId: 1, amount: 50, paymentMethod: 'cheque', reference: 'REF-9' }), '10.0.0.1']);
      expect(mockConnQuery.mock.invocationCallOrder[2]).toBeLessThan(mockConn.commit.mock.invocationCallOrder[0]);
    });

    it('writes no audit entry when the payment is refused', async () => {
      mockConnQuery.mockResolvedValueOnce([[{ id: 1, amount: 100, status: 'pending', total_paid: 100 }]]);

      await expect(service.recordPayment(1, 50, 'cheque', undefined, undefined, { userId: 4 }))
        .rejects.toThrow('already fully paid');
      expect(mockConnQuery.mock.calls.some(([sql]) => String(sql).includes('audit_logs'))).toBe(false);
    });

    it('throws on zero amount', async () => {
      await expect(service.recordPayment(1, 0, 'cheque'))
        .rejects.toThrow('Valid payment amount is required');
    });

    it('throws when invoice not found', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]); // FOR UPDATE returns empty

      await expect(service.recordPayment(999, 50, 'cheque'))
        .rejects.toThrow('Invoice not found');
    });

    it('rejects overpayment', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, amount: 100, status: 'pending', total_paid: 80 }]]); // FOR UPDATE

      await expect(service.recordPayment(1, 50, 'cheque'))
        .rejects.toThrow('exceeds remaining balance');
      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('rejects payment on fully paid invoice', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, amount: 100, status: 'paid', total_paid: 100 }]]); // FOR UPDATE

      await expect(service.recordPayment(1, 10, 'cheque'))
        .rejects.toThrow('already fully paid');
      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('rolls back on error', async () => {
      mockConnQuery.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.recordPayment(1, 50, 'cheque'))
        .rejects.toThrow('DB error');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });
});
