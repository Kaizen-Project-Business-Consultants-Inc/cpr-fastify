import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { logAudit } from '../utils/auditLog.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const collegeBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

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

    const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM colleges WHERE LOWER(name) = LOWER(?)', [name]);
    if (existing.length > 0) return reply.status(400).send({ error: 'College with this name already exists' });

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO colleges (name) VALUES (?)', [name]
    );
    logAudit({ userId: request.userId, action: 'college_created', entityType: 'college', entityId: result.insertId, details: { name }, ipAddress: request.ip });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM colleges WHERE id = ?', [result.insertId]);
    return { success: true, data: rows[0] };
  });

  // Update college
  app.put('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { name, is_active, isActive } = collegeBodySchema.partial().parse(request.body);
    const activeValue = isActive !== undefined ? isActive : is_active;

    const [before] = await pool.query<RowDataPacket[]>('SELECT name, is_active FROM colleges WHERE id = ?', [id]);
    if (before.length === 0) return reply.status(404).send({ error: 'College not found' });

    const sets: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined) {
      const [dupe] = await pool.query<RowDataPacket[]>('SELECT id FROM colleges WHERE LOWER(name) = LOWER(?) AND id <> ?', [name, id]);
      if (dupe.length > 0) return reply.status(400).send({ error: 'College with this name already exists' });
      sets.push('name = ?'); params.push(name);
    }
    if (activeValue !== undefined) { sets.push('is_active = ?'); params.push(activeValue); }
    if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await pool.query<ResultSetHeader>(`UPDATE colleges SET ${sets.join(', ')} WHERE id = ?`, params);
    logAudit({
      userId: request.userId, action: 'college_updated', entityType: 'college', entityId: id,
      details: { before: { name: before[0].name, isActive: !!before[0].is_active }, name, isActive: activeValue },
      ipAddress: request.ip,
    });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM colleges WHERE id = ?', [id]);
    return { success: true, data: rows[0] };
  });

  // Delete college
  app.delete('/:id', { preHandler: adminRole }, async (request, reply) => {
    // Students keep their own copy of the college name, so deleting never changes their records.
    const { id } = idParams.parse(request.params);
    const [before] = await pool.query<RowDataPacket[]>('SELECT name FROM colleges WHERE id = ?', [id]);
    if (before.length === 0) return reply.status(404).send({ error: 'College not found' });
    await pool.query<ResultSetHeader>('DELETE FROM colleges WHERE id = ?', [id]);
    logAudit({ userId: request.userId, action: 'college_deleted', entityType: 'college', entityId: id, details: { name: before[0].name }, ipAddress: request.ip });
    return { success: true, data: { deleted: true, id } };
  });
}
