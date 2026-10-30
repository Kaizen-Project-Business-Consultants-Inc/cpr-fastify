import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AuthService } from '../services/AuthService.js';
import { UserRepository } from '../repositories/UserRepository.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
    userRole: string;
    userOrgId: number | null;
  }
}

const authService = new AuthService(new UserRepository());

async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('userId', 0);
  app.decorateRequest('userRole', '');
  app.decorateRequest('userOrgId', null);
}

export default fp(authPlugin);

// Use as a preHandler on protected routes:
// app.get('/protected', { preHandler: [requireAuth] }, handler)
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing authorization token' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = authService.verifyAccessToken(token);
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  try {
    // Check token blacklist (password change invalidation — DB-backed)
    if (payload.iat && await authService.isTokenBlacklisted(payload.userId, payload.iat)) {
      return reply.status(401).send({ error: 'Token has been revoked. Please log in again.' });
    }
  } catch {
    // DB error checking blacklist — allow request through rather than blocking all auth
  }

  request.userId = payload.userId;
  request.userRole = payload.role;
  request.userOrgId = payload.orgId ?? null;
}

/** Route guard: signs the request in, then answers 403 unless the user's role is one of `roles`. */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    if (!roles.includes(request.userRole)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}
