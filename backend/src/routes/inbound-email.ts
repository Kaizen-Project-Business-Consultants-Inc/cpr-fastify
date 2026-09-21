import { FastifyInstance } from 'fastify';
import { InboundEmailRepository } from '../repositories/InboundEmailRepository.js';
import { CourseService } from '../services/CourseService.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { InboundEmailService, verifyResendSignature } from '../services/InboundEmailService.js';
import { requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id: string;
    from: string;
    subject?: string;
  };
}

export async function inboundEmailRoutes(app: FastifyInstance) {
  const repo = new InboundEmailRepository();
  const courseService = new CourseService(new CourseRequestRepository(), new CourseStudentRepository(), new UserRepository());
  const service = new InboundEmailService(repo, courseService);

  // Resend's webhook needs the exact raw body for signature verification —
  // scoped to this plugin only, so the rest of the app keeps normal JSON
  // parsing (Fastify encapsulates content-type parsers per register()).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhook', async (request, reply) => {
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

  // ===== Admin: emails that need a human (unmatched sender / couldn't extract) =====
  app.get('/needs-review', { preHandler: [requireRole('admin', 'sysadmin', 'courseadmin')] }, async () => {
    return { success: true, data: await repo.findNeedsReview() };
  });
}
