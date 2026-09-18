import { FastifyInstance } from 'fastify';
import { requireAuth } from '../plugins/auth.js';
import { authRoutes } from './auth.js';
import { healthRoutes } from './health.js';
import { courseRoutes } from './courses.js';
import { billingRoutes } from './billing.js';
import { organizationRoutes } from './organizations.js';
import { hrRoutes } from './hr.js';
import { profileChangeRoutes } from './profile-changes.js';
import { studentRoutes } from './students.js';
import { instructorRoutes } from './instructors.js';
import { timesheetRoutes } from './timesheets.js';
import { payRateRoutes } from './pay-rates.js';
import { payrollRoutes } from './payroll.js';
import { vendorRoutes } from './vendors.js';
import { vendorAdminRoutes } from './vendor-admin.js';
import { adminRoutes } from './admin.js';
import { orgBillingRoutes } from './org-billing.js';
import { notificationRoutes } from './notifications.js';
import { organizationPricingRoutes } from './organization-pricing.js';
import { courseAdminRoutes } from './courseadmin.js';
import { emailTemplateRoutes } from './email-templates.js';
import { collegeRoutes } from './colleges.js';
import { miscRoutes } from './misc.js';
import { instructorAdminRoutes } from './instructor-admin.js';
import { logger } from '../config/logger.js';
import { registerSwagger } from '../plugins/swagger.js';
import { env } from '../config/env.js';
import { getHSTRate, getHSTLabel } from '../utils/taxConfig.js';

export async function registerRoutes(app: FastifyInstance) {
  // OpenAPI docs at /api/v1/docs — not exposed in production
  if (env.NODE_ENV !== 'production') {
    await registerSwagger(app);
  }
  // Client-side error collector (unauthenticated, rate-limited)
  app.post('/client-errors', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, _reply) => {
    const body = request.body as Record<string, unknown>;
    logger.warn({
      clientError: true,
      source: body?.source,
      message: body?.message,
      stack: body?.stack,
      clientUrl: body?.url,
    }, 'Client-side error reported');
    return { received: true };
  });
  // Public, read-only client configuration. The tax rate lives in the database
  // (system_config.tax_rate) and is loaded at startup; exposing it here keeps
  // the frontend from baking a build-time constant that can silently drift.
  // Unauthenticated and rate-limited like /client-errors.
  app.get('/config', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      description: 'Public client configuration (tax rate and label). No authentication required.',
      tags: ['Config'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                taxRate: { type: 'number', description: 'Tax rate as a fraction, e.g. 0.13' },
                taxLabel: { type: 'string', description: 'Display label, e.g. "HST (13%)"' },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    // Small and stable — safe for shared caches for a few minutes.
    reply.header('Cache-Control', 'public, max-age=300');
    return { success: true, data: { taxRate: getHSTRate(), taxLabel: getHSTLabel() } };
  });

  // SSE endpoint for real-time updates (keeps connection open)
  app.get('/events', { preHandler: [requireAuth] }, async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write('data: {"type":"connected"}\n\n');

    const keepAlive = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
    });
  });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(courseRoutes, { prefix: '/courses' });
  await app.register(billingRoutes, { prefix: '/accounting' });
  await app.register(organizationRoutes, { prefix: '/organization' });
  await app.register(hrRoutes, { prefix: '/hr' });
  await app.register(profileChangeRoutes, { prefix: '/profile-changes' });
  await app.register(studentRoutes, { prefix: '/student' });
  await app.register(instructorRoutes, { prefix: '/instructor' });
  await app.register(timesheetRoutes, { prefix: '/timesheet' });
  await app.register(payRateRoutes, { prefix: '/pay-rates' });
  await app.register(payrollRoutes, { prefix: '/payroll' });
  await app.register(vendorRoutes, { prefix: '/vendor' });
  await app.register(vendorAdminRoutes);
  await app.register(adminRoutes, { prefix: '/sysadmin' });
  await app.register(orgBillingRoutes);
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(organizationPricingRoutes, { prefix: '/organization-pricing' });
  await app.register(courseAdminRoutes, { prefix: '/courseadmin' });
  await app.register(emailTemplateRoutes, { prefix: '/email-templates' });
  await app.register(collegeRoutes, { prefix: '/colleges' });
  await app.register(miscRoutes);
  // Admin-side /instructors/... (no prefix — the course-admin UI calls them at the API root)
  await app.register(instructorAdminRoutes);
}
