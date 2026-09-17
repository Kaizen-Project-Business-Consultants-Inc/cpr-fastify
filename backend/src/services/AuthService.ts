import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getPool } from '../config/database.js';
import { UserRepository, User } from '../repositories/UserRepository.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult {
  user: Omit<User, 'password_hash'>;
  tokens: TokenPair;
}

// Account lockout: 5 failed attempts within 15 minutes = 15-minute lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_DURATION_MINUTES = 15;

export class AuthService {
  constructor(private userRepo: UserRepository) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const key = username.toLowerCase();

    // Check lockout (DB-backed — survives restarts)
    const lockout = await this.checkLockout(key);
    if (lockout) {
      throw new AuthError(`Account temporarily locked. Try again in ${lockout} minute(s).`, 429);
    }

    const user = await this.userRepo.findByUsername(username);
    if (!user || user.status === 'inactive') {
      await this.recordFailedAttempt(key);
      throw new AuthError('Invalid username or password');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await this.recordFailedAttempt(key);
      throw new AuthError('Invalid username or password');
    }

    // Successful login — clear attempts
    await this.clearAttempts(key);

    const tokens = this.generateTokens(user);
    const { password_hash: _password_hash, ...safeUser } = user;

    return { user: safeUser, tokens };
  }

  /** Check if account is locked. Returns minutes remaining, or null if not locked. */
  private async checkLockout(key: string): Promise<number | null> {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) as cnt FROM login_attempts
       WHERE username = ? AND attempted_at > NOW() - INTERVAL ? MINUTE`,
      [key, LOCKOUT_WINDOW_MINUTES]
    );
    const count = Number(rows[0]?.cnt ?? 0);
    if (count < MAX_FAILED_ATTEMPTS) return null;

    // Check when the most recent attempt was (to calculate remaining lockout)
    const [latest] = await pool.query<any[]>(
      `SELECT attempted_at FROM login_attempts
       WHERE username = ? ORDER BY attempted_at DESC LIMIT 1`,
      [key]
    );
    if (latest.length === 0) return null;

    const lockedUntil = new Date(latest[0].attempted_at).getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000;
    const remaining = lockedUntil - Date.now();
    if (remaining <= 0) return null;
    return Math.ceil(remaining / 60000);
  }

  private async recordFailedAttempt(key: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'INSERT INTO login_attempts (username, attempted_at) VALUES (?, NOW())',
      [key]
    );
  }

  private async clearAttempts(key: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM login_attempts WHERE username = ?', [key]);
  }

  async refreshToken(token: string): Promise<TokenPair> {
    try {
      const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
      const user = await this.userRepo.findById(payload.userId);

      if (!user || user.status === 'inactive') {
        throw new AuthError('Invalid refresh token');
      }

      return this.generateTokens(user);
    } catch {
      throw new AuthError('Invalid refresh token');
    }
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError('User not found');

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new AuthError('Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
    await this.userRepo.updatePassword(userId, hash);

    // Invalidate all existing tokens for this user (DB-backed)
    await this.invalidateUserTokens(userId);
  }

  /** Blacklist all tokens issued before now for a user (DB-backed) */
  async invalidateUserTokens(userId: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO token_blacklist (user_id, invalidated_at)
       VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE invalidated_at = NOW()`,
      [userId]
    );
  }

  /** Check if a token was issued before the user's tokens were invalidated (DB-backed) */
  async isTokenBlacklisted(userId: number, tokenIssuedAt: number): Promise<boolean> {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT invalidated_at FROM token_blacklist WHERE user_id = ?',
      [userId]
    );
    if (rows.length === 0) return false;
    const invalidatedAtMs = new Date(rows[0].invalidated_at).getTime();
    // Token issued at (seconds) vs invalidated at (ms)
    return (tokenIssuedAt * 1000) <= invalidatedAtMs;
  }

  verifyAccessToken(token: string): jwt.JwtPayload {
    try {
      return jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    } catch {
      throw new AuthError('Invalid or expired token');
    }
  }

  private generateTokens(user: User): TokenPair {
    const payload = { userId: user.id, role: user.role, orgId: user.organization_id };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
    });

    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.REFRESH_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
    });

    return { accessToken, refreshToken };
  }
}

export class AuthError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}
