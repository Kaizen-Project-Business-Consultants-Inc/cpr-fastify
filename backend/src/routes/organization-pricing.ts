import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { getHSTRate } from '../utils/taxConfig.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const createPricingSchema = z.object({
  organizationId: z.number().int().positive(),
  classTypeId: z.number().int().positive(),
  pricePerStudent: z.number().min(0),
});

const updatePricingSchema = z.object({
  pricePerStudent: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

const calculateCostSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  classTypeId: z.coerce.number().int().positive(),
  studentCount: z.coerce.number().int().min(0),
});

export async function organizationPricingRoutes(app: FastifyInstance) {
  const pool = getPool();
  const sysadminRole = [requireRole('sysadmin')];

  // Get pricing for a specific organization
  app.get('/organization/:organizationId', { preHandler: [requireAuth] }, async (request, reply) => {
    const { organizationId } = request.params as { organizationId: string };
    const orgId = parseInt(organizationId);

    // Check access
    if (request.userRole !== 'sysadmin' && request.userOrgId !== orgId) {
      return reply.status(403).send({ error: 'Access denied to this organization' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT op.*, ct.name as class_type_name, ct.duration_minutes, o.name as organization_name
       FROM organization_pricing op
       JOIN class_types ct ON op.class_type_id = ct.id
       JOIN organizations o ON op.organization_id = o.id
       WHERE op.organization_id = ?
       ORDER BY ct.name`,
      [orgId]
    );
    return { success: true, data: rows };
  });

  // Get pricing for a specific course at an org
  app.get('/course-pricing/:organizationId/:classTypeId', { preHandler: [requireAuth] }, async (request, reply) => {
    const { organizationId, classTypeId } = request.params as { organizationId: string; classTypeId: string };
    const orgId = parseInt(organizationId);

    if (request.userRole !== 'sysadmin' && request.userOrgId !== orgId) {
      return reply.status(403).send({ error: 'Access denied to this organization' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT op.*, ct.name as class_type_name, o.name as organization_name
       FROM organization_pricing op
       JOIN class_types ct ON op.class_type_id = ct.id
       JOIN organizations o ON op.organization_id = o.id
       WHERE op.organization_id = ? AND op.class_type_id = ?`,
      [orgId, parseInt(classTypeId)]
    );
    return { success: true, data: rows[0] ?? null };
  });

  // Calculate course cost
  app.post('/calculate-cost', { preHandler: [requireAuth] }, async (request, reply) => {
    const { organizationId, classTypeId, studentCount } = calculateCostSchema.parse(request.body);

    if (request.userRole !== 'sysadmin' && request.userOrgId !== organizationId) {
      return reply.status(403).send({ error: 'Access denied to this organization' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT price_per_student FROM organization_pricing WHERE organization_id = ? AND class_type_id = ? AND is_active = true',
      [organizationId, classTypeId]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Pricing not found' });

    const pricePerStudent = Number(rows[0].price_per_student);
    const subtotal = pricePerStudent * studentCount;
    const hst = subtotal * getHSTRate();
    const total = subtotal + hst;

    return { success: true, data: { pricePerStudent, studentCount, subtotal, hst, total } };
  });

  // ===== Admin CRUD (sysadmin only) =====

  // Get all org pricing (with optional filters)
  app.get('/admin', { preHandler: sysadminRole }, async (request) => {
    const { organizationId, classTypeId, isActive } = request.query as Record<string, string>;
    let where = '';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (organizationId) { conditions.push('op.organization_id = ?'); params.push(parseInt(organizationId)); }
    if (classTypeId) { conditions.push('op.class_type_id = ?'); params.push(parseInt(classTypeId)); }
    if (isActive !== undefined) { conditions.push('op.is_active = ?'); params.push(isActive === 'true'); }
    if (conditions.length > 0) where = 'WHERE ' + conditions.join(' AND ');

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT op.*, ct.name as class_type_name, ct.duration_minutes, o.name as organization_name
       FROM organization_pricing op
       JOIN class_types ct ON op.class_type_id = ct.id
       JOIN organizations o ON op.organization_id = o.id
       ${where} ORDER BY o.name, ct.name`,
      params
    );
    return { success: true, data: rows };
  });

  // Get single pricing by id
  app.get('/admin/:id', { preHandler: sysadminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT op.*, ct.name as class_type_name, o.name as organization_name
       FROM organization_pricing op
       JOIN class_types ct ON op.class_type_id = ct.id
       JOIN organizations o ON op.organization_id = o.id
       WHERE op.id = ?`,
      [parseInt(id)]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Organization pricing not found' });
    return { success: true, data: rows[0] };
  });

  // Create pricing
  app.post('/admin', { preHandler: sysadminRole }, async (request, reply) => {
    const data = createPricingSchema.parse(request.body);

    // Check for duplicate
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM organization_pricing WHERE organization_id = ? AND class_type_id = ?',
      [data.organizationId, data.classTypeId]
    );
    if (existing.length > 0) {
      return reply.status(400).send({ error: 'Pricing already exists for this organization and course type' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO organization_pricing (organization_id, class_type_id, price_per_student, created_by)
       VALUES (?, ?, ?, ?)`,
      [data.organizationId, data.classTypeId, data.pricePerStudent, request.userId]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM organization_pricing WHERE id = ?', [result.insertId]);
    return { success: true, data: rows[0], message: 'Organization pricing created successfully' };
  });

  // Update pricing
  app.put('/admin/:id', { preHandler: sysadminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updatePricingSchema.parse(request.body);

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE organization_pricing SET
       price_per_student = COALESCE(?, price_per_student),
       is_active = COALESCE(?, is_active),
       last_modified_by = ?,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [data.pricePerStudent ?? null, data.isActive ?? null, request.userId, parseInt(id)]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Organization pricing not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM organization_pricing WHERE id = ?', [parseInt(id)]);
    return { success: true, data: rows[0], message: 'Organization pricing updated successfully' };
  });

  // Delete pricing
  app.delete('/admin/:id', { preHandler: sysadminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM organization_pricing WHERE id = ?', [parseInt(id)]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Organization pricing not found' });
    return { success: true, message: 'Organization pricing deleted successfully' };
  });
}
