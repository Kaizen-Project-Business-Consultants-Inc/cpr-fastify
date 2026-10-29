import { createHash, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
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

const MIN_CRON_SECRET = 24;

/** Compares two secrets in constant time, whatever their lengths. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export async function classReminderRoutes(app: FastifyInstance) {
  const reminders = new ClassReminderService();

  // The outside timer (a GitHub Actions schedule, every 5 minutes) calls this so reminders go out
  // even when nobody has used the app for a while and the server is asleep. The in-app timer does
  // the same job while the server is awake; the service's lock keeps the two from repeating a reminder.
  app.post('/run', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    schema: { description: 'Runs the class reminder check now. Needs the shared cron secret in the x-cron-secret header.', tags: ['Class reminders'] },
  }, async (request, reply) => {
    if (!env.CRON_SECRET || env.CRON_SECRET.length < MIN_CRON_SECRET) return reply.status(503).send({ error: 'Not configured' });
    const given = request.headers['x-cron-secret'];
    if (typeof given !== 'string' || !sameSecret(given, env.CRON_SECRET)) {
      return reply.status(401).send({ error: 'Not allowed' });
    }
    const { sent } = await reminders.run();
    return { success: true, data: { sent } };
  });

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
