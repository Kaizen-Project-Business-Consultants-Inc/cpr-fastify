import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { CourseService, CourseError } from '../services/CourseService.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { requireRole } from '../plugins/auth.js';
import type { RowDataPacket } from 'mysql2/promise';

const scheduleSchema = z.object({
  instructorId: z.number().int().positive(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function courseAdminRoutes(app: FastifyInstance) {
  const pool = getPool();
  const courseService = new CourseService(
    new CourseRequestRepository(),
    new CourseStudentRepository(),
    new UserRepository(),
  );
  const adminRole = [requireRole('admin', 'sysadmin', 'courseadmin')];

  // Get instructors for scheduling
  app.get('/instructors', { preHandler: adminRole }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, email, first_name, last_name
       FROM users WHERE role = 'instructor' AND status = 'active' ORDER BY username`
    );
    return { success: true, data: rows };
  });

  // Schedule a course (assign instructor + times) — delegates to CourseService
  // for conflict detection, availability update, and classes table entry
  app.post('/courses/:id/schedule', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = scheduleSchema.parse(request.body);

    try {
      const course = await courseService.assignInstructor({
        courseId: parseInt(id),
        instructorId: data.instructorId,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      return { success: true, message: 'Course scheduled successfully', data: course };
    } catch (err) {
      if (err instanceof CourseError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
