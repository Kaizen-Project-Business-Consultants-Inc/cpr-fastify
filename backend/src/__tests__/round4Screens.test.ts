import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Round 4 of the 2026-10-17 code sweep: screens that called endpoints which didn't exist.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async () => {},
}));

import { instructorAdminRoutes } from '../routes/instructor-admin.js';
import { HRService } from '../services/HRService.js';
import { ProfileChangeRepository } from '../repositories/ProfileChangeRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';

describe('Course Admin instructor dashboard', () => {
  let app: FastifyInstance;
  const rows = [
    { instructorId: 4, instructorName: 'Pat Lee', email: 'pat@x.com', coursesCompleted: 3, coursesScheduled: 1, avgStudentsPerCourse: '8.6667', lastCourseDate: '2026-09-19' },
    { instructorId: 9, instructorName: 'Sam Roy', email: 'sam@x.com', coursesCompleted: 0, coursesScheduled: 0, avgStudentsPerCourse: null, lastCourseDate: null },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([rows]);
    app = Fastify();
    await app.register(instructorAdminRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('lists each instructor for the month with a completion rate', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/instructor-stats?month=2026-09' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.stats).toEqual([
      { instructorId: 4, instructorName: 'Pat Lee', email: 'pat@x.com', coursesCompleted: 3, coursesScheduled: 1, totalCourses: 4, completionRate: 75, avgStudentsPerCourse: 8.7, lastCourseDate: '2026-09-19' },
      { instructorId: 9, instructorName: 'Sam Roy', email: 'sam@x.com', coursesCompleted: 0, coursesScheduled: 0, totalCourses: 0, completionRate: 0, avgStudentsPerCourse: 0, lastCourseDate: null },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("u.role = 'instructor' AND u.status = 'active'");
    expect(params).toEqual(['2026-09-01', '2026-10-01']);
  });

  it('totals the month for the summary cards from the same query', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/instructor-stats?month=2026-09' });

    expect(res.json().data.summary).toEqual({ totalInstructors: 2, totalCoursesThisMonth: 4, totalCompletedThisMonth: 3, avgCoursesPerInstructor: 2 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('refuses a month it cannot read', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/instructor-stats?month=September' });

    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('HR user profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never selects password hashes, reset tokens or MFA secrets', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 4, username: 'instructor', role: 'instructor' }]])
      .mockResolvedValueOnce([[]]) // profile changes
      .mockResolvedValueOnce([[]]); // course history

    await new HRService(new ProfileChangeRepository(), new UserRepository()).getUserProfile(4);

    const [userSql] = mockQuery.mock.calls[0];
    expect(userSql).not.toMatch(/u\.\*/);
    expect(userSql).not.toMatch(/password|reset_token|mfa/);
    expect(userSql).toContain('u.created_at as createdAt');
  });
});

describe('HR Personnel counts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts invoiced courses as completed and skips deleted courses', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

    await new HRService(new ProfileChangeRepository(), new UserRepository()).getInstructors({ page: 1, limit: 10 });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("cr.status IN ('completed', 'invoiced')");
    expect(sql).toContain('cr.deleted_at IS NULL');
    expect(sql).toContain('as totalCourses');
  });

  it('totals organizations from pre-grouped courses and active users', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

    await new OrganizationRepository().findWithStats({ limit: 10, offset: 0 });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM course_requests WHERE deleted_at IS NULL GROUP BY organization_id');
    expect(sql).toContain("FROM users WHERE status = 'active' GROUP BY organization_id");
    expect(sql).toContain('as contactEmail');
  });
});
