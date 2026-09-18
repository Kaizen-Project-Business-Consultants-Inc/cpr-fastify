import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { getPool } from '../config/database.js';
import type { RowDataPacket } from 'mysql2/promise';

const updateProfileSchema = z.object({
  username: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
});

export async function studentRoutes(app: FastifyInstance) {
  const studentRole = [requireRole('student')];

  app.get('/classes', { preHandler: studentRole }, async (request) => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, ct.name as type, ct.description, ct.duration_minutes
       FROM classes c JOIN class_types ct ON c.class_type_id = ct.id
       WHERE c.student_id = ?`,
      [request.userId]
    );
    return { success: true, data: rows };
  });

  app.get('/upcoming-classes', { preHandler: studentRole }, async (request) => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, ct.name as type, ct.description, ct.duration_minutes
       FROM classes c JOIN class_types ct ON c.class_type_id = ct.id
       WHERE c.student_id = ? AND c.start_time > NOW()
       ORDER BY c.start_time ASC`,
      [request.userId]
    );
    return { success: true, data: rows };
  });

  app.get('/completed-classes', { preHandler: studentRole }, async (request) => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, ct.name as type, ct.description, ct.duration_minutes
       FROM classes c JOIN class_types ct ON c.class_type_id = ct.id
       WHERE c.student_id = ? AND c.end_time < NOW()
       ORDER BY c.end_time DESC`,
      [request.userId]
    );
    return { success: true, data: rows };
  });

  app.get('/profile', { preHandler: studentRole }, async (request) => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, full_name, phone FROM users WHERE id = ?',
      [request.userId]
    );
    return { success: true, data: rows[0] ?? null };
  });

  app.put('/profile', { preHandler: studentRole }, async (request) => {
    const { username, email, fullName, phone } = updateProfileSchema.parse(request.body);
    const pool = getPool();
    await pool.query(
      'UPDATE users SET username = ?, email = ?, full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [username, email, fullName ?? null, phone ?? null, request.userId]
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, full_name, phone FROM users WHERE id = ?',
      [request.userId]
    );
    return { success: true, data: rows[0] };
  });

  app.get('/enrollments', { preHandler: studentRole }, async (request) => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM enrollments WHERE student_id = ? ORDER BY created_at DESC',
      [request.userId]
    );
    return { success: true, data: rows };
  });
}
