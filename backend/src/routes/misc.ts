import { FastifyInstance } from 'fastify';
import { getPool } from '../config/database.js';
import { requireAuth } from '../plugins/auth.js';
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

  // GET /instructors — flat route for instructor list
  app.get('/instructors', { preHandler: [requireAuth] }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, email, first_name, last_name, phone, mobile
       FROM users WHERE role = 'instructor' AND status = 'active' ORDER BY username`
    );
    return { success: true, data: rows };
  });
}
