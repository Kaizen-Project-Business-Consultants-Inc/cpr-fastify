import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassReminderService, type ReadyOutcome } from '../services/ClassReminderService.js';

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
    return reply.status(422).send({ error: refusalMessage(r), code: r.reason });
  });
}

const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** What the instructor is told when the check-in is not accepted. */
function refusalMessage(r: Exclude<ReadyOutcome, { ok: true } | { reason: 'invalid' }>): string {
  switch (r.reason) {
    case 'location_required':
      return 'Location is needed to check in. Allow location access for this page, then tap the button again.';
    case 'imprecise':
      return "Your phone's location is not precise enough to check you in. Turn on GPS (precise location), move outside if you can, and try again.";
    case 'venue_unknown':
      return 'We could not find the class address on the map, so we cannot check you in automatically. Please call the course admin.';
    case 'too_early':
      return `Check-in opens ${r.opensMinutes} minutes before the class starts. Please tap the button again closer to the start time.`;
    case 'too_far':
      return `You are about ${metres(r.distance)} from the venue. You can check in once you are within ${metres(r.radius)}.`;
  }
}
