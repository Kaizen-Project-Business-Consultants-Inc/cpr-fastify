import { FastifyInstance } from 'fastify';
import { InboundEmailRepository } from '../repositories/InboundEmailRepository.js';
import { CourseService } from '../services/CourseService.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { InboundEmailService, verifyResendSignature, normalizeDateText } from '../services/InboundEmailService.js';
import { requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { getPool } from '../config/database.js';
import { logAudit } from '../utils/auditLog.js';
import { torontoToday } from '../utils/torontoDate.js';
import { CourseError } from '../services/CourseService.js';
import type { InboundEmailStatus } from '../repositories/InboundEmailRepository.js';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id: string;
    from: string;
    subject?: string;
  };
}

const REVIEWABLE: InboundEmailStatus[] = ['unmatched_sender', 'needs_review'];

const idParams = z.object({ id: z.coerce.number().int().positive() });

const createFromEmailSchema = z.object({
  organizationId: z.number().int().positive(),
  courseTypeId: z.number().int().positive(),
  scheduledDate: z.string()
    .refine((v) => normalizeDateText(v) === v, 'Date must be a real date (YYYY-MM-DD)')
    .refine((v) => v >= torontoToday(), 'Pick a date from today on'),
  location: z.string().trim().min(1).max(500),
  registeredStudents: z.number().int().min(1).max(1000),
  notes: z.string().trim().max(1000).optional(),
});

const dismissSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export async function inboundEmailRoutes(app: FastifyInstance) {
  const repo = new InboundEmailRepository();
  const courseService = new CourseService(new CourseRequestRepository(), new CourseStudentRepository(), new UserRepository());
  const service = new InboundEmailService(repo, courseService);

  await app.register(async (hook) => {
    // Resend's webhook needs the exact raw body for signature verification —
    // scoped to this child plugin only, so the rest of the app (and the admin
    // routes below) keep normal JSON parsing (Fastify encapsulates
    // content-type parsers per register()).
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });

    hook.post('/webhook', async (request, reply) => {
      if (!env.RESEND_WEBHOOK_SECRET) {
        return reply.status(503).send({ error: 'Inbound email is not configured' });
      }

      const rawBody = request.body as string;
      const valid = verifyResendSignature(rawBody, {
        'svix-id': request.headers['svix-id'] as string | undefined,
        'svix-timestamp': request.headers['svix-timestamp'] as string | undefined,
        'svix-signature': request.headers['svix-signature'] as string | undefined,
      });
      if (!valid) {
        logger.warn('Inbound email webhook: signature verification failed');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      let payload: ResendWebhookPayload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return reply.status(400).send({ error: 'Invalid JSON' });
      }

      if (payload.type !== 'email.received') {
        return { success: true }; // other event types are ignored, not an error
      }

      // Acknowledge immediately — Resend retries on non-2xx/timeout, and
      // extraction (possibly an LLM call) can take a few seconds.
      reply.status(200).send({ success: true });

      try {
        await service.processReceivedEmail(payload.data.email_id, payload.data.from, payload.data.subject ?? null);
      } catch (err) {
        logger.error({ err, emailId: payload.data.email_id }, 'Inbound email processing failed');
      }
    });
  });

  // ===== Admin: emails that need a human (unmatched sender / couldn't extract) =====
  const staffRole = [requireRole('admin', 'sysadmin', 'courseadmin')];

  app.get('/needs-review', { preHandler: staffRole }, async () => {
    return { success: true, data: await repo.findNeedsReview() };
  });

  app.get('/handled', { preHandler: staffRole }, async () => {
    return { success: true, data: await repo.findHandled() };
  });

  // Organizations to choose from when the sender wasn't recognized.
  app.get('/organizations', { preHandler: staffRole }, async () => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT id, name FROM organizations WHERE status = 'active' OR status IS NULL ORDER BY name"
    );
    return { success: true, data: rows };
  });

  app.post('/:id/create-request', { preHandler: staffRole }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const input = createFromEmailSchema.parse(request.body);

    const email = await repo.findOne(id);
    if (!email) return reply.status(404).send({ error: 'Email not found' });
    if (!REVIEWABLE.includes(email.status)) {
      return reply.status(409).send({ error: 'This email has already been handled.' });
    }

    const [[org], [courseType]] = await Promise.all([
      getPool().query<RowDataPacket[]>("SELECT id FROM organizations WHERE id = ? AND (status = 'active' OR status IS NULL)", [input.organizationId]),
      getPool().query<RowDataPacket[]>('SELECT id FROM class_types WHERE id = ? AND is_active = true', [input.courseTypeId]),
    ]);
    if (!org.length) return reply.status(400).send({ error: 'Pick an active organization.' });
    if (!courseType.length) return reply.status(400).send({ error: 'Pick one of the courses we currently offer.' });

    // Claim the row first so a second click can't create a second request.
    // If the process dies before the end, the row is left as 'received'; the
    // log line below names it so it can be found and put back.
    if (!(await repo.transition(id, email.status, 'received'))) {
      return reply.status(409).send({ error: 'This email has already been handled.' });
    }
    logger.info({ emailId: id }, 'Inbound email claimed to create a course request');

    let course;
    try {
      course = await courseService.createRequest({
        organizationId: input.organizationId,
        courseTypeId: input.courseTypeId,
        scheduledDate: input.scheduledDate,
        location: input.location,
        registeredStudents: input.registeredStudents,
        notes: input.notes || (email.subject ? `Received by email — subject: "${email.subject}"` : 'Received by email'),
        source: 'email',
      });
    } catch (err) {
      try {
        await repo.transition(id, 'received', email.status);
      } catch (restoreErr) {
        logger.error({ err: restoreErr, emailId: id }, 'Could not put the inbound email back on the review list');
      }
      if (err instanceof CourseError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }

    try {
      await repo.transition(id, 'received', 'created_request', { course_request_id: course.id, handled_by: request.userId });
    } catch (err) {
      // The request exists; only the email's bookkeeping failed. Don't tell
      // staff it failed (they'd create it again), but leave a trail.
      logger.error({ err, emailId: id, courseRequestId: course.id }, 'Course request created but the inbound email was not marked done');
    }
    logAudit({
      userId: request.userId, action: 'inbound_email_request_created', entityType: 'inbound_email', entityId: id,
      details: { courseRequestId: course.id, organizationId: input.organizationId, previousStatus: email.status },
      ipAddress: request.ip,
    });
    return { success: true, message: `Course request #${course.id} created.`, data: { courseRequestId: course.id } };
  });

  app.post('/:id/dismiss', { preHandler: staffRole }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { note } = dismissSchema.parse(request.body ?? {});

    const email = await repo.findOne(id);
    if (!email) return reply.status(404).send({ error: 'Email not found' });
    if (!REVIEWABLE.includes(email.status)) {
      return reply.status(409).send({ error: 'This email has already been handled.' });
    }

    const reason = note ? `Dismissed: ${note}` : 'Dismissed';
    if (!(await repo.transition(id, email.status, 'rejected', { reject_reason: reason, handled_by: request.userId }))) {
      return reply.status(409).send({ error: 'This email has already been handled.' });
    }
    logAudit({
      userId: request.userId, action: 'inbound_email_dismissed', entityType: 'inbound_email', entityId: id,
      details: { note: note ?? null, previousStatus: email.status, previousReason: email.reject_reason },
      ipAddress: request.ip,
    });
    return { success: true, message: 'Email dismissed.' };
  });
}
