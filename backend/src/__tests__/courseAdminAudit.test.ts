import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Owner 2026-10-31: the audit log must say who assigned an instructor, cancelled,
// rescheduled or sent a course to billing. Only a successful change is logged.
const { mockAudit, mockAssign, mockCancel, mockReschedule, mockBilling } = vi.hoisted(() => ({
  mockAudit: vi.fn(), mockAssign: vi.fn(), mockCancel: vi.fn(), mockReschedule: vi.fn(), mockBilling: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ getPool: () => ({ query: vi.fn() }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../utils/auditLog.js', () => ({ logAudit: mockAudit }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number }) => { request.userId = 12; },
}));
vi.mock('../services/CourseService.js', () => {
  class CourseError extends Error {
    constructor(message: string, public statusCode = 400) { super(message); }
  }
  class CourseService {
    assignInstructor = mockAssign;
    cancel = mockCancel;
    reschedule = mockReschedule;
    markReadyForBilling = mockBilling;
  }
  return { CourseService, CourseError };
});

import { courseRoutes } from '../routes/courses.js';
import { CourseError } from '../services/CourseService.js';
import { errorHandler } from '../plugins/errorHandler.js';

describe('course admin changes are written to the audit log', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockAssign.mockResolvedValue({ id: 18 });
    mockCancel.mockResolvedValue({ id: 18 });
    mockReschedule.mockResolvedValue({ id: 18 });
    mockBilling.mockResolvedValue({ id: 18 });
    app = Fastify();
    app.decorateRequest('userId', 0);
    app.setErrorHandler(errorHandler);
    await app.register(courseRoutes, { prefix: '/courses' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('records who assigned an instructor, and to which time', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/courses/18/assign-instructor', payload: { instructorId: 4, startTime: '11:00', endTime: '13:00' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 12, action: 'assign_instructor', entityType: 'course_request', entityId: 18,
      details: { instructorId: 4, startTime: '11:00', endTime: '13:00' },
    }));
  });

  it('records who cancelled a course, and why', async () => {
    const res = await app.inject({ method: 'PUT', url: '/courses/18/cancel', payload: { reason: 'Venue closed' } });

    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 12, action: 'cancel_course', entityId: 18, details: { reason: 'Venue closed' },
    }));
  });

  it('records who rescheduled a course, and to when', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/courses/18/schedule', payload: { scheduledDate: '2026-11-04', startTime: '09:00', endTime: '11:00' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 12, action: 'reschedule_course', entityId: 18,
      details: { scheduledDate: '2026-11-04', startTime: '09:00', endTime: '11:00' },
    }));
  });

  it('records who sent a course to billing', async () => {
    const res = await app.inject({ method: 'PUT', url: '/courses/18/ready-for-billing' });

    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, action: 'send_course_to_billing', entityId: 18 }));
  });

  it('logs nothing when the change is refused', async () => {
    mockAssign.mockRejectedValue(new CourseError('Instructor is already assigned to another course during this time slot'));

    const res = await app.inject({
      method: 'PUT', url: '/courses/18/assign-instructor', payload: { instructorId: 4, startTime: '11:00', endTime: '13:00' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
