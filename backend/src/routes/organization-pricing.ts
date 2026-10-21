import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { logAudit } from '../utils/auditLog.js';
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

    // The frontend reads these in camelCase (pricing.pricePerStudent,
    // .isActive, .classTypeName, .classTypeId, .updatedAt); op.* alone left
    // them undefined. isActive is a TINYINT, so it arrives as 0/1.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT op.*, ct.name as class_type_name, ct.name as classTypeName,
              ct.duration_minutes, ct.duration_minutes as durationMinutes,
              o.name as organization_name, o.name as organizationName,
              op.price_per_student as pricePerStudent, op.is_active as isActive,
              op.class_type_id as classTypeId, op.updated_at as updatedAt
       FROM organization_pricing op
       JOIN class_types ct ON op.class_type_id = ct.id
       JOIN organizations o ON op.organization_id = o.id
       WHERE op.organization_id = ?
       ORDER BY ct.name`,
      [orgId]
    );
    return { success: true, data: rows };
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
      `SELECT op.*, ct.name as class_type_name, ct.name as classTypeName,
              ct.duration_minutes, ct.duration_minutes as durationMinutes,
              o.name as organization_name, o.name as organizationName,
              op.price_per_student as pricePerStudent, op.is_active as isActive,
              op.class_type_id as classTypeId, op.updated_at as updatedAt
       FROM organization_pricing op
       JOIN class_types ct ON op.class_type_id = ct.id
       JOIN organizations o ON op.organization_id = o.id
       ${where} ORDER BY o.name, ct.name`,
      params
    );
    return { success: true, data: rows };
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
    logAudit({ userId: request.userId, action: 'create_organization_pricing', entityType: 'organization_pricing', entityId: result.insertId, details: { organizationId: data.organizationId, classTypeId: data.classTypeId, pricePerStudent: data.pricePerStudent }, ipAddress: request.ip });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT *, price_per_student as pricePerStudent, is_active as isActive FROM organization_pricing WHERE id = ?', [result.insertId]);
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
    logAudit({ userId: request.userId, action: 'update_organization_pricing', entityType: 'organization_pricing', entityId: parseInt(id), details: { pricePerStudent: data.pricePerStudent, isActive: data.isActive }, ipAddress: request.ip });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT *, price_per_student as pricePerStudent, is_active as isActive FROM organization_pricing WHERE id = ?', [parseInt(id)]);
    return { success: true, data: rows[0], message: 'Organization pricing updated successfully' };
  });

  // Delete pricing
  app.delete('/admin/:id', { preHandler: sysadminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM organization_pricing WHERE id = ?', [parseInt(id)]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Organization pricing not found' });
    logAudit({ userId: request.userId, action: 'delete_organization_pricing', entityType: 'organization_pricing', entityId: parseInt(id), ipAddress: request.ip });
    return { success: true, message: 'Organization pricing deleted successfully' };
  });
}
