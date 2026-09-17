import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService, AuthError } from '../services/AuthService.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { requireAuth } from '../plugins/auth.js';
import { getPool } from '../config/database.js';
import { logAudit } from '../utils/auditLog.js';
import { env } from '../config/env.js';
import { emailService } from '../services/EmailService.js';
import { logger } from '../config/logger.js';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

const forgotPasswordSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(1).optional(),
}).refine((d) => d.email || d.username, { message: 'Email or username is required' });

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  // Frontend pages send either `newPassword` or `password`; accept both.
  newPassword: z.string().min(8).optional(),
  password: z.string().min(8).optional(),
}).refine((d) => d.newPassword || d.password, { message: 'Password is required' });

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

/** Enrich a safe user object with organization_name and location_name from DB */
async function enrichUser(safeUser: Record<string, unknown>) {
  try {
    const pool = getPool();
    if (safeUser.organization_id) {
      const [orgRows] = await pool.query<any[]>(
        'SELECT name FROM organizations WHERE id = ?', [safeUser.organization_id]
      );
      if (orgRows.length) safeUser.organization_name = orgRows[0].name;
    }
    if (safeUser.location_id) {
      const [locRows] = await pool.query<any[]>(
        'SELECT location_name FROM organization_locations WHERE id = ?', [safeUser.location_id]
      );
      if (locRows.length) safeUser.location_name = locRows[0].location_name;
    }
  } catch {
    // Non-critical enrichment — don't break login if org/location lookup fails
  }
  return safeUser;
}

export async function authRoutes(app: FastifyInstance) {
  const userRepo = new UserRepository();
  const authService = new AuthService(userRepo);

  // Stricter rate limit for auth endpoints (10 req/min vs global 100)
  const authRateLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  // POST /api/v1/auth/login
  app.post('/login', authRateLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    try {
      const result = await authService.login(body.username, body.password);

      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/v1/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      });

      const enrichedUser = await enrichUser(result.user as Record<string, unknown>);
      logAudit({ userId: result.user.id, username: body.username, action: 'login', ipAddress: request.ip });
      return { success: true, data: { user: enrichedUser, accessToken: result.tokens.accessToken } };
    } catch (err) {
      if (err instanceof AuthError) {
        logAudit({ username: body.username, action: 'login_failed', details: { reason: err.message }, ipAddress: request.ip });
        return reply.status(401).send({ error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/refresh
  app.post('/refresh', authRateLimit, async (request, reply) => {
    const token = request.cookies.refreshToken;
    if (!token) return reply.status(401).send({ error: 'No refresh token' });

    try {
      const tokens = await authService.refreshToken(token);

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/v1/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      });

      return { success: true, data: { accessToken: tokens.accessToken } };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(401).send({ error: err.message });
      }
      throw err;
    }
  });

  // GET /api/v1/auth/me — verify current session
  app.get('/me', { preHandler: [requireAuth] }, async (request) => {
    const user = await userRepo.findById(request.userId!);
    if (!user) return { success: false, error: { message: 'User not found' } };
    const { password_hash: _password_hash, ...safeUser } = user;
    const enrichedUser = await enrichUser(safeUser as Record<string, unknown>);
    return { success: true, data: { user: enrichedUser } };
  });

  // POST /api/v1/auth/logout
  app.post('/logout', async (request, reply) => {
    logAudit({ userId: request.userId ?? undefined, action: 'logout', ipAddress: request.ip });
    reply.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
    return { success: true, data: { message: 'Logged out' } };
  });

  // POST /api/v1/auth/forgot-password — request a reset link by email or username.
  // Always returns 200 with the same message so account existence is not revealed.
  const GENERIC_MESSAGE = 'If an account matches, a password reset link has been sent to the email on file.';
  async function handleForgotPassword(request: any, reply: any) {
    const body = forgotPasswordSchema.parse(request.body);
    const pool = getPool();

    const [rows] = await pool.query<any[]>(
      `SELECT id, username, email, status FROM users
       WHERE ${body.email ? 'email = ?' : 'username = ?'} LIMIT 1`,
      [body.email ?? body.username]
    );
    const user = rows[0];

    if (user && user.email && user.status !== 'inactive' && user.status !== 'deleted') {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      // Invalidate any outstanding tokens for this user, then store the new one (hashed).
      await pool.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
      await pool.query(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, hashToken(token), expiresAt]
      );
      const resetLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      try {
        await emailService.sendPasswordResetEmail(user.email, user.username, resetLink);
      } catch (err) {
        logger.error({ err, userId: user.id }, 'Failed to send password reset email');
      }
      logAudit({ userId: user.id, username: user.username, action: 'password_reset_requested', ipAddress: request.ip });
    } else {
      logAudit({ username: body.username ?? body.email, action: 'password_reset_requested_unknown', ipAddress: request.ip });
    }

    return reply.send({ success: true, message: GENERIC_MESSAGE });
  }
  app.post('/forgot-password', authRateLimit, handleForgotPassword);
  // Alias used by the /recover-password page
  app.post('/recover-password', authRateLimit, handleForgotPassword);

  // POST /api/v1/auth/reset-password — consume a reset token and set a new password
  app.post('/reset-password', authRateLimit, async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const newPassword = (body.newPassword ?? body.password)!;
    const pool = getPool();

    const [rows] = await pool.query<any[]>(
      `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.username
       FROM password_resets pr JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = ? LIMIT 1`,
      [hashToken(body.token)]
    );
    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return reply.status(400).send({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    const hash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hash, row.user_id]);
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
    // Sign out every existing session for this user
    await authService.invalidateUserTokens(row.user_id);

    logAudit({ userId: row.user_id, username: row.username, action: 'password_reset_completed', entityType: 'user', entityId: row.user_id, ipAddress: request.ip });
    return { success: true, message: 'Your password has been reset. You can now sign in with your new password.' };
  });

  // POST /api/v1/auth/change-password (authenticated)
  app.post('/change-password', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.userId!;
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' });

    const body = changePasswordSchema.parse(request.body);

    try {
      await authService.changePassword(userId, body.currentPassword, body.newPassword);
      logAudit({ userId, action: 'change_password', entityType: 'user', entityId: userId, ipAddress: request.ip });
      return { message: 'Password changed' };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
