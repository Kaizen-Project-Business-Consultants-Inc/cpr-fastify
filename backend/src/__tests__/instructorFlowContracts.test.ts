import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Field check 2026-10-20: screens in the instructor → course admin → billing
// flow read fields the server never sent. These pin the shapes they need.
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
  requireRole: () => async (request: { userId?: number; userRole?: string }) => {
    request.userId = 4;
    request.userRole = 'instructor';
  },
}));

import { instructorAdminRoutes } from '../routes/instructor-admin.js';
import { timesheetRoutes } from '../routes/timesheets.js';
import { instructorRoutes } from '../routes/instructors.js';
import { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';

describe('GET /instructors/overview (Instructor Management availability table)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce([[
        { id: 4, username: 'instructor', email: 'i@x.com', first_name: 'Pat', last_name: 'Lee', phone: null },
        { id: 7, username: 'newbie', email: 'n@x.com', first_name: null, last_name: null, phone: null },
      ]])
      .mockResolvedValueOnce([[{ instructor_id: 4, day: '2026-10-29' }, { instructor_id: 4, day: '2026-10-27' }]])
      .mockResolvedValueOnce([[{
        instructor_id: 4, day: '2026-10-28', status: 'confirmed', location: '300 Front St W', notes: 'Bring mannequins',
        organization_name: 'Test Organization', course_type_name: 'CPR Basic',
      }]]);
    app = Fastify();
    await app.register(instructorAdminRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('returns a row per available day and per assigned course, in date order', async () => {
    const res = await app.inject({ method: 'GET', url: '/instructors/overview' });

    expect(res.statusCode).toBe(200);
    const pat = res.json().data.filter((r: { id: number }) => r.id === 4);
    expect(pat.map((r: { availabilityDate: string; assignmentStatus: string }) => [r.availabilityDate, r.assignmentStatus])).toEqual([
      ['2026-10-27', 'Available'],
      ['2026-10-28', 'Confirmed'],
      ['2026-10-29', 'Available'],
    ]);
    expect(pat[1]).toMatchObject({
      instructorName: 'Pat Lee', firstName: 'Pat', lastName: 'Lee', email: 'i@x.com',
      assignedOrganization: 'Test Organization', assignedLocation: '300 Front St W', assignedCourseType: 'CPR Basic', notes: 'Bring mannequins',
    });
  });

  it('keeps an instructor with no dates, so Edit and Deactivate stay reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/instructors/overview' });
    expect(res.json().data.find((r: { id: number }) => r.id === 7)).toMatchObject({
      instructorName: 'newbie', availabilityDate: null, assignmentStatus: 'No dates',
    });
  });

  it('only lists availability from today on, and finished courses from the last 90 days', async () => {
    await app.inject({ method: 'GET', url: '/instructors/overview' });
    expect(mockQuery.mock.calls[1][0]).toContain('date >= ?');
    expect(mockQuery.mock.calls[1][1]).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
    expect(mockQuery.mock.calls[2][0]).toContain("cr.status IN ('confirmed', 'completed', 'invoiced')");
    expect(mockQuery.mock.calls[2][0]).toContain('INTERVAL 90 DAY');
  });

  it('sends the whole history only when asked', async () => {
    await app.inject({ method: 'GET', url: '/instructors/overview?includeCompleted=1' });
    expect(mockQuery.mock.calls[2][0]).not.toContain('INTERVAL 90 DAY');
    expect(mockQuery.mock.calls[2][1]).toEqual([]);
  });
});

describe('GET /instructors/overview edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(instructorAdminRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('gives an instructor with only finished courses a "No dates" row too', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 4, username: 'instructor', email: 'i@x.com', first_name: 'Pat', last_name: 'Lee', phone: null }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ instructor_id: 4, day: '2026-10-01', status: 'invoiced', location: 'X', notes: null, organization_name: 'Org', course_type_name: 'CPR' }]]);
    const res = await app.inject({ method: 'GET', url: '/instructors/overview' });
    expect(res.json().data.map((r: { assignmentStatus: string }) => r.assignmentStatus)).toEqual(['Completed', 'No dates']);
  });

  it('shows a day with a course once, as the course', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 4, username: 'instructor', email: 'i@x.com', first_name: 'Pat', last_name: 'Lee', phone: null }]])
      .mockResolvedValueOnce([[{ instructor_id: 4, day: '2026-10-28' }]])
      .mockResolvedValueOnce([[{ instructor_id: 4, day: '2026-10-28', status: 'confirmed', location: 'X', notes: null, organization_name: 'Org', course_type_name: 'CPR' }]]);
    const res = await app.inject({ method: 'GET', url: '/instructors/overview' });
    expect(res.json().data.map((r: { assignmentStatus: string }) => r.assignmentStatus)).toEqual(['Confirmed']);
  });
});

describe('course roster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives the roster dialogs camelCase names and keeps snake_case for Bills Payable', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    await new CourseStudentRepository().findByCourse(3);
    const sql = String(mockQuery.mock.calls[0][0]);
    for (const alias of ['first_name AS firstName', 'last_name AS lastName', 'attendance_marked AS attendanceMarked', 'created_at AS createdAt']) {
      expect(sql).toContain(alias);
    }
    expect(sql).toMatch(/SELECT id, course_request_id, student_id, first_name, last_name/);
  });
});

describe('GET /timesheet course details', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(timesheetRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('parses the stored JSON text and adds the camelCase names the dialogs read', async () => {
    mockQuery
      .mockResolvedValueOnce([[
        { id: 1, courseDetails: '[{"id":9,"start_time":"09:00:00","end_time":"12:00:00","course_type":"CPR Basic","organization_name":"Test Organization","student_count":5}]' },
        { id: 2, courseDetails: 'not json' },
        { id: 3, courseDetails: null },
      ]])
      .mockResolvedValueOnce([[{ total: 3 }]]);

    const res = await app.inject({ method: 'GET', url: '/' });

    const [first, second, third] = res.json().data.timesheets;
    expect(first.courseDetails).toEqual([expect.objectContaining({
      startTime: '09:00:00', endTime: '12:00:00', courseType: 'CPR Basic', organizationName: 'Test Organization', studentCount: 5,
    })]);
    expect(second.courseDetails).toEqual([]);
    expect(third.courseDetails).toEqual([]);
  });
});

describe("GET /instructor/classes/today (Class Attendance)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(instructorRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('sends the courseId, name and start/end times the screen keys on', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    await app.inject({ method: 'GET', url: '/classes/today?date=2026-10-28' });
    const sql = String(mockQuery.mock.calls[0][0]);
    for (const alias of ['cr.id as courseId', 'ct.name as name', 'cr.confirmed_start_time as startTime', 'cr.confirmed_end_time as endTime']) {
      expect(sql).toContain(alias);
    }
    expect(mockQuery.mock.calls[0][1]).toEqual([4, '2026-10-28']);
  });
});
