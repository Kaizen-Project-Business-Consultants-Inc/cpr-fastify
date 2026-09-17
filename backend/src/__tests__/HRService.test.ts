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
import { ProfileChangeRepository } from '../repositories/ProfileChangeRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';

describe('HRService', () => {
  let service: HRService;
  let profileChangeRepo: ProfileChangeRepository;
  let userRepo: UserRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    profileChangeRepo = {
      findById: vi.fn(),
      findByUserId: vi.fn(),
      findPendingForField: vi.fn(),
      findPendingWithUsers: vi.fn(),
      findRecentWithUsers: vi.fn(),
      findAllPendingWithUsers: vi.fn(),
      create: vi.fn(),
    } as unknown as ProfileChangeRepository;

    userRepo = {} as unknown as UserRepository;

    service = new HRService(profileChangeRepo, userRepo);
  });

  describe('approveOrRejectChange', () => {
    it('approves a pending change and updates user field', async () => {
      const change = { id: 1, user_id: 5, field_name: 'email', new_value: 'new@test.com', status: 'pending' };
      mockConnQuery
        .mockResolvedValueOnce([[change]])  // SELECT profile_changes
        .mockResolvedValueOnce([{}])        // UPDATE profile_changes
        .mockResolvedValueOnce([{}]);       // UPDATE users

      const result = await service.approveOrRejectChange(1, 'approve', 'Looks good');

      expect(result.message).toContain('approved');
      expect(mockConn.commit).toHaveBeenCalled();
      // Verify user field was updated with safe column
      expect(mockConnQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET `email`'),
        ['new@test.com', 5]
      );
    });

    it('rejects a pending change without updating user', async () => {
      const change = { id: 2, user_id: 5, field_name: 'phone', new_value: '555-1234', status: 'pending' };
      mockConnQuery
        .mockResolvedValueOnce([[change]])
        .mockResolvedValueOnce([{}]);

      const result = await service.approveOrRejectChange(2, 'reject', 'Not valid');

      expect(result.message).toContain('rejected');
      expect(mockConn.commit).toHaveBeenCalled();
      // Only 2 queries (SELECT + UPDATE profile_changes), no user UPDATE
      expect(mockConnQuery).toHaveBeenCalledTimes(2);
    });

    it('throws when change not found', async () => {
      mockConnQuery.mockResolvedValueOnce([[]]);

      await expect(service.approveOrRejectChange(999, 'approve'))
        .rejects.toThrow('Profile change not found or already processed');
    });

    it('blocks approval of unsafe field names', async () => {
      const change = { id: 3, user_id: 5, field_name: 'password_hash', new_value: 'hacked', status: 'pending' };
      mockConnQuery.mockResolvedValueOnce([[change]]).mockResolvedValueOnce([{}]);

      await expect(service.approveOrRejectChange(3, 'approve'))
        .rejects.toThrow("Field 'password_hash' is not permitted");
      expect(mockConn.rollback).toHaveBeenCalled();
    });

    it('rolls back on error', async () => {
      mockConnQuery.mockRejectedValueOnce(new Error('DB fail'));

      await expect(service.approveOrRejectChange(1, 'approve'))
        .rejects.toThrow('DB fail');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });

  describe('submitProfileChange', () => {
    it('creates a profile change for allowed field', async () => {
      vi.mocked(profileChangeRepo.findPendingForField).mockResolvedValue(null);
      vi.mocked(profileChangeRepo.create).mockResolvedValue(10);
      vi.mocked(profileChangeRepo.findById).mockResolvedValue({
        id: 10, user_id: 1, field_name: 'email', new_value: 'new@test.com', status: 'pending',
      } as any);

      const result = await service.submitProfileChange(1, 'instructor', {
        fieldName: 'email', newValue: 'new@test.com', changeType: 'instructor',
      });

      expect(result.id).toBe(10);
      expect(profileChangeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 1,
        field_name: 'email',
        new_value: 'new@test.com',
      }));
    });

    it('rejects disallowed field names', async () => {
      await expect(service.submitProfileChange(1, 'instructor', {
        fieldName: 'role', newValue: 'admin', changeType: 'instructor',
      })).rejects.toThrow("Field 'role' is not permitted");
    });

    it('rejects SQL-injection-style field names', async () => {
      await expect(service.submitProfileChange(1, 'instructor', {
        fieldName: "email; DROP TABLE users--", newValue: 'x', changeType: 'instructor',
      })).rejects.toThrow('is not permitted');
    });

    it('rejects invalid change types', async () => {
      await expect(service.submitProfileChange(1, 'instructor', {
        fieldName: 'email', newValue: 'x', changeType: 'admin',
      })).rejects.toThrow('change_type must be');
    });

    it('prevents duplicate pending changes', async () => {
      vi.mocked(profileChangeRepo.findPendingForField).mockResolvedValue({ id: 5 } as any);

      await expect(service.submitProfileChange(1, 'instructor', {
        fieldName: 'email', newValue: 'new@test.com', changeType: 'instructor',
      })).rejects.toThrow('A pending change request already exists');
    });

    it('requires targetUserId for HR users', async () => {
      await expect(service.submitProfileChange(1, 'hr', {
        fieldName: 'email', newValue: 'new@test.com', changeType: 'instructor',
      })).rejects.toThrow('HR users must specify target_user_id');
    });

    it('allows HR to submit changes for other users', async () => {
      vi.mocked(profileChangeRepo.findPendingForField).mockResolvedValue(null);
      vi.mocked(profileChangeRepo.create).mockResolvedValue(11);
      vi.mocked(profileChangeRepo.findById).mockResolvedValue({ id: 11, user_id: 99 } as any);

      await service.submitProfileChange(1, 'hr', {
        fieldName: 'phone', newValue: '555-9999', changeType: 'instructor', targetUserId: 99,
      });

      expect(profileChangeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 99,
      }));
    });
  });
});
