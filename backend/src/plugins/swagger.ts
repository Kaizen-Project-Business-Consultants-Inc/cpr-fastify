import { FastifyInstance } from 'fastify';

// @fastify/swagger and swagger-ui are imported dynamically and kept out of the deploy
// bundle: they are only registered when NODE_ENV !== 'production', so the production
// bundle never loads them and the host copies can be absent or stale without effect.

// Map route prefixes to OpenAPI tags
const PREFIX_TAG_MAP: Record<string, string> = {
  '/auth': 'Auth',
  '/health': 'Health',
  '/courses': 'Courses',
  '/accounting': 'Accounting',
  '/organization': 'Organization',
  '/hr': 'HR',
  '/profile-changes': 'Profile Changes',
  '/student': 'Students',
  '/instructor': 'Instructor',
  '/timesheet': 'Timesheets',
  '/pay-rates': 'Pay Rates',
  '/payroll': 'Payroll',
  '/vendor': 'Vendor',
  '/sysadmin': 'Sysadmin',
  '/courseadmin': 'Course Admin',
  '/notifications': 'Notifications',
  '/organization-pricing': 'Organization Pricing',
  '/email-templates': 'Email Templates',
  '/colleges': 'Colleges',
};

export async function registerSwagger(app: FastifyInstance) {
  const { default: swagger } = await import('@fastify/swagger');
  const { default: swaggerUi } = await import('@fastify/swagger-ui');

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CPR Training Management API',
        description: 'API for the CPR Training Management System — course scheduling, billing, instructor management, and multi-tenant organization portal.',
        version: '1.0.0',
        contact: { name: 'Kaizen PBC', url: 'https://kpbc.ca' },
      },
      servers: [
        { url: '/', description: 'Current server' },
      ],
      tags: [
        { name: 'Auth', description: 'Authentication — login, refresh, logout, password change' },
        { name: 'Health', description: 'Health check and system status' },
        { name: 'Courses', description: 'Course requests — org submission, admin scheduling, instructor assignment' },
        { name: 'Accounting', description: 'Billing — invoices, pricing, payments, reports' },
        { name: 'Organization', description: 'Organization portal — profile, courses, billing, archives' },
        { name: 'Organization Billing', description: 'Organization invoice & payment management' },
        { name: 'Organization Pricing', description: 'Per-organization course pricing configuration' },
        { name: 'Instructor', description: 'Instructor portal — classes, availability, attendance, profile' },
        { name: 'HR', description: 'HR portal — instructor management, profile changes, payment requests' },
        { name: 'Timesheets', description: 'Instructor timesheet submission and HR approval' },
        { name: 'Pay Rates', description: 'Instructor pay rate tiers and assignments' },
        { name: 'Payroll', description: 'Payroll calculation, payment processing, reports' },
        { name: 'Vendor', description: 'Vendor portal — invoice submission, profile, dashboard' },
        { name: 'Vendor Admin', description: 'Admin/accounting vendor invoice management' },
        { name: 'Sysadmin', description: 'System administration — users, organizations, course types, vendors, config' },
        { name: 'Course Admin', description: 'Course scheduling and instructor assignment' },
        { name: 'Notifications', description: 'User notification preferences and history' },
        { name: 'Email Templates', description: 'Email template CRUD, preview, test send' },
        { name: 'Colleges', description: 'College/institution management' },
        { name: 'Profile Changes', description: 'User profile change requests and HR approval' },
        { name: 'Students', description: 'Student portal — classes, enrollments, profile' },
        { name: 'Misc', description: 'Shared lookups — course types, instructors, classes' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token from POST /auth/login',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      filter: true,
      tagsSorter: 'alpha',
    },
  });

  // Auto-tag routes by URL prefix (runs after routes are registered)
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.schema?.tags?.length) return; // already tagged

    const path = routeOptions.url;

    for (const [prefix, tag] of Object.entries(PREFIX_TAG_MAP)) {
      if (path.startsWith(prefix)) {
        routeOptions.schema = routeOptions.schema || {};
        routeOptions.schema.tags = [tag];
        return;
      }
    }

    // Routes without prefix — check for known patterns
    if (path.startsWith('/admin/vendor') || path.startsWith('/accounting/vendor')) {
      routeOptions.schema = routeOptions.schema || {};
      routeOptions.schema.tags = ['Vendor Admin'];
    } else if (path === '/client-errors' || path === '/events') {
      routeOptions.schema = routeOptions.schema || {};
      routeOptions.schema.tags = ['Misc'];
    } else if (path.startsWith('/invoices/') || path.startsWith('/payments/')) {
      routeOptions.schema = routeOptions.schema || {};
      routeOptions.schema.tags = ['Organization Billing'];
    } else if (['/course-types', '/classes', '/instructors', '/dashboard'].includes(path)) {
      routeOptions.schema = routeOptions.schema || {};
      routeOptions.schema.tags = ['Misc'];
    }
  });
}
