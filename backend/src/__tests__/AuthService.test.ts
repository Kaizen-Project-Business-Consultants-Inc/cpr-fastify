import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database pool before importing AuthService
const mockQuery = vi.fn();
const mockPool = { query: mockQuery };
vi.mock('../config/database.js', () => ({
  getPool: () => mockPool,
}));

// Mock env
vi.mock('../config/env.js', () => ({
  env: {
    JWT_ACCESS_SECRET: 'test-access-secret-key-min-32-chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-key-min-32-chars!!',
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    BCRYPT_SALT_ROUNDS: 4,
  },
}));

import { AuthService, AuthError } from '../services/AuthService.js';
import { UserRepository } from '../repositories/UserRepository.js';
import bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let authService: AuthService;
  let userRepo: UserRepository;

  const mockUser = {
    id: 1,
    username: 'testuser',
    password_hash: '',
    role: 'admin',
    organization_id: null,
    status: 'active',
    email: 'test@example.com',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUser.password_hash = await bcrypt.hash('correctpassword', 4);

    userRepo = {
      findByUsername: vi.fn(),
      findById: vi.fn(),
      updatePassword: vi.fn(),
    } as unknown as UserRepository;

    authService = new AuthService(userRepo);
  });

  describe('login', () => {
    it('returns user and tokens on valid credentials', async () => {
      // No lockout
      mockQuery.mockResolvedValueOnce([[{ cnt: 0 }]]);
      vi.mocked(userRepo.findByUsername).mockResolvedValue(mockUser as any);
      // clearAttempts
      mockQuery.mockResolvedValueOnce([{}]);

      const result = await authService.login('testuser', 'correctpassword');

      expect(result.user).toHaveProperty('username', 'testuser');
      expect(result.user).not.toHaveProperty('password_hash');
      expect(result.tokens.accessToken).toBeTruthy();
      expect(result.tokens.refreshToken).toBeTruthy();
    });

    it('throws AuthError on wrong password', async () => {
      mockQuery.mockResolvedValueOnce([[{ cnt: 0 }]]);
      vi.mocked(userRepo.findByUsername).mockResolvedValue(mockUser as any);
      // recordFailedAttempt
      mockQuery.mockResolvedValueOnce([{}]);

      await expect(authService.login('testuser', 'wrongpassword'))
        .rejects.toThrow(AuthError);
    });

    it('throws AuthError when user not found', async () => {
      mockQuery.mockResolvedValueOnce([[{ cnt: 0 }]]);
      vi.mocked(userRepo.findByUsername).mockResolvedValue(null as any);
      mockQuery.mockResolvedValueOnce([{}]);

      await expect(authService.login('nonexistent', 'password'))
        .rejects.toThrow('Invalid username or password');
    });

    it('throws AuthError when user is inactive', async () => {
      mockQuery.mockResolvedValueOnce([[{ cnt: 0 }]]);
      vi.mocked(userRepo.findByUsername).mockResolvedValue({ ...mockUser, status: 'inactive' } as any);
      mockQuery.mockResolvedValueOnce([{}]);

      await expect(authService.login('testuser', 'correctpassword'))
        .rejects.toThrow('Invalid username or password');
    });

    it('refuses an account whose personal data was erased', async () => {
      mockQuery.mockResolvedValueOnce([[{ cnt: 0 }]]);
      vi.mocked(userRepo.findByUsername).mockResolvedValue({ ...mockUser, status: 'deleted' } as any);
      mockQuery.mockResolvedValueOnce([{}]);

      await expect(authService.login('deleted_7', 'correctpassword'))
        .rejects.toThrow('Invalid username or password');
    });

    it('throws 429 when account is locked out', async () => {
      // 5+ failed attempts in window
      mockQuery.mockResolvedValueOnce([[{ cnt: 5 }]]);
      // Latest attempt was just now
      mockQuery.mockResolvedValueOnce([[{ attempted_at: new Date() }]]);

      try {
        await authService.login('testuser', 'correctpassword');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).statusCode).toBe(429);
        expect((err as AuthError).message).toMatch(/Account temporarily locked/);
      }
    });
  });

  describe('changePassword', () => {
    it('updates password and invalidates tokens', async () => {
      vi.mocked(userRepo.findById).mockResolvedValue(mockUser as any);
      vi.mocked(userRepo.updatePassword).mockResolvedValue(undefined);
      // invalidateUserTokens query
      mockQuery.mockResolvedValueOnce([{}]);

      await authService.changePassword(1, 'correctpassword', 'newpassword123');

      expect(userRepo.updatePassword).toHaveBeenCalledWith(1, expect.any(String));
      // Stamped with the app's clock (the one that sets tokens' "issued at"), not the DB's NOW().
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO token_blacklist'),
        [1, expect.any(Date)]
      );
    });

    it('throws when current password is wrong', async () => {
      vi.mocked(userRepo.findById).mockResolvedValue(mockUser as any);

      await expect(authService.changePassword(1, 'wrongpassword', 'newpassword123'))
        .rejects.toThrow('Current password is incorrect');
    });

    it('throws when user not found', async () => {
      vi.mocked(userRepo.findById).mockResolvedValue(null as any);

      await expect(authService.changePassword(999, 'any', 'newpassword123'))
        .rejects.toThrow('User not found');
    });
  });

  describe('isTokenBlacklisted', () => {
    it('returns false when no blacklist entry exists', async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      const result = await authService.isTokenBlacklisted(1, Math.floor(Date.now() / 1000));
      expect(result).toBe(false);
    });

    it('returns true when token was issued before invalidation', async () => {
      const invalidatedAt = new Date();
      mockQuery.mockResolvedValueOnce([[{ invalidated_at: invalidatedAt }]]);

      // Token issued 10 seconds before invalidation
      const tokenIssuedAt = Math.floor(invalidatedAt.getTime() / 1000) - 10;
      const result = await authService.isTokenBlacklisted(1, tokenIssuedAt);
      expect(result).toBe(true);
    });

    it('returns false when token was issued after invalidation', async () => {
      const invalidatedAt = new Date('2025-01-01T00:00:00Z');
      mockQuery.mockResolvedValueOnce([[{ invalidated_at: invalidatedAt }]]);

      // Token issued well after invalidation
      const tokenIssuedAt = Math.floor(Date.now() / 1000);
      const result = await authService.isTokenBlacklisted(1, tokenIssuedAt);
      expect(result).toBe(false);
    });
  });
});
