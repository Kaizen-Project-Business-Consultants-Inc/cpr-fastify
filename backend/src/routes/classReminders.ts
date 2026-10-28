import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassReminderService, readyRefusalMessage } from '../services/ClassReminderService.js';

const readyBody = z.object({
  classId: z.coerce.string(),
  token: z.string().min(1).max(100),
  // The phone's position when the button was tapped. Check-in needs it; the service answers when it is missing.
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
    schema: { description: 'Instructor checks in as ready for a class. Needs the phone location, within the check-in radius. No authentication required.', tags: ['Class reminders'] },
  }, async (request, reply) => {
    const parsed = readyBody.safeParse(request.body);
    const r = parsed.success
      ? await reminders.confirmReady(parsed.data.classId, parsed.data.token, parsed.data.location)
      : ({ ok: false, reason: 'invalid' } as const);
    if (r.ok) return { success: true, data: { courseName: r.courseName, date: r.date, startTime: r.startTime } };
    if (r.reason === 'invalid') return reply.status(404).send({ error: 'This link is not valid' });
    return reply.status(422).send({ error: readyRefusalMessage(r), code: r.reason });
  });
}
