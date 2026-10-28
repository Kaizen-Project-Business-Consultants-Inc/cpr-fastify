import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassReminderService } from '../services/ClassReminderService.js';

const readyBody = z.object({
  classId: z.coerce.string(),
  token: z.string().min(1).max(100),
  // Optional: the phone's position when the button was tapped
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(1_000_000).optional(),
  }).optional(),
});

export async function classReminderRoutes(app: FastifyInstance) {
  const reminders = new ClassReminderService();

  // The instructor taps the button in the reminder email. No sign-in: the link
  // carries a signed token for that one class.
  app.post('/ready', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { description: 'Instructor confirms they are ready for a class. No authentication required.', tags: ['Class reminders'] },
  }, async (request, reply) => {
    const parsed = readyBody.safeParse(request.body);
    const result = parsed.success ? await reminders.confirmReady(parsed.data.classId, parsed.data.token, parsed.data.location) : null;
    if (!result) return reply.status(404).send({ error: 'This link is not valid' });
    return { success: true, data: result };
  });
}
