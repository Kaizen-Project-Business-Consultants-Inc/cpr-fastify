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

import { HRService } from '../services/HRService.js';

describe('HRService', () => {
  let service: HRService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HRService();
  });

  describe('getDashboardStats', () => {
    it('returns the three counts and nothing about profile changes', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: 4 }]])  // active instructors
        .mockResolvedValueOnce([[{ count: 7 }]])  // organizations
        .mockResolvedValueOnce([[{ count: 2 }]]); // expiring certifications

      const stats = await service.getDashboardStats();

      expect(stats).toEqual({ activeInstructors: 4, organizations: 7, expiringCertifications: 2 });
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('profile_changes'))).toBe(false);
    });
  });

  describe('getUserProfile', () => {
    it('returns an instructor with their course history and no profile changes', async () => {
      const courses = [{ id: 1, status: 'completed', courseName: 'CPR-C' }];
      mockQuery
        .mockResolvedValueOnce([[{ id: 4, username: 'pat', role: 'instructor' }]])
        .mockResolvedValueOnce([courses]);

      const result = await service.getUserProfile(4);

      expect(result).toEqual({ user: { id: 4, username: 'pat', role: 'instructor' }, courseHistory: courses });
    });

    it('skips course history for non-instructors', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 8, username: 'org', role: 'organization' }]]);

      const result = await service.getUserProfile(8);

      expect(result.courseHistory).toEqual([]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('throws 404 when the user does not exist', async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      await expect(service.getUserProfile(999)).rejects.toMatchObject({ message: 'User not found', statusCode: 404 });
    });
  });

  describe('processReturnedPaymentRequest', () => {
    it('requires notes', async () => {
      await expect(service.processReturnedPaymentRequest(1, 'final_reject', '  '))
        .rejects.toThrow('Notes are required');
      expect(mockConn.beginTransaction).not.toHaveBeenCalled();
    });

    it('override-approves and completes the matching payroll payment', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, instructor_id: 5, amount: 200 }]]) // SELECT payment_requests
        .mockResolvedValueOnce([{}])                                       // UPDATE payment_requests
        .mockResolvedValueOnce([[{ id: 77 }]])                             // SELECT payroll_payments
        .mockResolvedValueOnce([{}]);                                      // UPDATE payroll_payments

      const result = await service.processReturnedPaymentRequest(1, 'override_approve', 'Checked');

      expect(result.message).toContain('approved by HR override');
      expect(mockConnQuery).toHaveBeenCalledWith(expect.stringContaining('FROM payroll_payments'), [5, 200]);
      const update = mockConnQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE payroll_payments'))!;
      // No subquery on the table being updated (MariaDB error 1093).
      expect(update[0]).not.toContain('SELECT');
      expect(update[1]).toEqual([77]);
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('override-approves without a payroll update when no pending payment matches', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 1, instructor_id: 5, amount: 200 }]])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([[]]);

      await service.processReturnedPaymentRequest(1, 'override_approve', 'Checked');

      expect(mockConnQuery).toHaveBeenCalledTimes(3);
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('final-rejects without touching payroll', async () => {
      mockConnQuery
        .mockResolvedValueOnce([[{ id: 2, instructor_id: 5, amount: 200 }]])
        .mockResolvedValueOnce([{}]);

      const result = await service.processReturnedPaymentRequest(2, 'final_reject', 'Duplicate');

      expect(result.message).toContain('finally rejected');
      expect(mockConnQuery).toHaveBeenCalledTimes(2);
    });

    it('rolls back when the request is not found', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]);

      await expect(service.processReturnedPaymentRequest(999, 'final_reject', 'x'))
        .rejects.toThrow('Returned payment request not found');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });
});
