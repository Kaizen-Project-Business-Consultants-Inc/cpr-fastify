import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
const mockPoolQuery = vi.fn();
vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockPoolQuery }),
}));

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/env.js', () => ({
  env: {
    JWT_ACCESS_SECRET: 'test-access-secret-key-min-32-chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-key-min-32-chars!!',
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    BCRYPT_SALT_ROUNDS: 4,
  },
}));

vi.mock('../utils/taxConfig.js', () => ({
  getHSTRate: () => 0.13,
  getHSTLabel: () => 'HST (13%)',
}));

import { InvoiceRepository, VERIFIED_PAYMENT_FILTER } from '../repositories/InvoiceRepository.js';

describe('Financial correctness fixes', () => {
  let repo: InvoiceRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new InvoiceRepository();
  });

  describe('VERIFIED_PAYMENT_FILTER constant', () => {
    it('contains verified status and deleted_at IS NULL', () => {
      expect(VERIFIED_PAYMENT_FILTER).toBe("status = 'verified' AND deleted_at IS NULL");
    });
  });

  // =========================================================
  // F1 + F2: findAllWithDetails uses correct payment filter and balance basis
  // =========================================================
  describe('findAllWithDetails — soft-deleted payments excluded (F1)', () => {
    it('SQL includes deleted_at IS NULL in payment subquery', async () => {
      // Return empty result so the query completes
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.findAllWithDetails();

      // The BaseRepository.query calls getPool().query(sql, params)
      const sql: string = mockPoolQuery.mock.calls[0][0];
      // The payment subquery must filter by verified + not deleted
      expect(sql).toContain("status = 'verified' AND deleted_at IS NULL");
    });

    it('balance_due uses i.amount, not base_cost + tax_amount (F2)', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.findAllWithDetails();

      const sql: string = mockPoolQuery.mock.calls[0][0];
      // Should use i.amount - paid, NOT (i.base_cost + i.tax_amount) - paid
      expect(sql).toContain('i.amount - COALESCE(p.total_paid, 0)');
      expect(sql).not.toMatch(/base_cost\s*\+\s*tax_amount.*COALESCE\(p\.total_paid/);
    });
  });

  // =========================================================
  // F1 + F2: findByIdWithDetails uses correct payment filter
  // =========================================================
  describe('findByIdWithDetails — soft-deleted payments excluded (F1)', () => {
    it('SQL includes deleted_at IS NULL in payment subquery', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.findByIdWithDetails(1);

      const sql: string = mockPoolQuery.mock.calls[0][0];
      expect(sql).toContain("status = 'verified' AND deleted_at IS NULL");
    });
  });

  // =========================================================
  // F1/S3: findPendingApproval uses 'verified' not 'completed'
  // =========================================================
  describe('findPendingApproval — correct payment status (F1/S3)', () => {
    it('filters payments by verified status, not completed', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.findPendingApproval();

      const sql: string = mockPoolQuery.mock.calls[0][0];
      expect(sql).toContain("status = 'verified'");
      expect(sql).not.toContain("status = 'completed'");
    });

    it('includes deleted_at IS NULL in payment subquery', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.findPendingApproval();

      const sql: string = mockPoolQuery.mock.calls[0][0];
      expect(sql).toContain('deleted_at IS NULL');
    });

    it('correctly shows amount_paid when payments exist', async () => {
      // Simulate a result row where the payment subquery returns total_paid
      mockPoolQuery.mockResolvedValue([[{
        id: 1,
        invoice_number: 'INV-001',
        amount: 452,
        base_cost: 400,
        tax_amount: 52,
        approval_status: 'pending',
        organization_name: 'Test Org',
        amount_paid: 200,
        balance_due: 252,
      }]]);

      const result = await repo.findPendingApproval();
      const invoices = result as any[];
      expect(invoices[0].amount_paid).toBe(200);
      expect(invoices[0].balance_due).toBe(252);
    });
  });

  // =========================================================
  // Consistent balance_due between list and detail views
  // =========================================================
  describe('balance_due consistency between list and detail (F2)', () => {
    it('both findAllWithDetails and findByIdWithDetails use amount - paid', async () => {
      // Capture SQL from findAllWithDetails
      mockPoolQuery.mockResolvedValue([[]]);
      await repo.findAllWithDetails();
      const listSQL: string = mockPoolQuery.mock.calls[0][0];

      vi.clearAllMocks();

      // Capture SQL from findByIdWithDetails
      mockPoolQuery.mockResolvedValue([[]]);
      await repo.findByIdWithDetails(1);
      const detailSQL: string = mockPoolQuery.mock.calls[0][0];

      // Both should use i.amount as the basis
      expect(listSQL).toContain('i.amount - COALESCE(p.total_paid, 0)');
      expect(detailSQL).toContain('i.amount - COALESCE(p.total_paid, 0)');
    });
  });

  // =========================================================
  // M1: getAgingReport shared method
  // =========================================================
  describe('getAgingReport — shared method (M1)', () => {
    it('uses verified payment filter', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.getAgingReport({ asOfDate: '2026-06-28' });

      const sql: string = mockPoolQuery.mock.calls[0][0];
      expect(sql).toContain("status = 'verified' AND deleted_at IS NULL");
    });

    it('applies postedOnly filter when requested', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.getAgingReport({ asOfDate: '2026-06-28', postedOnly: true });

      const sql: string = mockPoolQuery.mock.calls[0][0];
      expect(sql).toContain('posted_to_org = TRUE');
    });

    it('applies organization filter when provided', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.getAgingReport({ asOfDate: '2026-06-28', organizationId: 5 });

      const sql: string = mockPoolQuery.mock.calls[0][0];
      const params: unknown[] = mockPoolQuery.mock.calls[0][1];
      expect(sql).toContain('i.organization_id = ?');
      expect(params).toContain(5);
    });

    it('uses threshold parameter for balance filter', async () => {
      mockPoolQuery.mockResolvedValue([[]]);

      await repo.getAgingReport({ asOfDate: '2026-06-28', threshold: 0.01 });

      const params: unknown[] = mockPoolQuery.mock.calls[0][1];
      expect(params).toContain(0.01);
    });
  });
});

// =========================================================
// M3: 403 test for org-role on dashboard
// =========================================================
describe('Dashboard authorization (M3)', () => {
  it('organization role gets 403 on /dashboard', async () => {
    // We test the requireRole middleware logic directly since we don't have
    // a full Fastify test harness. The dashboard uses requireRole('accountant', 'admin', 'sysadmin').
    // An 'organization' role should be rejected.
    const { requireRole } = await import('../plugins/auth.js');
    const middleware = requireRole('accountant', 'admin', 'sysadmin');

    const mockReply = {
      sent: false,
      statusCode: 0,
      body: null as unknown,
      status(code: number) { this.statusCode = code; return this; },
      send(body: unknown) { this.sent = true; this.body = body; return this; },
    };

    // Simulate a request with organization role
    // requireAuth will check the token — we need to mock AuthService
    // Instead, we simulate post-auth state by calling the role check part
    const mockRequest = {
      headers: { authorization: 'Bearer fake-token' },
      userId: 1,
      userRole: 'organization',
      userOrgId: 1,
    };

    // Mock AuthService.verifyAccessToken to return org-role payload
    const { AuthService } = await import('../services/AuthService.js');
    vi.spyOn(AuthService.prototype, 'verifyAccessToken').mockReturnValue({
      userId: 1,
      role: 'organization',
      orgId: 1,
    } as any);
    vi.spyOn(AuthService.prototype, 'isTokenBlacklisted').mockResolvedValue(false);

    await middleware(mockRequest as any, mockReply as any);

    expect(mockReply.sent).toBe(true);
    expect(mockReply.statusCode).toBe(403);
    expect(mockReply.body).toEqual({ error: 'Insufficient permissions' });
  }, 15000);
});
