import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { httpError } from '../utils/httpError.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const createTierSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  base_hourly_rate: z.number().positive(),
  course_bonus: z.number().positive().default(50),
});

const setRateSchema = z.object({
  hourly_rate: z.number().positive(),
  course_bonus: z.number().positive().default(50),
  tier_id: z.number().int().positive().optional(),
  effective_date: z.string().optional(),
  notes: z.string().optional(),
  change_reason: z.string().optional(),
});

const bulkUpdateSchema = z.object({
  instructor_ids: z.array(z.number().int().positive()).min(1),
  hourly_rate: z.number().positive(),
  course_bonus: z.number().positive().default(50),
  tier_id: z.number().int().positive().optional(),
  effective_date: z.string().optional(),
  notes: z.string().optional(),
  change_reason: z.string().optional(),
});

export async function payRateRoutes(app: FastifyInstance) {
  const pool = getPool();
  const hrRole = [requireRole('hr')];

  // ===== Tiers =====
  app.get('/tiers', { preHandler: hrRole }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM pay_rate_tiers WHERE is_active = true ORDER BY base_hourly_rate ASC'
    );
    return { success: true, data: rows };
  });

  app.post('/tiers', { preHandler: hrRole }, async (request) => {
    const data = createTierSchema.parse(request.body);
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO pay_rate_tiers (name, description, base_hourly_rate, course_bonus) VALUES (?, ?, ?, ?)',
      [data.name, data.description ?? null, data.base_hourly_rate, data.course_bonus]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM pay_rate_tiers WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Pay rate tier created successfully.', data: rows[0] };
  });

  app.put('/tiers/:id', { preHandler: hrRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, description, base_hourly_rate, course_bonus, is_active } = createTierSchema.extend({
      is_active: z.boolean().optional(),
    }).partial().parse(request.body);
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE pay_rate_tiers SET name = COALESCE(?, name), description = COALESCE(?, description),
       base_hourly_rate = COALESCE(?, base_hourly_rate), course_bonus = COALESCE(?, course_bonus),
       is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name ?? null, description ?? null, base_hourly_rate ?? null, course_bonus ?? null, is_active ?? null, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Pay rate tier not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM pay_rate_tiers WHERE id = ?', [id]);
    return { success: true, message: 'Pay rate tier updated successfully.', data: rows[0] };
  });

  // ===== Instructor pay rates listing =====
  app.get('/instructors', { preHandler: hrRole }, async (request) => {
    const { page = '1', limit = '10', search = '', has_rate = '' } = request.query as Record<string, string>;
    const safeLimit = Math.min(parseInt(limit), 100);
    const offset = (parseInt(page) - 1) * safeLimit;

    let where = "WHERE u.role = 'instructor' AND u.status = 'active'";
    const params: unknown[] = [];
    if (search) { where += ' AND (u.username LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (has_rate === 'true') where += ' AND ipr.id IS NOT NULL';
    else if (has_rate === 'false') where += ' AND ipr.id IS NULL';

    // PayRateManagement.tsx reads these in camelCase.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.phone,
              ipr.hourly_rate, ipr.hourly_rate as hourlyRate,
              ipr.course_bonus, ipr.course_bonus as courseBonus,
              ipr.effective_date, ipr.effective_date as effectiveDate,
              ipr.is_active as rate_active,
              prt.name as tier_name, prt.name as tierName,
              prt.description as tier_description, prt.description as tierDescription,
              CASE WHEN ipr.id IS NOT NULL THEN 'Set' ELSE 'Not Set' END as rate_status
       FROM users u
       LEFT JOIN instructor_pay_rates ipr ON u.id = ipr.instructor_id AND ipr.is_active = true
         AND (ipr.end_date IS NULL OR ipr.end_date >= CURRENT_DATE)
       LEFT JOIN pay_rate_tiers prt ON ipr.tier_id = prt.id
       ${where} ORDER BY u.username LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users u
       LEFT JOIN instructor_pay_rates ipr ON u.id = ipr.instructor_id AND ipr.is_active = true
         AND (ipr.end_date IS NULL OR ipr.end_date >= CURRENT_DATE)
       ${where}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    return {
      success: true,
      data: { instructors: rows, pagination: { page: parseInt(page), limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } },
    };
  });

  // ===== Individual instructor rate =====
  app.get('/instructors/:instructorId', { preHandler: hrRole }, async (request, reply) => {
    const { instructorId } = request.params as { instructorId: string };

    const [[currentRate], [history], [instructor]] = await Promise.all([
      // PayRateManagement.tsx's history dialog reads currentRate/history in
      // camelCase; ipr.*/prh.* alone left every field but the id undefined.
      pool.query<RowDataPacket[]>(
        `SELECT ipr.*, prt.name as tier_name, prt.name as tierName,
                prt.description as tier_description, prt.description as tierDescription,
                u.username as instructor_name, u.email as instructor_email,
                ipr.hourly_rate as hourlyRate, ipr.course_bonus as courseBonus,
                ipr.effective_date as effectiveDate, ipr.end_date as endDate,
                ipr.instructor_id as instructorId, ipr.tier_id as tierId,
                ipr.is_active as isActive, ipr.created_by as createdBy,
                ipr.created_at as createdAt, ipr.updated_at as updatedAt
         FROM instructor_pay_rates ipr
         LEFT JOIN pay_rate_tiers prt ON ipr.tier_id = prt.id
         JOIN users u ON ipr.instructor_id = u.id
         WHERE ipr.instructor_id = ? AND ipr.is_active = true
         AND (ipr.end_date IS NULL OR ipr.end_date >= CURRENT_DATE)
         ORDER BY ipr.effective_date DESC LIMIT 1`,
        [instructorId]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT prh.*, prt_old.name as old_tier_name, prt_old.name as oldTierName,
                prt_new.name as new_tier_name, prt_new.name as newTierName,
                u_changed.username as changed_by_name, u_changed.username as changedByName,
                prh.old_hourly_rate as oldHourlyRate, prh.new_hourly_rate as newHourlyRate,
                prh.old_course_bonus as oldCourseBonus, prh.new_course_bonus as newCourseBonus,
                prh.effective_date as effectiveDate, prh.change_reason as changeReason
         FROM pay_rate_history prh
         LEFT JOIN pay_rate_tiers prt_old ON prh.old_tier_id = prt_old.id
         LEFT JOIN pay_rate_tiers prt_new ON prh.new_tier_id = prt_new.id
         LEFT JOIN users u_changed ON prh.changed_by = u_changed.id
         WHERE prh.instructor_id = ? ORDER BY prh.effective_date DESC, prh.created_at DESC LIMIT 20`,
        [instructorId]
      ),
      pool.query<RowDataPacket[]>('SELECT id, username, email, phone FROM users WHERE id = ?', [instructorId]),
    ]);

    if (instructor.length === 0) return reply.status(404).send({ error: 'Instructor not found' });
    return { success: true, data: { instructor: instructor[0], currentRate: currentRate[0] ?? null, history } };
  });

  // ===== Set instructor pay rate =====
  app.post('/instructors/:instructorId', { preHandler: hrRole }, async (request, reply) => {
    const { instructorId } = request.params as { instructorId: string };
    const data = setRateSchema.parse(request.body);
    const effectiveDate = data.effective_date ?? new Date().toISOString().split('T')[0];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [instrCheck] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE id = ? AND role = 'instructor'", [instructorId]
      );
      if (instrCheck.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Instructor not found' }); }

      // Deactivate current rate
      await conn.query(
        `UPDATE instructor_pay_rates SET end_date = ?, is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE instructor_id = ? AND is_active = true AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
        [effectiveDate, instructorId]
      );

      // Get old rate for history
      const [oldRates] = await conn.query<RowDataPacket[]>(
        `SELECT hourly_rate, course_bonus, tier_id FROM instructor_pay_rates
         WHERE instructor_id = ? AND is_active = false ORDER BY effective_date DESC LIMIT 1`,
        [instructorId]
      );
      const old = oldRates[0];

      // Insert new rate
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO instructor_pay_rates (instructor_id, tier_id, hourly_rate, course_bonus, effective_date, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [instructorId, data.tier_id ?? null, data.hourly_rate, data.course_bonus, effectiveDate, data.notes ?? null, request.userId]
      );

      // Record history
      await conn.query(
        `INSERT INTO pay_rate_history (instructor_id, old_hourly_rate, new_hourly_rate,
         old_course_bonus, new_course_bonus, old_tier_id, new_tier_id, change_reason, changed_by, effective_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [instructorId, old?.hourly_rate ?? null, data.hourly_rate, old?.course_bonus ?? null, data.course_bonus,
         old?.tier_id ?? null, data.tier_id ?? null, data.change_reason ?? null, request.userId, effectiveDate]
      );

      await conn.commit();
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM instructor_pay_rates WHERE id = ?', [result.insertId]);
      return { success: true, message: 'Instructor pay rate set successfully.', data: rows[0] };
    } catch (err) {
      await conn.rollback();
      const { statusCode, message } = httpError(err);
      request.log.error({ err }, 'Failed to set instructor pay rate');
      return reply.status(statusCode).send({ error: message });
    } finally { conn.release(); }
  });

  // ===== Current rate for payroll =====
  app.get('/instructors/:instructorId/current', { preHandler: hrRole }, async (request) => {
    const { instructorId } = request.params as { instructorId: string };
    const { date = new Date().toISOString().split('T')[0] } = request.query as { date?: string };

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ipr.hourly_rate, ipr.course_bonus, prt.name as tier_name
       FROM instructor_pay_rates ipr
       LEFT JOIN pay_rate_tiers prt ON ipr.tier_id = prt.id
       WHERE ipr.instructor_id = ? AND ipr.is_active = true AND ipr.effective_date <= ?
       AND (ipr.end_date IS NULL OR ipr.end_date >= ?)
       ORDER BY ipr.effective_date DESC LIMIT 1`,
      [instructorId, date, date]
    );

    if (rows.length === 0) {
      return { success: true, data: { hourly_rate: 25.00, course_bonus: 50.00, tier_name: 'Default', is_default: true } };
    }
    return { success: true, data: { ...rows[0], is_default: false } };
  });

  // ===== Bulk update =====
  app.post('/bulk-update', { preHandler: hrRole }, async (request) => {
    const data = bulkUpdateSchema.parse(request.body);
    const effectiveDate = data.effective_date ?? new Date().toISOString().split('T')[0];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Get old rates
      const placeholders = data.instructor_ids.map(() => '?').join(', ');
      const [oldRates] = await conn.query<RowDataPacket[]>(
        `SELECT ipr.instructor_id, ipr.hourly_rate, ipr.course_bonus, ipr.tier_id
         FROM instructor_pay_rates ipr
         INNER JOIN (
           SELECT instructor_id, MAX(effective_date) as max_date
           FROM instructor_pay_rates WHERE instructor_id IN (${placeholders}) AND is_active = true
           GROUP BY instructor_id
         ) latest ON ipr.instructor_id = latest.instructor_id AND ipr.effective_date = latest.max_date AND ipr.is_active = true`,
        data.instructor_ids
      );
      const oldMap = new Map(oldRates.map((r) => [r.instructor_id, r]));

      // Deactivate current rates
      await conn.query(
        `UPDATE instructor_pay_rates SET end_date = ?, is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE instructor_id IN (${placeholders}) AND is_active = true AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
        [effectiveDate, ...data.instructor_ids]
      );

      // Insert new rates + history
      for (const id of data.instructor_ids) {
        await conn.query(
          `INSERT INTO instructor_pay_rates (instructor_id, tier_id, hourly_rate, course_bonus, effective_date, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, data.tier_id ?? null, data.hourly_rate, data.course_bonus, effectiveDate, data.notes ?? null, request.userId]
        );
        const old = oldMap.get(id);
        await conn.query(
          `INSERT INTO pay_rate_history (instructor_id, old_hourly_rate, new_hourly_rate,
           old_course_bonus, new_course_bonus, old_tier_id, new_tier_id, change_reason, changed_by, effective_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, old?.hourly_rate ?? null, data.hourly_rate, old?.course_bonus ?? null, data.course_bonus,
           old?.tier_id ?? null, data.tier_id ?? null, data.change_reason ?? null, request.userId, effectiveDate]
        );
      }

      await conn.commit();

      const [newRates] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM instructor_pay_rates WHERE instructor_id IN (${placeholders}) AND is_active = true AND effective_date = ?`,
        [...data.instructor_ids, effectiveDate]
      );
      return { success: true, data: newRates };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });
}
