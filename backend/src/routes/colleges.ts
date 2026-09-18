import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const collegeBodySchema = z.object({
  name: z.string().min(1).max(200),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function collegeRoutes(app: FastifyInstance) {
  const pool = getPool();
  const adminRole = [requireRole('admin', 'sysadmin')];

  // Get active colleges (for dropdowns)
  app.get('/', { preHandler: [requireAuth] }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name FROM colleges WHERE is_active = true ORDER BY name'
    );
    return { success: true, data: rows };
  });

  // Get all colleges including inactive (admin)
  app.get('/all', { preHandler: adminRole }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, is_active, created_at, updated_at FROM colleges ORDER BY name'
    );
    return { success: true, data: rows };
  });

  // Create college
  app.post('/', { preHandler: adminRole }, async (request, reply) => {
    const { name } = collegeBodySchema.parse(request.body);

    const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM colleges WHERE LOWER(name) = LOWER(?)', [name.trim()]);
    if (existing.length > 0) return reply.status(400).send({ error: 'College with this name already exists' });

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO colleges (name) VALUES (?)', [name.trim()]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM colleges WHERE id = ?', [result.insertId]);
    return { success: true, data: rows[0] };
  });

  // Update college
  app.put('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, is_active, isActive } = collegeBodySchema.partial().parse(request.body);
    const activeValue = isActive !== undefined ? isActive : is_active;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()); }
    if (activeValue !== undefined) { sets.push('is_active = ?'); params.push(activeValue); }
    if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(parseInt(id));

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE colleges SET ${sets.join(', ')} WHERE id = ?`, params
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'College not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM colleges WHERE id = ?', [parseInt(id)]);
    return { success: true, data: rows[0] };
  });

  // Delete college
  app.delete('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM colleges WHERE id = ?', [parseInt(id)]);
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'College not found' });
    return { success: true, data: { deleted: true, id: parseInt(id) } };
  });
}
