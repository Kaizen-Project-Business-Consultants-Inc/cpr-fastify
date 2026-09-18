import { FastifyInstance } from 'fastify';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import type { RowDataPacket } from 'mysql2/promise';

export async function miscRoutes(app: FastifyInstance) {
  const pool = getPool();

  // GET /course-types — flat route for dropdowns
  app.get('/course-types', { preHandler: [requireAuth] }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, description, duration_minutes FROM class_types ORDER BY name'
    );
    return { success: true, data: rows };
  });

  // GET /classes — flat route listing all course requests (used by admin/courseadmin)
  app.get('/classes', { preHandler: [requireRole('admin', 'sysadmin', 'courseadmin')] }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.*, ct.name as course_type_name, o.name as organization_name,
              u.username as instructor_name
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       ORDER BY cr.scheduled_date DESC`
    );
    return { success: true, data: rows };
  });

  // GET /instructors — flat route for instructor list
  app.get('/instructors', { preHandler: [requireAuth] }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, email, first_name, last_name, phone, mobile
       FROM users WHERE role = 'instructor' AND status = 'active' ORDER BY username`
    );
    return { success: true, data: rows };
  });

  // GET /dashboard — generic dashboard redirect based on role
  app.get('/dashboard', { preHandler: [requireAuth] }, async (request) => {
    return { success: true, data: { role: request.userRole, message: 'Use role-specific dashboard endpoint' } };
  });
}
