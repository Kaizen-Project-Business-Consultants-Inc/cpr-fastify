import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { StudentRepository } from '../repositories/StudentRepository.js';
import { emailService } from '../services/EmailService.js';
import { maybePaginate, paginatedResponse } from '../utils/pagination.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const addStudentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  college: z.string().optional(),
});

const availabilitySchema = z.object({
  availability: z.array(z.object({
    date: z.string(),
    status: z.string(),
  })),
});

const instructorRole = ['instructor', 'admin', 'sysadmin'];

// Shared query for class listings — DRY across 5 endpoints
const CLASS_QUERY_BASE = `
  SELECT
    cr.id, cr.id as course_id, cr.instructor_id,
    cr.confirmed_date as start_time, cr.confirmed_date as end_time,
    cr.status, cr.location, cr.registered_students as max_students,
    CASE WHEN cr.status = 'completed' THEN true ELSE false END as completed,
    cr.created_at, cr.updated_at,
    ct.name as course_name, ct.name as coursetypename,
    COALESCE(o.name, 'Unassigned') as organizationname,
    COALESCE(cr.location, '') as notes,
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

  // ===== Dashboard Stats =====
  app.get('/dashboard/stats', { preHandler: role }, async (request) => {
    const [statsRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) as total_courses,
         SUM(CASE WHEN cr.status = 'confirmed' THEN 1 ELSE 0 END) as scheduled_courses,
         SUM(CASE WHEN cr.status = 'completed' THEN 1 ELSE 0 END) as completed_courses,
         SUM(CASE WHEN cr.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_courses,
         COALESCE(SUM(sc.student_count), 0) as total_students
       FROM course_requests cr
       LEFT JOIN (SELECT course_request_id, COUNT(*) as student_count FROM course_students GROUP BY course_request_id) sc
         ON sc.course_request_id = cr.id
       WHERE cr.instructor_id = ?`,
      [request.userId]
    );

    const [recentRows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.id, cr.confirmed_date as date, ct.name as type,
              COALESCE(sc.student_count, 0) as students
       FROM course_requests cr
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN (SELECT course_request_id, COUNT(*) as student_count FROM course_students GROUP BY course_request_id) sc
         ON sc.course_request_id = cr.id
       WHERE cr.instructor_id = ? AND cr.status IN ('confirmed', 'completed')
       ORDER BY cr.confirmed_date DESC LIMIT 5`,
      [request.userId]
    );

    const s = statsRows[0] ?? {};
    return {
      success: true,
      data: {
        totalCourses: Number(s.total_courses ?? 0),
        scheduledClasses: Number(s.scheduled_courses ?? 0),
        completedClasses: Number(s.completed_courses ?? 0),
        cancelledClasses: Number(s.cancelled_courses ?? 0),
        totalStudents: Number(s.total_students ?? 0),
        recentClasses: recentRows.map(r => ({
          id: r.id,
          date: r.date ? new Date(r.date).toISOString().split('T')[0] : null,
          type: r.type,
          students: Number(r.students ?? 0),
        })),
      },
    };
  });

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
    const { date } = z.object({ date: z.string() }).parse(request.body);
    if (isNaN(new Date(date).getTime())) return reply.status(400).send({ error: 'Invalid date format' });

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
    const { date } = request.params as { date: string };

    // An instructor cannot cancel their own availability 5 days or less
    // before the date — restored per business rule; previously this was
    // only suggested by a frontend UI lock (and at 11 days, not 5) with no
    // server-side enforcement at all, so the real rule never actually held.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(date); target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (!isNaN(diffDays) && diffDays <= 5) {
      return reply.status(400).send({
        error: 'Availability cannot be cancelled 5 days or less before the date. Contact your administrator if you need to cancel.',
      });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM instructor_availability WHERE instructor_id = ? AND date = ?',
      [request.userId, date]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Availability not found' });
    return { success: true, message: 'Availability removed successfully' };
  });

  app.put('/availability', { preHandler: role }, async (request) => {
    const { availability } = availabilitySchema.parse(request.body);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM instructor_availability WHERE instructor_id = ?', [request.userId]);
      for (const item of availability) {
        if (item.date && item.status && !isNaN(new Date(item.date).getTime())) {
          await conn.query(
            'INSERT INTO instructor_availability (instructor_id, date, status) VALUES (?, ?, ?)',
            [request.userId, item.date, item.status]
          );
        }
      }
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM instructor_availability WHERE instructor_id = ? ORDER BY date ASC',
      [request.userId]
    );
    return { success: true, data: rows };
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

  app.get('/classes', { preHandler: role }, async (request) => {
    return classList(
      request.query as Record<string, string>,
      `WHERE cr.instructor_id = ? AND cr.status = 'confirmed'`,
      'cr.confirmed_date DESC',
      [request.userId],
    );
  });

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

  // ===== Schedule =====
  app.get('/schedule', { preHandler: role }, async (request) => {
    return classList(
      request.query as Record<string, string>,
      `WHERE cr.instructor_id = ? AND cr.status = 'confirmed'`,
      'cr.confirmed_date ASC',
      [request.userId],
    );
  });

  // ===== Class detail =====
  app.get('/classes/:classId', { preHandler: role }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.class_type_id, c.instructor_id, c.start_time, c.end_time, c.status,
              c.location, c.max_students, CASE WHEN c.status = 'completed' THEN true ELSE false END as completed,
              c.created_at, c.updated_at, ct.name as course_name, ct.name as coursetypename,
              COALESCE(o.name, 'Unassigned') as organizationname, COALESCE(c.location, '') as notes
       FROM classes c
       JOIN class_types ct ON c.class_type_id = ct.id
       LEFT JOIN organizations o ON c.organization_id = o.id
       WHERE c.id = ? AND c.instructor_id = ?`,
      [classId, request.userId]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Class not found or not authorized' });
    return { success: true, data: rows[0] };
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

    // If marking attended, auto-set certificate dates based on class type validity
    let certUpdate = '';
    const certValues: unknown[] = [attended, studentId, classId];
    if (attended) {
      const [typeRows] = await pool.query<RowDataPacket[]>(
        `SELECT ct.certification_validity_months, cr.completed_at
         FROM course_requests cr JOIN class_types ct ON cr.course_type_id = ct.id
         WHERE cr.id = ?`,
        [classId]
      );
      const ct = typeRows[0];
      if (ct?.certification_validity_months && ct.completed_at) {
        certUpdate = ', certificate_issued_at = ?, certificate_expires_at = DATE_ADD(?, INTERVAL ? MONTH)';
        certValues.splice(1, 0, ct.completed_at, ct.completed_at, ct.certification_validity_months);
      }
    } else {
      certUpdate = ', certificate_issued_at = NULL, certificate_expires_at = NULL';
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE course_students SET attended = ?, attendance_marked = true${certUpdate}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND course_request_id = ?`,
      certValues
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Student not found' });

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

  // ===== Attendance data =====
  app.get('/attendance', { preHandler: role }, async (request) => {
    const result = await maybePaginate(
      `SELECT c.id as class_id, c.start_time, c.end_time, c.status, ct.name as course_name,
              COUNT(cs.id) as total_students,
              COUNT(CASE WHEN cs.attended = true THEN 1 END) as attended_students,
              COUNT(CASE WHEN cs.attended = false THEN 1 END) as absent_students
       FROM classes c
       JOIN class_types ct ON c.class_type_id = ct.id
       LEFT JOIN course_requests cr ON cr.instructor_id = c.instructor_id AND DATE(cr.confirmed_date) = DATE(c.start_time)
       LEFT JOIN course_students cs ON cs.course_request_id = cr.id
       WHERE c.instructor_id = ?
       GROUP BY c.id, c.start_time, c.end_time, c.status, ct.name
       ORDER BY c.start_time DESC`,
      // One row per class after the GROUP BY, so count classes over the same WHERE.
      `SELECT COUNT(*) as count FROM classes c
       JOIN class_types ct ON c.class_type_id = ct.id
       WHERE c.instructor_id = ?`,
      [request.userId],
      request.query as Record<string, string>,
    );
    return paginatedResponse(result);
  });
}
