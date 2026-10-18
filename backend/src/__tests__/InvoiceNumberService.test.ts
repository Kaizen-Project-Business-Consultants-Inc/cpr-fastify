import { describe, it, expect, vi, beforeEach } from 'vitest';

// allocate() runs inside the caller's transaction, so only the connection is mocked.
const mockConnQuery = vi.fn();
const mockConn = {
  query: mockConnQuery,
};

import { InvoiceNumberService } from '../services/InvoiceNumberService.js';

describe('InvoiceNumberService', () => {
  let service: InvoiceNumberService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InvoiceNumberService();
  });

  describe('allocate', () => {
    it('generates default format when no sequence exists', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]); // no sequence row

      const result = await service.allocate(1, mockConn as any);

      expect(result).toMatch(/^INV-\d{4}-\d{8}$/);
    });

    it('formats number using org sequence', async () => {
      const seq = {
        id: 1,
        organization_id: 1,
        prefix: 'ACME',
        format_string: '{PREFIX}-{YYYY}-{NNNN}',
        padding: 4,
        next_number: 42,
        step: 1,
        reset_policy: 'none',
        last_reset_period: null,
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]); // SELECT FOR UPDATE
      mockConnQuery.mockResolvedValueOnce([{}]);     // UPDATE next_number

      const result = await service.allocate(1, mockConn as any);

      const year = new Date().getFullYear();
      expect(result).toBe(`ACME-${year}-0042`);
    });

    it('increments next_number by step', async () => {
      const seq = {
        id: 5, organization_id: 2, prefix: 'ORG2',
        format_string: '{PREFIX}-{NNNN}', padding: 4,
        next_number: 10, step: 5,
        reset_policy: 'none', last_reset_period: null,
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]);

      const result = await service.allocate(2, mockConn as any);

      expect(result).toBe('ORG2-0010');
      // Should increment by step
      expect(mockConnQuery.mock.calls[1][0]).toContain('next_number + step');
    });

    it('resets counter on yearly period change', async () => {
      const year = new Date().getFullYear();
      const seq = {
        id: 1, organization_id: 1, prefix: 'INV',
        format_string: '{PREFIX}-{YYYY}-{NNNN}', padding: 4,
        next_number: 500, step: 1,
        reset_policy: 'yearly', last_reset_period: String(year - 1), // last year
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]); // UPDATE with reset

      const result = await service.allocate(1, mockConn as any);

      // Should reset to 1
      expect(result).toBe(`INV-${year}-0001`);
      // UPDATE should set next_number to 2 (1 + step) and new period
      const updateCall = mockConnQuery.mock.calls[1];
      expect(updateCall[1][0]).toBe(2); // next = 1 + step(1)
      expect(updateCall[1][1]).toBe(String(year)); // current period
    });

    it('resets counter on monthly period change', async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const seq = {
        id: 1, organization_id: 1, prefix: 'M',
        format_string: '{PREFIX}-{YYYY}{MM}-{NNN}', padding: 3,
        next_number: 99, step: 1,
        reset_policy: 'monthly', last_reset_period: '2025-01', // old period
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]);

      const result = await service.allocate(1, mockConn as any);

      expect(result).toBe(`M-${year}${month}-001`);
    });

    it('does not reset when period is same', async () => {
      const year = new Date().getFullYear();
      const seq = {
        id: 1, organization_id: 1, prefix: 'INV',
        format_string: '{PREFIX}-{YYYY}-{NNNN}', padding: 4,
        next_number: 50, step: 1,
        reset_policy: 'yearly', last_reset_period: String(year), // same year
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]);

      const result = await service.allocate(1, mockConn as any);

      expect(result).toBe(`INV-${year}-0050`);
      // Should use normal increment, not reset
      expect(mockConnQuery.mock.calls[1][0]).toContain('next_number + step');
    });
  });

  describe('format tokens', () => {
    it('supports {YY} short year', async () => {
      const year = String(new Date().getFullYear()).slice(-2);
      const seq = {
        id: 1, organization_id: 1, prefix: 'X',
        format_string: '{PREFIX}-{YY}-{NN}', padding: 2,
        next_number: 7, step: 1,
        reset_policy: 'none', last_reset_period: null,
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]);

      const result = await service.allocate(1, mockConn as any);

      expect(result).toBe(`X-${year}-07`);
    });

    it('supports {DD} day token', async () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const seq = {
        id: 1, organization_id: 1, prefix: 'D',
        format_string: '{PREFIX}-{MM}{DD}-{NNNNN}', padding: 5,
        next_number: 1, step: 1,
        reset_policy: 'none', last_reset_period: null,
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]);

      const result = await service.allocate(1, mockConn as any);

      expect(result).toBe(`D-${month}${day}-00001`);
    });

    it('padding is determined by number of Ns in token', async () => {
      const seq = {
        id: 1, organization_id: 1, prefix: 'P',
        format_string: '{PREFIX}-{NNNNNNNN}', padding: 4, // padding column ignored, 8 Ns used
        next_number: 3, step: 1,
        reset_policy: 'none', last_reset_period: null,
      };
      mockConnQuery.mockResolvedValueOnce([[seq]]);
      mockConnQuery.mockResolvedValueOnce([{}]);

      const result = await service.allocate(1, mockConn as any);

      expect(result).toBe('P-00000003'); // 8 digits from 8 Ns
    });
  });
});
