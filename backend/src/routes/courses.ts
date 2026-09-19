import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CourseService, CourseError } from '../services/CourseService.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { isPaginated, parsePagination, paginatedResponse } from '../utils/pagination.js';

// --- Validation schemas ---

const createRequestSchema = z.object({
  courseTypeId: z.number().int().positive(),
  scheduledDate: z.string().min(1),
  location: z.string().min(1),
  locationId: z.number().int().positive().optional(),
  registeredStudents: z.number().int().min(0),
  notes: z.string().optional(),
});

const assignInstructorSchema = z.object({
  instructorId: z.number().int().positive(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

const rescheduleSchema = z.object({
  scheduledDate: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  instructorId: z.number().int().positive().optional(),
});

const cancelSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required'),
});

const addStudentsSchema = z.object({
  students: z.array(z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email().optional(),
  })).min(1),
});

// --- Helper ---

function handleCourseError(err: unknown, reply: FastifyReply) {
  if (err instanceof CourseError) {
    return reply.status(err.statusCode).send({ error: err.message });
  }
  throw err;
}

// --- Routes ---

export async function courseRoutes(app: FastifyInstance) {
  const courseRepo = new CourseRequestRepository();
  const service = new CourseService(
    courseRepo,
    new CourseStudentRepository(),
    new UserRepository(),
  );

  // =====================
  // Organization endpoints
  // =====================

  // POST /courses/request — org user creates a course request
  app.post('/request', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'Must be associated with an organization' });

    const body = createRequestSchema.parse(request.body);
    try {
      const course = await service.createRequest({ ...body, organizationId: request.userOrgId });
      return { success: true, message: 'Course request submitted successfully', course };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // GET /courses/org/students/:courseId — org user views students
  app.get('/org/students/:courseId', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'Must be associated with an organization' });

    const { courseId } = request.params as { courseId: string };
    try {
      const students = await service.getStudents(parseInt(courseId), request.userOrgId);
      return { success: true, data: students };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // POST /courses/org/students/:courseId — org user adds students
  app.post('/org/students/:courseId', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'Must be associated with an organization' });

    const { courseId } = request.params as { courseId: string };
    const { students } = addStudentsSchema.parse(request.body);
    try {
      const { added, skipped } = await service.addStudents(parseInt(courseId), request.userOrgId, students);
      const message = skipped > 0
        ? `${added} student${added === 1 ? '' : 's'} added, ${skipped} already on this course were skipped`
        : `${added} student${added === 1 ? '' : 's'} added`;
      return { success: true, message, count: added, added, skipped };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // DELETE /courses/org/students/:courseId/:courseStudentId — org user
  // removes a student they mistakenly added (e.g. a duplicate CSV upload).
  app.delete('/org/students/:courseId/:courseStudentId', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'Must be associated with an organization' });

    const { courseId, courseStudentId } = request.params as { courseId: string; courseStudentId: string };
    try {
      await service.removeStudent(parseInt(courseId), request.userOrgId, parseInt(courseStudentId));
      return { success: true, message: 'Student removed' };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // =====================
  // Admin endpoints
  // =====================

  const adminPreHandler = [requireRole('admin', 'sysadmin', 'superadmin')];

  // The four status lists are opt-in paginated: without `page`/`limit` they go
  // through the service exactly as before; with them they run the same query
  // through the repository with LIMIT/OFFSET plus a matching count.

  // GET /courses/pending
  app.get('/pending', { preHandler: adminPreHandler }, async (request) => {
    const query = request.query as Record<string, string>;
    if (isPaginated(query)) return paginatedResponse(await courseRepo.findPending(parsePagination(query)));
    return { success: true, data: await service.getPending() };
  });

  // GET /courses/confirmed
  app.get('/confirmed', { preHandler: adminPreHandler }, async (request) => {
    const query = request.query as Record<string, string>;
    if (isPaginated(query)) return paginatedResponse(await courseRepo.findConfirmed(parsePagination(query)));
    return { success: true, data: await service.getConfirmed() };
  });

  // GET /courses/completed
  app.get('/completed', { preHandler: adminPreHandler }, async (request) => {
    const query = request.query as Record<string, string>;
    if (isPaginated(query)) return paginatedResponse(await courseRepo.findCompleted(parsePagination(query)));
    return { success: true, data: await service.getCompleted() };
  });

  // GET /courses/cancelled
  app.get('/cancelled', { preHandler: adminPreHandler }, async (request) => {
    const query = request.query as Record<string, string>;
    if (isPaginated(query)) return paginatedResponse(await courseRepo.findCancelled(parsePagination(query)));
    return { success: true, data: await service.getCancelled() };
  });

  // PUT /courses/:id/assign-instructor
  app.put('/:id/assign-instructor', { preHandler: adminPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = assignInstructorSchema.parse(request.body);
    try {
      const course = await service.assignInstructor({ courseId: parseInt(id), ...body });
      return { success: true, message: 'Instructor assigned successfully', course };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // PUT /courses/:id/cancel
  app.put('/:id/cancel', { preHandler: adminPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = cancelSchema.parse(request.body);
    try {
      const course = await service.cancel(parseInt(id), reason);
      return { success: true, message: 'Course cancelled successfully', course };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // PUT /courses/:id/schedule — reschedule
  app.put('/:id/schedule', { preHandler: adminPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = rescheduleSchema.parse(request.body);
    try {
      const course = await service.reschedule({ courseId: parseInt(id), ...body });
      return { success: true, message: 'Course rescheduled successfully', course };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // POST /courses/:id/update-reminder
  app.post('/:id/update-reminder', { preHandler: adminPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const course = await service.updateReminder(parseInt(id));
      return { success: true, data: course };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // GET /courses/:id/students — admin and accounting view students
  app.get('/:id/students', { preHandler: [requireRole('admin', 'sysadmin', 'superadmin', 'accountant')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const students = await service.getStudents(parseInt(id));
      return { success: true, data: students };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // =====================
  // Billing endpoints
  // =====================

  // GET /courses/:id/validate-billing
  app.get('/:id/validate-billing', { preHandler: adminPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const validation = await service.validateBillingReadiness(parseInt(id));
      return { success: true, data: validation };
    } catch (err) { return handleCourseError(err, reply); }
  });

  // PUT /courses/:id/ready-for-billing
  app.put('/:id/ready-for-billing', { preHandler: adminPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const course = await service.markReadyForBilling(parseInt(id));
      return { success: true, message: 'Course sent to billing successfully', data: course };
    } catch (err) { return handleCourseError(err, reply); }
  });
}
