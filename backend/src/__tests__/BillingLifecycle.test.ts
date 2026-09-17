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

vi.mock('../services/InvoiceNumberService.js', () => ({
  InvoiceNumberService: vi.fn().mockImplementation(() => ({
    allocate: vi.fn().mockResolvedValue(`INV-${new Date().getFullYear()}-000001`),
  })),
}));

import { BillingService} from '../services/BillingService.js';
import { InvoiceRepository } from '../repositories/InvoiceRepository.js';
import { CoursePricingRepository } from '../repositories/CoursePricingRepository.js';

describe('BillingLifecycle (T-3)', () => {
  let service: BillingService;
  let invoiceRepo: InvoiceRepository;
  let pricingRepo: CoursePricingRepository;

  const makeCourseRow = (overrides: Record<string, unknown> = {}) => ({
    id: 10,
    organization_id: 1,
    completed_at: '2026-06-10',
    location: '123 Main St',
    organization_name: 'Test Org',
    contact_email: 'billing@test.org',
    course_type_name: 'CPR Level C',
    students_attended: 5,
    price_per_student: 80,
    instructor_name: 'Jane Doe',
    ...overrides,
  });

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

  // =========================================================
  // createInvoice — the revenue-critical path
  // =========================================================
  describe('createInvoice', () => {
    it('calculates baseCost, taxAmount, totalAmount correctly', async () => {
      const course = makeCourseRow(); // 5 students x $80 = $400 base, $52 tax, $452 total
      mockConnQuery.mockResolvedValueOnce([[course]]); // SELECT course
      mockConnQuery.mockResolvedValueOnce([{ insertId: 100 }]); // INSERT invoice
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE course_requests
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 100, amount: 452 } as any);

      const result = await service.createInvoice(10);

      expect(result.id).toBe(100);
      expect(mockConn.beginTransaction).toHaveBeenCalled();
      expect(mockConn.commit).toHaveBeenCalled();

      // Verify the INSERT was called with correct calculated values
      const insertCall = mockConnQuery.mock.calls[1];
      const insertParams = insertCall[1];
      // totalAmount = 5 * 80 * 1.13 = 452
      expect(insertParams[3]).toBeCloseTo(452, 2); // totalAmount
      // baseCost = 5 * 80 = 400
      expect(insertParams[4]).toBeCloseTo(400, 2); // baseCost
      // taxAmount = 400 * 0.13 = 52
      expect(insertParams[5]).toBeCloseTo(52, 2); // taxAmount
      // students_billed
      expect(insertParams[6]).toBe(5);
      // rate_per_student (index 11: invoiceNumber, org_id, courseId, total, base, tax, students, dueDays, typeName, location, completedAt, rate)
      expect(insertParams[11]).toBe(80);
    });

    it('generates invoice number via InvoiceNumberService', async () => {
      const course = makeCourseRow();
      mockConnQuery.mockResolvedValueOnce([[course]]);
      mockConnQuery.mockResolvedValueOnce([{ insertId: 101 }]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 101 } as any);

      await service.createInvoice(10);

      const insertParams = mockConnQuery.mock.calls[1][1];
      const invoiceNumber = insertParams[0] as string;
      expect(invoiceNumber).toBe(`INV-${new Date().getFullYear()}-000001`);
    });

    it('marks course_requests.invoiced = TRUE after invoice creation', async () => {
      const course = makeCourseRow();
      mockConnQuery.mockResolvedValueOnce([[course]]);
      mockConnQuery.mockResolvedValueOnce([{ insertId: 102 }]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 102 } as any);

      await service.createInvoice(10);

      // Third query should be the UPDATE course_requests
      const updateCall = mockConnQuery.mock.calls[2];
      expect(updateCall[0]).toContain('invoiced = TRUE');
      expect(updateCall[1]).toEqual([10]);
    });

    it('throws 404 when course not found or not ready for billing', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]); // empty result

      await expect(service.createInvoice(999))
        .rejects.toThrow('Course not found, not ready for billing, or pricing not configured');

      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('throws 422 when organization has no contact email', async () => {
      const course = makeCourseRow({ contact_email: null });
      mockConnQuery.mockResolvedValueOnce([[course]]);

      await expect(service.createInvoice(10))
        .rejects.toThrow('Organization has no billing contact email');

      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('throws when courseId is falsy', async () => {
      await expect(service.createInvoice(0))
        .rejects.toThrow('Course ID is required');
    });

    it('handles zero students (baseCost = 0)', async () => {
      const course = makeCourseRow({ students_attended: 0 });
      mockConnQuery.mockResolvedValueOnce([[course]]);
      mockConnQuery.mockResolvedValueOnce([{ insertId: 103 }]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 103 } as any);

      await service.createInvoice(10);

      const insertParams = mockConnQuery.mock.calls[1][1];
      expect(insertParams[3]).toBe(0); // totalAmount
      expect(insertParams[4]).toBe(0); // baseCost
      expect(insertParams[5]).toBe(0); // taxAmount
    });

    it('rolls back transaction on INSERT failure', async () => {
      const course = makeCourseRow();
      mockConnQuery.mockResolvedValueOnce([[course]]);
      mockConnQuery.mockRejectedValueOnce(new Error('Duplicate entry'));

      await expect(service.createInvoice(10)).rejects.toThrow('Duplicate entry');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });

    it('sets due_date to 30 days from creation', async () => {
      const course = makeCourseRow();
      mockConnQuery.mockResolvedValueOnce([[course]]);
      mockConnQuery.mockResolvedValueOnce([{ insertId: 104 }]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 104 } as any);

      await service.createInvoice(10);

      const insertParams = mockConnQuery.mock.calls[1][1];
      expect(insertParams[7]).toBe(30); // INVOICE_DUE_DAYS
    });
  });

  // =========================================================
  // postToOrg — makes invoice visible + archives course
  // =========================================================
  describe('postToOrg', () => {
    it('posts invoice and archives completed course', async () => {
      const invoice = { id: 1, course_request_id: 10, posted_to_org: false, organization_name: 'Test Org' };
      mockConnQuery.mockResolvedValueOnce([[invoice]]); // SELECT invoice
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE invoices posted_to_org
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE course_requests archived
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 1, posted_to_org: true } as any);

      const result = await service.postToOrg(1, 42);

      expect(result.posted_to_org).toBe(true);
      expect(mockConn.commit).toHaveBeenCalled();

      // Verify invoice update
      const updateInvoice = mockConnQuery.mock.calls[1];
      expect(updateInvoice[0]).toContain('posted_to_org = TRUE');

      // Verify course archive
      const archiveCourse = mockConnQuery.mock.calls[2];
      expect(archiveCourse[0]).toContain('archived = TRUE');
      expect(archiveCourse[0]).toContain("status = 'completed'");
      expect(archiveCourse[1]).toContain(42); // archived_by = postedBy
      expect(archiveCourse[1]).toContain(10); // course_request_id
    });

    it('throws 404 when invoice already posted', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]); // empty — already posted or not found

      await expect(service.postToOrg(1, 42))
        .rejects.toThrow('Invoice not found or already posted');
      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('skips course archive when no course_request_id', async () => {
      const invoice = { id: 2, course_request_id: null, posted_to_org: false };
      mockConnQuery.mockResolvedValueOnce([[invoice]]);
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE invoices only
      vi.mocked(invoiceRepo.findById).mockResolvedValue({ id: 2, posted_to_org: true } as any);

      await service.postToOrg(2, 42);

      // Only 2 queries: SELECT + UPDATE invoices (no course archive)
      expect(mockConnQuery).toHaveBeenCalledTimes(2);
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('rolls back on error', async () => {
      const invoice = { id: 3, course_request_id: 10, posted_to_org: false };
      mockConnQuery.mockResolvedValueOnce([[invoice]]);
      mockConnQuery.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.postToOrg(3, 42)).rejects.toThrow('DB error');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });

  // =========================================================
  // fixCalculations — recalculate from current pricing
  // =========================================================
  describe('fixCalculations', () => {
    it('recalculates amount from current pricing', async () => {
      // 10 students x $90/student = $900 base, total = $900 * 1.13 = $1017
      const row = { id: 1, students_billed: 10, amount: 500, price_per_student: 90 };
      mockConnQuery.mockResolvedValueOnce([[row]]); // SELECT
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE

      const result = await service.fixCalculations(1);

      expect(result.oldAmount).toBe(500);
      expect(result.newAmount).toBeCloseTo(1017, 2);
      expect(mockConn.commit).toHaveBeenCalled();

      // Verify UPDATE sets correct amount and rate
      const updateCall = mockConnQuery.mock.calls[1];
      expect(updateCall[1][0]).toBeCloseTo(1017, 2); // new amount
      expect(updateCall[1][1]).toBe(90); // rate_per_student
    });

    it('throws 404 when invoice not found', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]); // empty

      await expect(service.fixCalculations(999))
        .rejects.toThrow('Invoice not found');
      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('throws when no pricing configured', async () => {
      const row = { id: 1, students_billed: 5, amount: 200, price_per_student: null };
      mockConnQuery.mockResolvedValueOnce([[row]]);

      await expect(service.fixCalculations(1))
        .rejects.toThrow('Pricing not found for this invoice');
      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('rolls back on error', async () => {
      const row = { id: 1, students_billed: 5, amount: 200, price_per_student: 80 };
      mockConnQuery.mockResolvedValueOnce([[row]]);
      mockConnQuery.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.fixCalculations(1)).rejects.toThrow('DB error');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });

  // =========================================================
  // updatePricing / deletePricing — coverage gaps
  // =========================================================
  describe('updatePricing', () => {
    it('throws 404 when pricing record not found', async () => {
      vi.mocked(pricingRepo.updatePrice).mockResolvedValue(null as any);

      await expect(service.updatePricing(999, 50))
        .rejects.toThrow('Course pricing record not found');
    });

    it('delegates to pricingRepo on valid input', async () => {
      const pricing = { id: 1, price_per_student: 75 };
      vi.mocked(pricingRepo.updatePrice).mockResolvedValue(pricing as any);

      const result = await service.updatePricing(1, 75);
      expect(result).toEqual(pricing);
      expect(pricingRepo.updatePrice).toHaveBeenCalledWith(1, 75);
    });
  });

  describe('deletePricing', () => {
    it('deletes pricing successfully', async () => {
      vi.mocked(pricingRepo.remove).mockResolvedValue(true);

      await expect(service.deletePricing(1)).resolves.toBeUndefined();
      expect(pricingRepo.remove).toHaveBeenCalledWith(1);
    });

    it('throws 404 when pricing not found', async () => {
      vi.mocked(pricingRepo.remove).mockResolvedValue(false);

      await expect(service.deletePricing(999))
        .rejects.toThrow('Course pricing not found');
    });
  });

  // =========================================================
  // recordPayment — negative amount edge case
  // =========================================================
  describe('recordPayment edge cases', () => {
    it('throws on negative amount', async () => {
      await expect(service.recordPayment(1, -50, 'cheque'))
        .rejects.toThrow('Valid payment amount is required');
    });
  });

  // =========================================================
  // Full lifecycle: create → approve → post → pay
  // =========================================================
  describe('full lifecycle', () => {
    it('invoice flows from creation through approval to payment', async () => {
      // Step 1: Create invoice
      const course = makeCourseRow();
      mockConnQuery.mockResolvedValueOnce([[course]]);
      mockConnQuery.mockResolvedValueOnce([{ insertId: 200 }]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      vi.mocked(invoiceRepo.findById).mockResolvedValueOnce({
        id: 200, amount: 452, approval_status: 'pending', posted_to_org: false,
      } as any);

      const invoice = await service.createInvoice(10);
      expect(invoice.id).toBe(200);
      expect(mockConn.commit).toHaveBeenCalledTimes(1);

      // Step 2: Approve
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce({ id: 200, approval_status: 'pending' } as any)
        .mockResolvedValueOnce({ id: 200, approval_status: 'approved' } as any);
      vi.mocked(invoiceRepo.execute).mockResolvedValue(undefined as any);

      const approved = await service.approve(200, 42);
      expect(approved.approval_status).toBe('approved');

      // Step 3: Post to org
      vi.clearAllMocks();
      mockConnQuery.mockResolvedValueOnce([[{ id: 200, course_request_id: 10, posted_to_org: false }]]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      mockConnQuery.mockResolvedValueOnce([{}]);
      vi.mocked(invoiceRepo.findById).mockResolvedValueOnce({
        id: 200, posted_to_org: true,
      } as any);

      const posted = await service.postToOrg(200, 42);
      expect(posted.posted_to_org).toBe(true);

      // Step 4: Record payment (full)
      vi.clearAllMocks();
      mockConnQuery.mockResolvedValueOnce([[{ id: 200, amount: 452, status: 'pending', total_paid: 0 }]]); // FOR UPDATE lock
      mockConnQuery.mockResolvedValueOnce([{ insertId: 300 }]); // INSERT payment
      mockConnQuery.mockResolvedValueOnce([{}]);                 // UPDATE status=paid

      const payment = await service.recordPayment(200, 452, 'cheque', 'REF-001');
      expect(payment.totalPaid).toBe(452);
      expect(mockConnQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'paid'"),
        [200]
      );
    });

    it('invoice rejection and resubmission flow', async () => {
      // Reject
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce({ id: 1, approval_status: 'pending' } as any)
        .mockResolvedValueOnce({ id: 1, approval_status: 'rejected' } as any);
      vi.mocked(invoiceRepo.execute).mockResolvedValue(undefined as any);

      const rejected = await service.reject(1, 'Incorrect student count', 42);
      expect(rejected.approval_status).toBe('rejected');

      // Resubmit
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce({ id: 1, approval_status: 'rejected' } as any)
        .mockResolvedValueOnce({ id: 1, approval_status: 'pending' } as any);

      const resubmitted = await service.resubmit(1);
      expect(resubmitted.approval_status).toBe('pending');

      // Approve after resubmission
      vi.mocked(invoiceRepo.findById)
        .mockResolvedValueOnce({ id: 1, approval_status: 'pending' } as any)
        .mockResolvedValueOnce({ id: 1, approval_status: 'approved' } as any);

      const approved = await service.approve(1, 42);
      expect(approved.approval_status).toBe('approved');
    });

    it('partial payments accumulate until invoice is fully paid', async () => {
      // First partial payment: $200 of $452
      mockConnQuery.mockResolvedValueOnce([[{ id: 1, amount: 452, status: 'pending', total_paid: 0 }]]); // FOR UPDATE
      mockConnQuery.mockResolvedValueOnce([{ insertId: 50 }]); // INSERT

      const p1 = await service.recordPayment(1, 200, 'etransfer');
      expect(p1.totalPaid).toBe(200);
      // FOR UPDATE + INSERT = 2 queries, no status update to 'paid'
      expect(mockConnQuery).toHaveBeenCalledTimes(2);

      // Second partial payment: $252 — total now $452, fully paid
      vi.clearAllMocks();
      mockConnQuery.mockResolvedValueOnce([[{ id: 1, amount: 452, status: 'pending', total_paid: 200 }]]); // FOR UPDATE
      mockConnQuery.mockResolvedValueOnce([{ insertId: 51 }]); // INSERT
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE status=paid

      const p2 = await service.recordPayment(1, 252, 'etransfer');
      expect(p2.totalPaid).toBe(452);
      expect(mockConnQuery).toHaveBeenCalledTimes(3);
      expect(mockConnQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'paid'"),
        [1]
      );
    });
  });
});
