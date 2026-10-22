import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { StudentRepository } from '../repositories/StudentRepository.js';
import { emailService } from '../services/EmailService.js';
import { maybePaginate, paginatedResponse } from '../utils/pagination.js';
import { torontoToday } from '../utils/torontoDate.js';
import { ISSUE_CERTIFICATES_SQL } from '../utils/classDateSql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const addStudentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  college: z.string().optional(),
});

const instructorRole = ['instructor', 'admin', 'sysadmin'];

// ===== Availability rules =====
// One place for the per-date rules, shared by the single-date endpoints and
// the batch endpoint, so they can't drift apart.
const CANCEL_LOCKOUT_DAYS = 5;
const CANCEL_LOCKOUT_MESSAGE =
  'Availability cannot be cancelled 5 days or less before the date. Contact your administrator if you need to cancel.';
const PAST_DATE_MESSAGE = 'Availability cannot be added for a past date';

/** Whole days from `today` to `date`, both YYYY-MM-DD (negative = past). */
function daysFrom(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Why `date` can't be added, or null if it can. `today` is the Toronto day. */
function addRefusal(date: string, today: string): string | null {
  if (daysFrom(today, date) < 0) return PAST_DATE_MESSAGE;
  // Planned rule (not approved yet): block adding 5 days or less away —
  // if (daysFrom(today, date) <= CANCEL_LOCKOUT_DAYS) return '...';
  return null;
}

/** Why `date` can't be removed, or null if it can. Past dates may be removed
 *  (clearing a stale record isn't "close" to anything). */
function removeRefusal(date: string, today: string): string | null {
  const diff = daysFrom(today, date);
  if (diff >= 0 && diff <= CANCEL_LOCKOUT_DAYS) return CANCEL_LOCKOUT_MESSAGE;
  return null;
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(
  (d) => { const t = Date.parse(`${d}T00:00:00Z`); return !isNaN(t) && new Date(t).toISOString().startsWith(d); },
  'Not a real date',
);
const MAX_BATCH_DATES = 100;
const availabilityBatchSchema = z.object({
  add: z.array(isoDay).default([]),
  remove: z.array(isoDay).default([]),
}).refine((b) => b.add.length + b.remove.length > 0, 'Choose at least one date')
  .refine((b) => b.add.length + b.remove.length <= MAX_BATCH_DATES, `At most ${MAX_BATCH_DATES} dates at a time`)
  .refine((b) => !b.add.some((d) => b.remove.includes(d)), 'A date cannot be both added and removed');

// Shared query for the class-list endpoints
const CLASS_QUERY_BASE = `
  SELECT
    cr.id, cr.id as course_id, cr.instructor_id,
    cr.confirmed_date as start_time, cr.confirmed_date as end_time,
    cr.id as courseId, ct.name as name,
    cr.confirmed_start_time as startTime, cr.confirmed_end_time as endTime,
    cr.status, cr.location, cr.registered_students as max_students,
    CASE WHEN cr.status = 'completed' THEN true ELSE false END as completed,
    cr.created_at, cr.updated_at, cr.completed_at as completedAt,
    ct.name as course_name, ct.name as coursetypename,
    COALESCE(o.name, 'Unassigned') as organizationname,
    COALESCE(cr.notes, '') as notes,
    COALESCE(cs_counts.studentcount, 0) as studentcount,
    COALESCE(cs_counts.studentsattendance, 0) as studentsattendance`;

// Same FROM/JOINs as CLASS_QUERY_BASE — shared so the count query of a
// paginated request can never drift from the data query.
const CLASS_QUERY_FROM = `
  FROM course_requests cr
  JOIN class_types ct ON cr.course_type_id = ct.id
  LEFT JOIN organizations o ON cr.organization_id = o.id
  LEFT JOIN (
    SELECT course_request_id,
           COUNT(*) as studentcount,
           SUM(CASE WHEN attended = 1 OR attended = true THEN 1 ELSE 0 END) as studentsattendance
    FROM course_students GROUP BY course_request_id
  ) cs_counts ON cs_counts.course_request_id = cr.id`;

const CLASS_QUERY_SELECT = `${CLASS_QUERY_BASE}${CLASS_QUERY_FROM}`;

function formatClassRows(rows: RowDataPacket[]) {
  return rows.map(row => ({
    ...row,
    date: row.start_time ? new Date(row.start_time).toISOString().split('T')[0] : null,
  }));
}

export async function instructorRoutes(app: FastifyInstance) {
  const role = [requireRole(...instructorRole)];
  const pool = getPool();

  // ===== Availability =====
  app.get('/availability', { preHandler: role }, async (request) => {
    const result = await maybePaginate(
      `SELECT id, instructor_id, date, status, created_at, updated_at
       FROM instructor_availability WHERE instructor_id = ? ORDER BY date ASC`,
      'SELECT COUNT(*) as count FROM instructor_availability WHERE instructor_id = ?',
      [request.userId],
      request.query as Record<string, string>,
    );
    return paginatedResponse(result, (rows) =>
      rows.map((r) => ({ ...r, date: r.date ? new Date(r.date).toISOString().split('T')[0] : null })));
  });

  app.post('/availability', { preHandler: role }, async (request, reply) => {
    // Only plain YYYY-MM-DD: MariaDB also matches forms like '2026-10-23T00:00'
    // or '20261023' against a DATE, which would slip past the rules below.
    const parsed = isoDay.safeParse((request.body as { date?: unknown } | null)?.date);
    if (!parsed.success) return reply.status(400).send({ error: 'Use a date in YYYY-MM-DD form' });
    const date = parsed.data;
    const refusal = addRefusal(date, torontoToday());
    if (refusal) return reply.status(400).send({ error: refusal });

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM instructor_availability WHERE instructor_id = ? AND date = ?',
      [request.userId, date]
    );
    if (existing.length > 0) return reply.status(400).send({ error: 'Availability already exists for this date' });

    await pool.query(
      `INSERT INTO instructor_availability (instructor_id, date, status) VALUES (?, ?, 'available')`,
      [request.userId, date]
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM instructor_availability WHERE instructor_id = ? AND date = ?',
      [request.userId, date]
    );
    return { success: true, data: rows[0] };
  });

  app.delete('/availability/:date', { preHandler: role }, async (request, reply) => {
    const parsed = isoDay.safeParse((request.params as { date: string }).date);
    if (!parsed.success) return reply.status(400).send({ error: 'Use a date in YYYY-MM-DD form' });
    const date = parsed.data;

    // An instructor cannot cancel their own availability 5 days or less
    // before an UPCOMING date (Toronto day). A past date may be removed.
    const refusal = removeRefusal(date, torontoToday());
    if (refusal) return reply.status(400).send({ error: refusal });

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM instructor_availability WHERE instructor_id = ? AND date = ?',
      [request.userId, date]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Availability not found' });
    return { success: true, message: 'Availability removed successfully' };
  });

  // Several days in one save, from the My Availability calendar. Each date
  // gets the same rules as the single-date endpoints; a date that can't be
  // changed is skipped with a reason, the rest are written in one transaction.
  app.post('/availability/batch', { preHandler: role }, async (request, reply) => {
    const parsed = availabilityBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    const add = [...new Set(parsed.data.add)].sort();
    const remove = [...new Set(parsed.data.remove)].sort();
    const today = torontoToday();
    const skipped: { date: string; reason: string }[] = [];
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS day FROM instructor_availability
         WHERE instructor_id = ? AND date IN (?) FOR UPDATE`,
        [request.userId, [...add, ...remove]]
      );
      const existing = new Set(rows.map((r) => r.day as string));

      for (const date of add) {
        const reason = existing.has(date) ? 'Already available' : addRefusal(date, today);
        if (reason) skipped.push({ date, reason }); else toAdd.push(date);
      }
      for (const date of remove) {
        const reason = !existing.has(date) ? 'Not marked as available' : removeRefusal(date, today);
        if (reason) skipped.push({ date, reason }); else toRemove.push(date);
      }

      if (toAdd.length > 0) {
        await conn.query(
          'INSERT INTO instructor_availability (instructor_id, date, status) VALUES ?',
          [toAdd.map((d) => [request.userId, d, 'available'])]
        );
      }
      if (toRemove.length > 0) {
        await conn.query(
          'DELETE FROM instructor_availability WHERE instructor_id = ? AND date IN (?)',
          [request.userId, toRemove]
        );
      }
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }

    return { success: true, added: toAdd, removed: toRemove, skipped };
  });

  // ===== Classes =====
  /** One opt-in-paginated class list. `where` is shared by data and count. */
  async function classList(query: Record<string, string>, where: string, orderBy: string, params: unknown[]) {
    const result = await maybePaginate(
      `${CLASS_QUERY_SELECT} ${where} ORDER BY ${orderBy}`,
      `SELECT COUNT(*) as count ${CLASS_QUERY_FROM} ${where}`,
      params,
      query,
    );
    return paginatedResponse(result, formatClassRows);
  }

  app.get('/classes/active', { preHandler: role }, async (request) => {
    return classList(
      request.query as Record<string, string>,
      `WHERE cr.instructor_id = ? AND cr.status = 'confirmed' AND cr.status != 'completed'`,
      'cr.confirmed_date ASC',
      [request.userId],
    );
  });

  app.get('/classes/completed', { preHandler: role }, async (request) => {
    return classList(
      request.query as Record<string, string>,
      `WHERE cr.instructor_id = ? AND cr.status = 'completed'`,
      'cr.confirmed_date DESC',
      [request.userId],
    );
  });

  app.get('/classes/today', { preHandler: role }, async (request) => {
    const { date: clientDate } = request.query as { date?: string };
    let todayStr: string;
    if (clientDate && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)) {
      todayStr = clientDate;
    } else {
      const [dateRows] = await pool.query<RowDataPacket[]>('SELECT CURRENT_DATE as today_date');
      todayStr = new Date(dateRows[0].today_date).toISOString().split('T')[0];
    }

    return classList(
      request.query as Record<string, string>,
      `WHERE cr.instructor_id = ? AND cr.status = 'confirmed' AND DATE(cr.confirmed_date) = ?`,
      'cr.confirmed_date ASC',
      [request.userId, todayStr],
    );
  });

  // ===== Students for a class =====
  app.get('/classes/:classId/students', { preHandler: role }, async (request) => {
    const { classId } = request.params as { classId: string };
    const [check] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM course_requests WHERE id = ? AND instructor_id = ?',
      [classId, request.userId]
    );
    if (check.length === 0) return { success: true, data: [] };

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cs.id, cs.first_name, cs.last_name, cs.email, cs.attended, cs.attendance_marked
       FROM course_students cs WHERE cs.course_request_id = ? ORDER BY cs.first_name, cs.last_name`,
      [classId]
    );
    return {
      success: true,
      data: rows.map(r => ({
        studentid: r.id.toString(), firstname: r.first_name, lastname: r.last_name,
        email: r.email || '', attendance: r.attended || false, attendanceMarked: r.attendance_marked || false,
      })),
    };
  });

  // ===== Update single student attendance =====
  app.put('/classes/:classId/students/:studentId/attendance', { preHandler: role }, async (request, reply) => {
    const { classId, studentId } = request.params as { classId: string; studentId: string };
    const { attended } = z.object({ attended: z.boolean() }).parse(request.body);

    const [check] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM course_requests WHERE id = ? AND instructor_id = ?',
      [classId, request.userId]
    );
    if (check.length === 0) return reply.status(404).send({ error: 'Course request not found or not authorized' });

    // Absent: no certificate. Present: certificate dates are set here only if
    // the class is already completed; Complete Class sets them otherwise.
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE course_students SET attended = ?, attendance_marked = true${attended ? '' : ', certificate_issued_at = NULL, certificate_expires_at = NULL'},
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND course_request_id = ?`,
      [attended, studentId, classId]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Student not found' });
    if (attended) {
      await pool.query(`${ISSUE_CERTIFICATES_SQL} AND cs.id = ? AND cs.course_request_id = ?`, [studentId, classId]);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, first_name, last_name, email, attended, attendance_marked, certificate_issued_at, certificate_expires_at FROM course_students WHERE id = ?',
      [studentId]
    );
    const r = rows[0];
    return {
      success: true,
      data: {
        studentid: r.id.toString(), firstname: r.first_name, lastname: r.last_name,
        email: r.email || '', attendance: r.attended || false, attendanceMarked: r.attendance_marked || false,
      },
    };
  });

  // ===== Add student to class =====
  app.post('/classes/:classId/students', { preHandler: role }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    const { firstName, lastName, email, phone, college } = addStudentSchema.parse(request.body);

    const [check] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM course_requests WHERE id = ? AND instructor_id = ?',
      [classId, request.userId]
    );
    if (check.length === 0) return reply.status(403).send({ error: 'Not authorized or course request not found' });

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM course_students WHERE course_request_id = ? AND email = ?',
      [classId, email]
    );
    if (existing.length > 0) return reply.status(400).send({ error: 'Student with this email already exists for this course' });

    // Two dependent writes: the students master row and the course roster row.
    // A failure after the first would leave an orphan master student, so both
    // run on one connection inside a transaction.
    const studentRepo = new StudentRepository();
    const conn = await pool.getConnection();
    let rows: RowDataPacket[];
    try {
      await conn.beginTransaction();

      const [courseRow] = await conn.query<RowDataPacket[]>(
        'SELECT organization_id FROM course_requests WHERE id = ?', [classId]
      );
      const studentId = await studentRepo.findOrCreate({
        email, firstName, lastName, phone,
        organizationId: courseRow[0]?.organization_id ?? null,
      }, conn);

      const [insertResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO course_students (course_request_id, first_name, last_name, email, phone, college, student_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [classId, firstName, lastName, email, phone, college ?? null, studentId]
      );

      [rows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM course_students WHERE id = ?', [insertResult.insertId]
      );
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }

    const r = rows[0];
    return {
      success: true,
      data: {
        studentid: r.id.toString(), firstname: r.first_name, lastname: r.last_name,
        email: r.email || '', phone: r.phone || '', college: r.college || '',
        attendance: r.attended || false, attendanceMarked: r.attendance_marked || false,
      },
    };
  });

  // ===== Complete class =====
  app.post('/classes/:classId/complete', { preHandler: role }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    const { instructor_comments } = (request.body ?? {}) as { instructor_comments?: string };

    const [check] = await pool.query<RowDataPacket[]>(
      'SELECT id, status FROM course_requests WHERE id = ? AND instructor_id = ?',
      [classId, request.userId]
    );
    if (check.length === 0) return reply.status(404).send({ error: 'Course request not found or not authorized' });
    if (check[0].status === 'completed') return reply.status(400).send({ error: 'Class is already completed' });

    // course_requests and classes must flip to 'completed' together.
    const completeConn = await pool.getConnection();
    try {
      await completeConn.beginTransaction();
      await completeConn.query(
        `UPDATE course_requests
         SET status = 'completed', instructor_comments = COALESCE(?, instructor_comments),
             completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND instructor_id = ?`,
        [instructor_comments ?? null, classId, request.userId]
      );
      // Attendance is marked before the class is completed, so this is where
      // the attended students' certificates get their dates.
      await completeConn.query(`${ISSUE_CERTIFICATES_SQL} AND cs.course_request_id = ?`, [classId]);
      await completeConn.query(
        `UPDATE classes SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE instructor_id = ? AND DATE(start_time) = (SELECT DATE(confirmed_date) FROM course_requests WHERE id = ?)`,
        [request.userId, classId]
      );
      await completeConn.commit();
    } catch (err) { await completeConn.rollback(); throw err; } finally { completeConn.release(); }

    logger.info({ courseId: classId, instructorId: request.userId }, 'Course completed');

    // Fire-and-forget: send course completed email to org admins
    (async () => {
      try {
        const [courseInfo] = await pool.query<RowDataPacket[]>(
          `SELECT cr.organization_id, cr.registered_students, cr.location,
                  COALESCE(cr.confirmed_date, cr.scheduled_date) as course_date,
                  ct.name as course_name,
                  (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id AND cs.attended = true) as students_attended
           FROM course_requests cr
           LEFT JOIN class_types ct ON cr.course_type_id = ct.id
           WHERE cr.id = ?`,
          [classId]
        );
        if (courseInfo.length === 0) return;
        const info = courseInfo[0];

        // One query for admins + their email preference (was an N+1 loop).
        const adminsSql = (withPrefs: boolean) => `
          SELECT u.id, u.email, ${withPrefs ? 'np.email_enabled' : 'NULL AS email_enabled'}
          FROM users u
          ${withPrefs ? "LEFT JOIN notification_preferences np ON np.user_id = u.id AND np.notification_type = 'course_status_change'" : ''}
          WHERE u.organization_id = ? AND u.role IN ('org_admin', 'organization') AND u.status = 'active' AND u.email IS NOT NULL`;
        let admins: RowDataPacket[] = [];
        try {
          [admins] = await pool.query<RowDataPacket[]>(adminsSql(true), [info.organization_id]);
        } catch {
          // notification_preferences table may not exist — send to everyone
          [admins] = await pool.query<RowDataPacket[]>(adminsSql(false), [info.organization_id]);
        }

        for (const admin of admins) {
          // MySQL returns BOOLEAN as 0/1; the old `=== false` check never matched.
          const shouldSend = !(admin.email_enabled === 0 || admin.email_enabled === false);

          if (shouldSend) {
            emailService.sendCourseCompletedEmail(admin.email, {
              courseName: info.course_name ?? 'Unknown Course',
              date: info.course_date ? new Date(info.course_date).toISOString().split('T')[0] : '',
              studentsAttended: Number(info.students_attended ?? 0),
              totalStudents: Number(info.registered_students ?? 0),
            }).catch(err => logger.error({ err, courseId: classId }, 'Failed to send course completed email'));
          }
        }
      } catch (err) {
        logger.error({ err, courseId: classId }, 'Failed to send course completed notifications');
      }
    })();

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, status, completed_at, updated_at FROM course_requests WHERE id = ?', [classId]
    );
    return { success: true, data: rows[0] };
  });

  // ===== Profile =====
  app.get('/profile', { preHandler: role }, async (request, reply) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.phone, u.first_name, u.last_name, u.role,
              u.created_at, u.updated_at,
              COALESCE(stats.total_classes, 0) as total_classes,
              COALESCE(stats.total_students, 0) as total_students
       FROM users u
       LEFT JOIN (
         SELECT cr.instructor_id, COUNT(DISTINCT cr.id) as total_classes,
                COALESCE(SUM(sc.student_count), 0) as total_students
         FROM course_requests cr
         LEFT JOIN (SELECT course_request_id, COUNT(*) as student_count FROM course_students GROUP BY course_request_id) sc
           ON sc.course_request_id = cr.id
         WHERE cr.status IN ('confirmed', 'completed') GROUP BY cr.instructor_id
       ) stats ON stats.instructor_id = u.id
       WHERE u.id = ?`,
      [request.userId]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { success: true, data: rows[0] };
  });

  app.put('/profile', { preHandler: role }, async (request, reply) => {
    const { username, email, phone } = z.object({
      username: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    }).parse(request.body);

    await pool.query(
      `UPDATE users SET username = COALESCE(?, username), email = COALESCE(?, email),
       phone = COALESCE(?, phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [username ?? null, email ?? null, phone ?? null, request.userId]
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, phone FROM users WHERE id = ?', [request.userId]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { success: true, data: rows[0] };
  });
}
