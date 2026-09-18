import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { HRService, HRError } from '../services/HRService.js';
import { ProfileChangeRepository } from '../repositories/ProfileChangeRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { OrganizationService } from '../services/OrganizationService.js';
import { requireRole } from '../plugins/auth.js';

const approveChangeSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().optional(),
});

const processPaymentSchema = z.object({
  action: z.enum(['override_approve', 'final_reject']),
  notes: z.string().min(1, 'Notes are required'),
});

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof HRError) return reply.status(err.statusCode).send({ error: err.message });
  throw err;
}

export async function hrRoutes(app: FastifyInstance) {
  const hrService = new HRService(new ProfileChangeRepository(), new UserRepository());
  const orgService = new OrganizationService(new OrganizationRepository());
  const hrRole = [requireRole('hr')];

  // ===== Dashboard =====
  app.get('/dashboard', { preHandler: hrRole }, async () => {
    return { success: true, data: await hrService.getDashboardStats() };
  });

  // ===== Instructor listing =====
  app.get('/instructors', { preHandler: hrRole }, async (request) => {
    const { page = '1', limit = '10', search = '' } = request.query as Record<string, string>;
    return { success: true, data: await hrService.getInstructors({ search, page: parseInt(page), limit: parseInt(limit) }) };
  });

  // ===== Organization listing =====
  app.get('/organizations', { preHandler: hrRole }, async (request) => {
    const { page = '1', limit = '10', search = '' } = request.query as Record<string, string>;
    const { rows, total } = await orgService.listOrganizations({ search, page: parseInt(page), limit: parseInt(limit) });
    return {
      success: true,
      data: {
        organizations: rows,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
      },
    };
  });

  // ===== Pending profile changes =====
  app.get('/profile-changes', { preHandler: hrRole }, async (request) => {
    const { page = '1', limit = '10' } = request.query as Record<string, string>;
    return { success: true, data: await hrService.getPendingChanges({ page: parseInt(page), limit: parseInt(limit) }) };
  });

  // ===== Approve/reject profile change =====
  app.post('/profile-changes/:changeId/approve', { preHandler: hrRole }, async (request, reply) => {
    const { changeId } = request.params as { changeId: string };
    const { action, comment } = approveChangeSchema.parse(request.body);
    try {
      const result = await hrService.approveOrRejectChange(parseInt(changeId), action, comment);
      return { success: true, message: result.message };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== User profile detail =====
  app.get('/user/:userId', { preHandler: hrRole }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      return { success: true, data: await hrService.getUserProfile(parseInt(userId)) };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Returned payment requests =====
  app.get('/returned-payment-requests', { preHandler: hrRole }, async (request) => {
    const { page = '1', limit = '10' } = request.query as Record<string, string>;
    return { success: true, data: await hrService.getReturnedPaymentRequests({ page: parseInt(page), limit: parseInt(limit) }) };
  });

  app.post('/returned-payment-requests/:requestId/process', { preHandler: hrRole }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const { action, notes } = processPaymentSchema.parse(request.body);
    try {
      const result = await hrService.processReturnedPaymentRequest(parseInt(requestId), action, notes);
      return { success: true, message: result.message };
    } catch (err) { return handleError(err, reply); }
  });
}
