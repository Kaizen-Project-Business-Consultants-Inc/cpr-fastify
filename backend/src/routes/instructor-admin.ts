import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireRole } from '../plugins/auth.js';
import { logAudit } from '../utils/auditLog.js';

/**
 * Admin-side instructor management, mounted at the API root (no prefix) because
 * the course-admin UI (InstructorManagement.tsx) calls `/instructors/...` directly.
 * The instructor's own self-service routes live under `/instructor` (instructors.ts).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** How many weekly occurrences a weekday-name slot expands to. */
const WEEKDAY_EXPANSION_WEEKS = 8;

const isoDate = z.string().regex(DATE_RE, 'Expected YYYY-MM-DD');

const createInstructorSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.@-]+$/),
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  mobile: z.string().max(50).optional(),
});

const updateInstructorSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.@-]+$/).optional(),
  email: z.string().email().optional(),
  // The edit form re-sends the password field, usually empty. Empty means "leave as is".
  password: z.union([z.literal(''), z.string().min(8)]).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).nullable().optional(),
  mobile: z.string().max(50).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

// The admin UI sends { day: 'Monday', startTime, endTime } slots; other callers send
// { date: 'YYYY-MM-DD' }. Accept both — `day` may be a weekday name or an ISO date.
const availabilitySlotSchema = z.object({
  date: isoDate.optional(),
  day: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  status: z.string().max(20).optional(),
}).refine((s) => s.date || s.day, { message: 'Each slot needs a date or day' });

const putAvailabilitySchema = z.object({
  availability: z.array(availabilitySlotSchema),
  // When true, existing future availability is wiped before inserting (the
  // instructor's own PUT /instructor/availability behaves this way). Default: merge.
  replace: z.boolean().optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Expand a slot into concrete YYYY-MM-DD dates. */
function slotDates(slot: z.infer<typeof availabilitySlotSchema>, from: Date): string[] {
  const raw = slot.date ?? slot.day ?? '';
  if (DATE_RE.test(raw)) return [raw];
  const weekday = WEEKDAYS.indexOf(raw.trim().toLowerCase());
  if (weekday === -1) return [];
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const delta = (weekday - start.getUTCDay() + 7) % 7;
  const dates: string[] = [];
  for (let week = 0; week < WEEKDAY_EXPANSION_WEEKS; week++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + delta + week * 7);
    dates.push(toIsoDate(d));
  }
  return dates;
}

const INSTRUCTOR_COLUMNS = `id, username, email, first_name, last_name, phone, mobile, status, created_at, updated_at`;

export async function instructorAdminRoutes(app: FastifyInstance) {
  const pool = getPool();
  const manageRole = [requireRole('admin', 'sysadmin', 'superadmin', 'courseadmin')];

  async function findInstructor(id: number) {
    const [rows] = await pool.query<any[]>(
      `SELECT ${INSTRUCTOR_COLUMNS} FROM users WHERE id = ? AND role = 'instructor'`, [id]
    );
    return rows[0] ?? null;
  }

  // POST /instructors — create an instructor account
  app.post('/instructors', { preHandler: manageRole }, async (request, reply) => {
    const data = createInstructorSchema.parse(request.body);

    const [dupes] = await pool.query<any[]>(
      'SELECT id FROM users WHERE username = ? OR email = ?', [data.username, data.email]
    );
    if (dupes.length > 0) return reply.status(400).send({ error: 'Username or email already exists' });

    const hash = await bcrypt.hash(data.password, env.BCRYPT_SALT_ROUNDS);
    const [result] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, mobile, status)
       VALUES (?, ?, ?, 'instructor', ?, ?, ?, ?, 'active')`,
      [data.username, data.email, hash, data.firstName ?? null, data.lastName ?? null,
       data.phone ?? null, data.mobile ?? null]
    );
    const created = await findInstructor(result.insertId);
    logAudit({ userId: request.userId, action: 'create_instructor', entityType: 'user', entityId: result.insertId, details: { username: data.username, email: data.email }, ipAddress: request.ip });
    return { success: true, message: 'Instructor created successfully', data: created };
  });

  // PUT /instructors/:id — update an instructor's details
  app.put('/instructors/:id', { preHandler: manageRole }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const data = updateInstructorSchema.parse(request.body);

    const existing = await findInstructor(id);
    if (!existing) return reply.status(404).send({ error: 'Instructor not found' });

    if (data.username || data.email) {
      const [dupes] = await pool.query<any[]>(
        'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
        [data.username ?? existing.username, data.email ?? existing.email, id]
      );
      if (dupes.length > 0) return reply.status(400).send({ error: 'Username or email already exists' });
    }

    const hash = data.password ? await bcrypt.hash(data.password, env.BCRYPT_SALT_ROUNDS) : null;
    await pool.query(
      `UPDATE users SET username = COALESCE(?, username), email = COALESCE(?, email),
       first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
       phone = COALESCE(?, phone), mobile = COALESCE(?, mobile),
       status = COALESCE(?, status), password_hash = COALESCE(?, password_hash),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND role = 'instructor'`,
      [data.username ?? null, data.email ?? null, data.firstName ?? null, data.lastName ?? null,
       data.phone ?? null, data.mobile ?? null, data.status ?? null, hash, id]
    );
    const updated = await findInstructor(id);
    logAudit({ userId: request.userId, action: 'update_instructor', entityType: 'user', entityId: id, details: { username: data.username, email: data.email, status: data.status, passwordChanged: !!hash }, ipAddress: request.ip });
    return { success: true, message: 'Instructor updated successfully', data: updated };
  });

  // DELETE /instructors/:id — soft delete (status = inactive)
  app.delete('/instructors/:id', { preHandler: manageRole }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [result] = await pool.query<any>(
      `UPDATE users SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'instructor'`,
      [id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Instructor not found' });
    logAudit({ userId: request.userId, action: 'deactivate_instructor', entityType: 'user', entityId: id, ipAddress: request.ip });
    return { success: true, message: 'Instructor deactivated successfully' };
  });

  // GET /instructors/:id/availability
  app.get('/instructors/:id/availability', { preHandler: manageRole }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!(await findInstructor(id))) return reply.status(404).send({ error: 'Instructor not found' });
    const [rows] = await pool.query<any[]>(
      `SELECT id, instructor_id, date, status, created_at, updated_at
       FROM instructor_availability WHERE instructor_id = ? ORDER BY date ASC`,
      [id]
    );
    return {
      success: true,
      data: rows.map((r) => ({ ...r, date: r.date ? toIsoDate(new Date(r.date)) : null })),
    };
  });

  // PUT /instructors/:id/availability — add (or replace) availability dates
  app.put('/instructors/:id/availability', { preHandler: manageRole }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { availability, replace } = putAvailabilitySchema.parse(request.body);
    if (!(await findInstructor(id))) return reply.status(404).send({ error: 'Instructor not found' });

    const today = new Date();
    const dates = new Set<string>();
    for (const slot of availability) for (const d of slotDates(slot, today)) dates.add(d);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (replace) {
        await conn.query('DELETE FROM instructor_availability WHERE instructor_id = ? AND date >= CURDATE()', [id]);
      }
      for (const date of dates) {
        const [existing] = await conn.query<any[]>(
          'SELECT id FROM instructor_availability WHERE instructor_id = ? AND date = ?', [id, date]
        );
        if (existing.length === 0) {
          await conn.query(
            `INSERT INTO instructor_availability (instructor_id, date, status) VALUES (?, ?, 'available')`,
            [id, date]
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const [rows] = await pool.query<any[]>(
      'SELECT id, instructor_id, date, status FROM instructor_availability WHERE instructor_id = ? ORDER BY date ASC',
      [id]
    );
    logAudit({ userId: request.userId, action: 'update_instructor_availability', entityType: 'user', entityId: id, details: { added: [...dates], replace: !!replace }, ipAddress: request.ip });
    return {
      success: true,
      message: 'Availability updated successfully',
      data: rows.map((r) => ({ ...r, date: r.date ? toIsoDate(new Date(r.date)) : null })),
    };
  });

  // DELETE /instructors/:id/availability/:date
  app.delete('/instructors/:id/availability/:date', { preHandler: manageRole }, async (request, reply) => {
    const { id, date } = idParam.extend({ date: isoDate }).parse(request.params);

    // Refuse when a confirmed course is already scheduled for that day — the
    // instructor must be unassigned first, otherwise the schedule silently lies.
    const [confirmed] = await pool.query<any[]>(
      `SELECT id FROM course_requests
       WHERE instructor_id = ? AND status = 'confirmed' AND DATE(confirmed_date) = ? AND deleted_at IS NULL`,
      [id, date]
    );
    if (confirmed.length > 0) {
      return reply.status(409).send({ error: `Instructor has a confirmed course on ${date}; reassign it before removing availability` });
    }

    const [result] = await pool.query<any>(
      'DELETE FROM instructor_availability WHERE instructor_id = ? AND date = ?', [id, date]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Availability not found' });
    logAudit({ userId: request.userId, action: 'delete_instructor_availability', entityType: 'user', entityId: id, details: { date }, ipAddress: request.ip });
    return { success: true, message: 'Availability removed successfully' };
  });

  // GET /instructors/:id/schedule — confirmed / completed courses for the instructor
  app.get('/instructors/:id/schedule', { preHandler: manageRole }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!(await findInstructor(id))) return reply.status(404).send({ error: 'Instructor not found' });
    const [rows] = await pool.query<any[]>(
      `SELECT cr.id, cr.status, cr.confirmed_date, cr.scheduled_date,
              cr.confirmed_start_time, cr.confirmed_end_time,
              cr.location, cr.notes, cr.registered_students,
              ct.name AS course_type, o.name AS organization,
              COALESCE(cs.studentcount, 0) AS studentcount
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN (
         SELECT course_request_id, COUNT(*) AS studentcount
         FROM course_students WHERE deleted_at IS NULL GROUP BY course_request_id
       ) cs ON cs.course_request_id = cr.id
       WHERE cr.instructor_id = ? AND cr.status IN ('confirmed', 'completed', 'invoiced') AND cr.deleted_at IS NULL
       ORDER BY COALESCE(cr.confirmed_date, cr.scheduled_date) ASC`,
      [id]
    );
    return {
      success: true,
      data: rows.map((r) => {
        const when = r.confirmed_date ?? r.scheduled_date;
        return {
          id: r.id,
          date: when ? toIsoDate(new Date(when)) : null,
          status: r.status,
          type: r.course_type,
          organization: r.organization,
          location: r.location,
          notes: r.notes,
          studentcount: Number(r.studentcount) || Number(r.registered_students) || 0,
          startTime: r.confirmed_start_time,
          endTime: r.confirmed_end_time,
        };
      }),
    };
  });

  // GET /instructors/available/:date — instructors marked available with no course that day
  app.get('/instructors/available/:date', { preHandler: manageRole }, async (request) => {
    const { date } = z.object({ date: isoDate }).parse(request.params);
    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name, ia.status AS availability_status
       FROM users u
       JOIN instructor_availability ia ON ia.instructor_id = u.id AND ia.date = ?
       WHERE u.role = 'instructor' AND u.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM course_requests cr
           WHERE cr.instructor_id = u.id AND cr.deleted_at IS NULL
             AND cr.status IN ('confirmed', 'completed', 'invoiced')
             AND DATE(cr.confirmed_date) = ?
         )
       ORDER BY u.last_name, u.first_name, u.username`,
      [date, date]
    );
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        instructorName: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username,
        username: r.username,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        availabilityStatus: 'Available',
      })),
    };
  });
}
