import { describe, it, expect, vi, beforeEach } from 'vitest';

// Owner 2026-10-22: instructors weren't told when they were booked; only the
// organization got an email. They now get one when booked, when the class
// changes, when it's cancelled, and when it's given to someone else.
const { conn, poolQuery, sendInstructor, course } = vi.hoisted(() => ({
  conn: { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn() },
  poolQuery: vi.fn(),
  sendInstructor: vi.fn(),
  course: { current: {} as Record<string, unknown> },
}));
vi.mock('../config/database.js', () => ({ getPool: () => ({ getConnection: async () => conn, query: poolQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://stage.example' } }));
vi.mock('../services/EmailService.js', () => ({
  emailService: {
    sendInstructorCourseEmail: sendInstructor,
    sendCourseConfirmedEmail: vi.fn().mockResolvedValue(true),
    sendCourseCancelledEmail: vi.fn().mockResolvedValue(true),
  },
}));

import { CourseService } from '../services/CourseService.js';
import type { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import type { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';

const BOOKED = {
  id: 2, organization_id: 1, course_type_id: 18, status: 'confirmed', instructor_id: 4,
  scheduled_date: new Date('2026-11-16T00:00:00Z'), confirmed_date: new Date('2026-11-16T00:00:00Z'),
  confirmed_start_time: '09:00:00', confirmed_end_time: '13:00:00', location: '123 Main St', registered_students: 8,
};

/** The instructor + course row notifyInstructor reads, after the change. */
const NOTICE_ROW = {
  email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee', username: 'instructor',
  course_name: 'Basic First Aid', organization_name: 'Test Organization', location: '123 Main St',
  course_date: new Date('2026-11-20T00:00:00Z'), confirmed_start_time: '10:00:00', confirmed_end_time: '14:00:00',
};

function service() {
  const courseRepo = { findById: vi.fn().mockResolvedValue({ id: 2 }) } as unknown as CourseRequestRepository;
  const userRepo = { findById: vi.fn().mockResolvedValue({ id: 7, first_name: 'Sam', last_name: 'Ng' }) } as unknown as UserRepository;
  return new CourseService(courseRepo, {} as CourseStudentRepository, userRepo);
}

/** Wait for the fire-and-forget emails. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('instructor booking emails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendInstructor.mockResolvedValue(true);
    conn.query.mockImplementation(async (sql: string) =>
      /^SELECT \* FROM course_requests/.test(sql) ? [[course.current]] : /^\s*SELECT id FROM course_requests/.test(sql) ? [[]] : [{ affectedRows: 1 }]);
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM users u\s+JOIN course_requests cr/.test(sql)) return [[NOTICE_ROW]];
      if (/notification_preferences/.test(sql)) return [[]];
      return [[]];
    });
  });

  it('tells the instructor they were booked', async () => {
    course.current = { ...BOOKED, status: 'pending', instructor_id: null };
    await service().assignInstructor({ courseId: 2, instructorId: 4, startTime: '10:00', endTime: '14:00' });
    await settle();

    expect(sendInstructor).toHaveBeenCalledTimes(1);
    const [to, kind, data] = sendInstructor.mock.calls[0];
    expect(to).toBe('pat@example.com');
    expect(kind).toBe('booked');
    expect(data).toMatchObject({
      instructorName: 'Pat Lee', courseName: 'Basic First Aid', organizationName: 'Test Organization',
      date: '2026-11-20', startTime: '10:00:00', endTime: '14:00:00', scheduleUrl: 'https://stage.example/instructor/classes',
    });
  });

  it('tells the instructor when their class is cancelled, with the reason', async () => {
    course.current = BOOKED;
    await service().cancel(2, 'Venue closed');
    await settle();
    expect(sendInstructor).toHaveBeenCalledWith('pat@example.com', 'cancelled', expect.objectContaining({ reason: 'Venue closed' }));
  });

  it('does not email anyone when an unbooked request is cancelled', async () => {
    course.current = { ...BOOKED, status: 'pending', instructor_id: null };
    await service().cancel(2, 'Not needed');
    await settle();
    expect(sendInstructor).not.toHaveBeenCalled();
  });

  it('tells the same instructor about a new date', async () => {
    course.current = BOOKED;
    await service().reschedule({ courseId: 2, scheduledDate: '2026-11-20', startTime: '10:00', endTime: '14:00' });
    await settle();
    expect(sendInstructor).toHaveBeenCalledTimes(1);
    expect(sendInstructor.mock.calls[0][1]).toBe('rescheduled');
  });

  it('sends nothing when Edit is saved without changes', async () => {
    course.current = BOOKED;
    await service().reschedule({ courseId: 2, scheduledDate: '2026-11-16', startTime: '09:00', endTime: '13:00', instructorId: 4 });
    await settle();
    expect(sendInstructor).not.toHaveBeenCalled();
  });

  it('a time change alone still tells the instructor', async () => {
    course.current = BOOKED;
    await service().reschedule({ courseId: 2, scheduledDate: '2026-11-16', startTime: '10:00', endTime: '13:00' });
    await settle();
    expect(sendInstructor.mock.calls.map(([, kind]) => kind)).toEqual(['rescheduled']);
  });

  it('books an instructor added through Edit on a class that had none', async () => {
    course.current = { ...BOOKED, instructor_id: null };
    await service().reschedule({ courseId: 2, scheduledDate: '2026-11-16', instructorId: 9 });
    await settle();
    expect(sendInstructor.mock.calls.map(([, kind]) => kind)).toEqual(['booked']);
  });

  it('tells the old instructor (with the old date) and the new one when the class moves to someone else', async () => {
    course.current = BOOKED;
    await service().reschedule({ courseId: 2, scheduledDate: '2026-11-20', instructorId: 9 });
    await settle();

    const byKind = Object.fromEntries(sendInstructor.mock.calls.map(([, kind, data]) => [kind, data]));
    expect(Object.keys(byKind).sort()).toEqual(['booked', 'removed']);
    expect(byKind.removed).toMatchObject({ date: '2026-11-16', startTime: '09:00:00', endTime: '13:00:00' });
    const ids = poolQuery.mock.calls.filter(([sql]) => /FROM users u\s+JOIN course_requests cr/.test(sql)).map(([, p]) => p[1]);
    expect(ids.sort()).toEqual([4, 9]);
  });

  it('respects an instructor who switched these emails off (MariaDB sends 0)', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM users u\s+JOIN course_requests cr/.test(sql)) return [[NOTICE_ROW]];
      if (/notification_preferences/.test(sql)) return [[{ email_enabled: 0 }]];
      return [[]];
    });
    course.current = BOOKED;
    await service().cancel(2, 'Venue closed');
    await settle();
    expect(sendInstructor).not.toHaveBeenCalled();
  });

  it('a failed email never breaks the change', async () => {
    sendInstructor.mockRejectedValue(new Error('Resend down'));
    course.current = BOOKED;
    await expect(service().cancel(2, 'Venue closed')).resolves.toBeTruthy();
    await settle();
  });
});
