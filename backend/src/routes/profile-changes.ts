import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { HRService, HRError } from '../services/HRService.js';
import { ProfileChangeRepository } from '../repositories/ProfileChangeRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { requireAuth } from '../plugins/auth.js';
import { isPaginated, parsePagination, paginatedResponse } from '../utils/pagination.js';

const submitChangeSchema = z.object({
  field_name: z.string().min(1),
  new_value: z.string().min(1),
  change_type: z.enum(['instructor', 'organization']),
  target_user_id: z.number().int().positive().optional(),
});

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof HRError) return reply.status(err.statusCode).send({ error: err.message });
  throw err;
}

export async function profileChangeRoutes(app: FastifyInstance) {
  const repo = new ProfileChangeRepository();
  const service = new HRService(repo, new UserRepository());

  // Submit a profile change request (any authenticated user)
  app.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const data = submitChangeSchema.parse(request.body);
    try {
      const change = await service.submitProfileChange(request.userId, request.userRole, {
        fieldName: data.field_name,
        newValue: data.new_value,
        changeType: data.change_type,
        targetUserId: data.target_user_id,
      });
      return { success: true, message: 'Profile change request submitted successfully', data: change };
    } catch (err) { return handleError(err, reply); }
  });

  // Get own profile change requests
  app.get('/', { preHandler: [requireAuth] }, async (request) => {
    const query = request.query as Record<string, string>;
    if (isPaginated(query)) {
      return paginatedResponse(await repo.findByUserId(request.userId, parsePagination(query)));
    }
    return { success: true, data: await service.getMyProfileChanges(request.userId) };
  });
}
