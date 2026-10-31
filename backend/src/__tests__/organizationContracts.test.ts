import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Field check 2026-10-21: Organization portal screens read fields the server
// never sent. These pin the shapes they need.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async (request: { userId?: number; userRole?: string; userOrgId?: number }) => {
    request.userId = 6;
    request.userRole = 'organization';
    request.userOrgId = 3;
  },
  requireRole: () => async (request: { userId?: number; userRole?: string; userOrgId?: number }) => {
    request.userId = 6;
    request.userRole = 'organization';
    request.userOrgId = 3;
  },
}));

import { orgBillingRoutes } from '../routes/org-billing.js';
import { organizationRoutes } from '../routes/organizations.js';
import { organizationPricingRoutes } from '../routes/organization-pricing.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { CourseService } from '../services/CourseService.js';
import { errorHandler } from '../plugins/errorHandler.js';

const sqlOf = (call: number) => String(mockQuery.mock.calls[call][0]);

describe('org billing routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(orgBillingRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('GET /organization/invoices/:id/payments sends the camelCase names Payment History reads, and skips deleted payments', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[]]);

    const res = await app.inject({ method: 'GET', url: '/organization/invoices/9/payments' });

    expect(res.statusCode).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['9', 3]);
    const sql = sqlOf(1);
    for (const alias of [
      'amount as amountPaid', 'amount as amount_paid', 'invoice_id as invoiceId',
      'payment_date as paymentDate', 'payment_method as paymentMethod',
      'reference_number as referenceNumber', 'submitted_by_org_at as submittedByOrgAt',
      'verified_by_accounting_at as verifiedByAccountingAt',
    ]) {
      expect(sql).toContain(alias);
    }
    expect(sql).toMatch(/SELECT id, invoice_id,[\s\S]*\bamount,/);
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('GET /organization/paid-invoices sends id (the PDF link uses it) as well as invoice_id', async () => {
    mockQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await app.inject({ method: 'GET', url: '/organization/paid-invoices' });

    expect(res.statusCode).toBe(200);
    expect(sqlOf(0)).toContain('SELECT i.id, i.id as invoice_id');
  });
});

describe('organization routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(organizationRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('GET /profile adds the counts the Profile cards read', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 3, name: 'Test Org', contact_email: 'o@x.com' }]])
      .mockResolvedValueOnce([[{ total_courses: 4, total_students: '27', active_instructors: 2 }]]);

    const res = await app.inject({ method: 'GET', url: '/profile' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      id: 3, name: 'Test Org', total_courses: 4, total_students: 27, active_instructors: 2,
    });
    const statsSql = sqlOf(1);
    expect(mockQuery.mock.calls[1][1]).toEqual([3]);
    expect(statsSql).toContain('cr.deleted_at IS NULL');
    expect(statsSql).toContain("cr.status <> 'cancelled'");
    expect(statsSql).toContain('COUNT(DISTINCT cr.instructor_id)');
    expect(statsSql).toContain('cs.deleted_at IS NULL');
    expect(statsSql).toContain('LEFT JOIN course_students cs');
    expect(statsSql).not.toContain('SUM(');
  });

  it('PUT /profile accepts a blank contact email', async () => {
    mockQuery
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 3, name: 'Test Org', contact_email: '' }]]);

    const res = await app.inject({
      method: 'PUT', url: '/profile',
      payload: { name: 'Test Org', address: '', contactPhone: '', contactEmail: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['Test Org', '', '', '', 3]);
  });

  it('PUT /profile still rejects an email that is not blank and not valid', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/profile',
      payload: { name: 'Test Org', contactEmail: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  const courseRequest = { courseTypeId: 2, scheduledDate: '2026-11-15', location: '123 Main St', registeredStudents: 10 };

  it('POST /course-request refuses an inactive course type', async () => {
    const create = vi.spyOn(CourseService.prototype, 'createRequest');
    mockQuery.mockResolvedValueOnce([[{ is_active: 0 }]]);

    const res = await app.inject({ method: 'POST', url: '/course-request', payload: courseRequest });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no longer offered/);
    expect(mockQuery.mock.calls[0][1]).toEqual([2]);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('POST /course-request refuses a course type that does not exist', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await app.inject({ method: 'POST', url: '/course-request', payload: courseRequest });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Course type not found');
  });

  it('POST /course-request books an active course type', async () => {
    const create = vi.spyOn(CourseService.prototype, 'createRequest').mockResolvedValue({ id: 50 } as never);
    mockQuery.mockResolvedValueOnce([[{ is_active: 1 }]]);

    const res = await app.inject({ method: 'POST', url: '/course-request', payload: courseRequest });

    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 3, courseTypeId: 2 }));
    create.mockRestore();
  });
});

describe('OrganizationRepository.getOrgCourses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends archivedAt for the Archive screen and skips deleted courses', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

    await new OrganizationRepository().getOrgCourses(3, { archived: true, limit: 500, offset: 0 });

    expect(sqlOf(0)).toContain('cr.archived_at as archivedAt');
    // The class times the My Courses list shows under the date
    expect(sqlOf(0)).toContain('cr.confirmed_start_time as confirmedStartTime');
    expect(sqlOf(0)).toContain('cr.confirmed_end_time as confirmedEndTime');
    expect(sqlOf(0)).toContain('cr.deleted_at IS NULL');
    expect(sqlOf(0)).toContain('cr.archived_at DESC, cr.id DESC');
    // Removed roster rows don't count as attended
    expect(sqlOf(0).match(/cs\.attended = true AND cs\.deleted_at IS NULL/g)).toHaveLength(2);
  });

  it('does not hand the organization the instructor reminder or check-in record', async () => {
    mockQuery
      .mockResolvedValueOnce([[{
        id: 8, location: 'markham', instructor: 'Coujoe', reminder_soon_at: 'x', reminder_day_before_at: 'x',
        instructor_ready_at: 'x', instructor_ready_located: 1, instructor_ready_accuracy_m: 20, instructor_ready_distance_m: 40, ready_alert_at: 'x',
      }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const { rows } = await new OrganizationRepository().getOrgCourses(3, { archived: false, limit: 10, offset: 0 });

    expect(rows[0]).toEqual({ id: 8, location: 'markham', instructor: 'Coujoe' });
  });

  it('the count query has the cr alias the date filter uses', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

    await new OrganizationRepository().getOrgCourses(3, { archived: false, limit: 10, offset: 0, from: '2026-01-01' });

    const countSql = sqlOf(1);
    expect(countSql).toContain('FROM course_requests cr');
    expect(countSql).toContain('cr.scheduled_date >= ?');
    expect(mockQuery.mock.calls[1][1]).toEqual([3, false, '2026-01-01']);
  });
});

describe('GET /organization/:organizationId (org Pricing screen)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(organizationPricingRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('sends classTypeId and updatedAt in camelCase', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await app.inject({ method: 'GET', url: '/organization/3' });

    expect(res.statusCode).toBe(200);
    expect(sqlOf(0)).toContain('op.class_type_id as classTypeId');
    expect(sqlOf(0)).toContain('op.updated_at as updatedAt');
  });
});
