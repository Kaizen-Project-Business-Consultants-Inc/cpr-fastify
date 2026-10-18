import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { emailService } from './EmailService.js';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface ResetTarget {
  id: number;
  username: string;
  email: string | null;
  status: string;
}

/** Whether the account can be sent a reset link at all. */
export const canReceiveReset = (user: ResetTarget) =>
  !!user.email && user.status !== 'inactive' && user.status !== 'deleted';

/**
 * Email a one-hour password reset link (the same one "Forgot password" sends).
 * Earlier unused links for the user stop working. Only a hash of the token is stored.
 * Returns false when the email could not be sent; the link is still valid.
 */
export async function sendPasswordResetLink(user: ResetTarget): Promise<boolean> {
  const pool = getPool();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
  await pool.query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hashToken(token), expiresAt]
  );
  const resetLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  try {
    return await emailService.sendPasswordResetEmail(user.email!, user.username, resetLink);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to send password reset email');
    return false;
  }
}
