import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Field check 2026-10-21 (instructor portal + course admin leftovers): pins the
// fields and status codes the screens read.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({ env: { BCRYPT_SALT_ROUNDS: 4 } }));
vi.mock('../utils/auditLog.js', () => ({ logAudit: vi.fn(), writeAudit: vi.fn() }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId?: number; userRole?: string }) => {
    request.userId = 4;
    request.userRole = 'instructor';
  },
}));

import { instructorRoutes } from '../routes/instructors.js';
import { instructorAdminRoutes } from '../routes/instructor-admin.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';

describe('GET /instructor/classes/* (My Schedule, Dashboard, Archive)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(instructorRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('sends the real notes (not the location) and the completion time', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    await app.inject({ method: 'GET', url: '/classes/completed' });
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("COALESCE(cr.notes, '') as notes");
    expect(sql).not.toContain("COALESCE(cr.location, '') as notes");
    expect(sql).toContain('cr.completed_at as completedAt');
    // Names the dashboard and archive read
    for (const alias of ['ct.name as course_name', 'ct.name as coursetypename', 'cr.id as courseId', 'ct.name as name', 'cr.registered_students as max_students']) {
      expect(sql).toContain(alias);
    }
  });

  it('gives each class a YYYY-MM-DD date', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 9, start_time: new Date('2026-10-28T00:00:00.000Z'), notes: 'Bring mannequins' }]]);
    const res = await app.inject({ method: 'GET', url: '/classes/active' });
    const [row] = res.json().data;
    expect(row.date).toBe('2026-10-28');
    expect(row.notes).toBe('Bring mannequins');
  });
});

describe('POST/PUT /instructors duplicate username or email', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(instructorAdminRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('answers 409 on create, which Instructor Management marks on the form', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 7 }]]);
    const res = await app.inject({
      method: 'POST', url: '/instructors',
      payload: { username: 'patlee', email: 'pat@example.com', password: 'longenough1', firstName: 'Pat', lastName: 'Lee' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Username or email already exists' });
  });

  it('answers 409 on update', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 5, username: 'old', email: 'old@example.com' }]]) // findInstructor
      .mockResolvedValueOnce([[{ id: 7 }]]); // dupes
    const res = await app.inject({ method: 'PUT', url: '/instructors/5', payload: { email: 'taken@example.com' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Username or email already exists' });
  });
});

describe('CourseRequestRepository list columns (Cancelled Courses)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends cancelledAt and cancellationReason', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    await new CourseRequestRepository().findCancelled();
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('cr.cancelled_at as cancelledAt');
    expect(sql).toContain('cr.cancellation_reason as cancellationReason');
    expect(sql).toContain('cr.*'); // snake_case names stay for other screens
  });
});
