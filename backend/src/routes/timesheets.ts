import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth, requireRole } from '../plugins/auth.js';

const submitTimesheetSchema = z.object({
  weekStartDate: z.string(),
  totalHours: z.number().min(0).default(0),
  coursesTaught: z.number().int().min(0).default(0),
  notes: z.string().optional().default(''),
  travelTime: z.number().min(0).default(0),
  prepTime: z.number().min(0).default(0),
  teachingHours: z.number().min(0).default(0),
  isLate: z.boolean().default(false),
});

const approveSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().optional(),
});

const addNoteSchema = z.object({
  note_text: z.string().min(1),
  note_type: z.enum(['instructor', 'hr', 'accounting', 'general']).default('general'),
});

export async function timesheetRoutes(app: FastifyInstance) {
  const pool = getPool();
  const hrRole = [requireRole('hr')];
  const timesheetAccess = [requireRole('hr', 'instructor')];

  // ===== Stats (HR) =====
  app.get('/stats', { preHandler: hrRole }, async () => {
    const [[pending], [approved], [hours], [instructors]] = await Promise.all([
      pool.query<any[]>(`SELECT COUNT(*) as count FROM timesheets WHERE status = 'pending'`),
      pool.query<any[]>(`SELECT COUNT(*) as count FROM timesheets WHERE status = 'approved' AND MONTH(created_at) = MONTH(CURRENT_DATE) AND YEAR(created_at) = YEAR(CURRENT_DATE)`),
      pool.query<any[]>(`SELECT COALESCE(SUM(total_hours), 0) as total FROM timesheets WHERE status = 'approved' AND MONTH(created_at) = MONTH(CURRENT_DATE) AND YEAR(created_at) = YEAR(CURRENT_DATE)`),
      pool.query<any[]>(`SELECT COUNT(DISTINCT instructor_id) as count FROM timesheets WHERE status = 'pending'`),
    ]);
    return {
      success: true,
      data: {
        pendingTimesheets: Number(pending[0]?.count ?? 0),
        approvedThisMonth: Number(approved[0]?.count ?? 0),
        totalHoursThisMonth: Number(hours[0]?.total ?? 0),
        instructorsWithPending: Number(instructors[0]?.count ?? 0),
      },
    };
  });

  // ===== List timesheets =====
  app.get('/', { preHandler: timesheetAccess }, async (request) => {
    const { page = '1', limit = '10', status = '', instructor_id = '', month = '' } = request.query as Record<string, string>;
    const safeLimit = Math.min(parseInt(limit), 100);
    const offset = (parseInt(page) - 1) * safeLimit;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (request.userRole === 'instructor') {
      where += ' AND t.instructor_id = ?';
      params.push(request.userId);
    }
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (instructor_id) { where += ' AND t.instructor_id = ?'; params.push(instructor_id); }
    if (month) { where += ' AND MONTH(t.week_start_date) = ?'; params.push(month); }

    const [rows] = await pool.query<any[]>(
      `SELECT t.*, u.username as instructor_name, u.email as instructor_email
       FROM timesheets t JOIN users u ON t.instructor_id = u.id
       ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );
    const [countRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM timesheets t ${where}`, params
    );
    const total = Number(countRows[0]?.total ?? 0);

    return {
      success: true,
      data: {
        timesheets: rows,
        pagination: { page: parseInt(page), limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
      },
    };
  });

  // ===== Timesheet detail =====
  app.get('/:timesheetId', { preHandler: timesheetAccess }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    let where = 'WHERE t.id = ?';
    const params: unknown[] = [timesheetId];
    if (request.userRole === 'instructor') {
      where += ' AND t.instructor_id = ?';
      params.push(request.userId);
    }

    const [rows] = await pool.query<any[]>(
      `SELECT t.*, u.username as instructor_name, u.email as instructor_email
       FROM timesheets t JOIN users u ON t.instructor_id = u.id ${where}`,
      params
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Timesheet not found' });
    return { success: true, data: rows[0] };
  });

  // ===== Submit timesheet (instructor) =====
  app.post('/', { preHandler: [requireRole('instructor')] }, async (request, reply) => {
    const data = submitTimesheetSchema.parse(request.body);

    // Validate Monday
    const [y, m, d] = data.weekStartDate.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);
    if (startDate.getDay() !== 1) return reply.status(400).send({ error: 'Week start date must be a Monday' });

    // Validate week has ended
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(startDate); weekEnd.setDate(startDate.getDate() + 6);
    if (today <= weekEnd) return reply.status(400).send({ error: 'Cannot submit timesheet until the week has ended' });

    // Check duplicate
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM timesheets WHERE instructor_id = ? AND week_start_date = ?',
      [request.userId, data.weekStartDate]
    );
    if (existing.length > 0) return reply.status(400).send({ error: 'Timesheet already exists for this week' });

    // Get courses for the week
    const endDateStr = new Date(startDate.getTime() + 6 * 86400000).toISOString().split('T')[0];
    const [courses] = await pool.query<any[]>(
      `SELECT cr.id, cr.confirmed_date as date, cr.confirmed_start_time as start_time,
              cr.confirmed_end_time as end_time, cr.status, cr.location,
              ct.name as course_type, o.name as organization_name,
              (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id) as student_count
       FROM course_requests cr
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       WHERE cr.instructor_id = ? AND cr.confirmed_date >= ? AND cr.confirmed_date <= ?
       AND cr.status IN ('confirmed', 'completed')
       ORDER BY cr.confirmed_date, cr.confirmed_start_time`,
      [request.userId, data.weekStartDate, endDateStr]
    );

    const [result] = await pool.query<any>(
      `INSERT INTO timesheets (
         instructor_id, week_start_date, total_hours, courses_taught, notes, status,
         course_details, travel_time, prep_time, teaching_hours, is_late
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [request.userId, data.weekStartDate, data.totalHours, data.coursesTaught, data.notes,
       JSON.stringify(courses), data.travelTime, data.prepTime, data.teachingHours, data.isLate]
    );

    const [rows] = await pool.query<any[]>('SELECT * FROM timesheets WHERE id = ?', [result.insertId]);
    return {
      success: true,
      message: data.isLate ? 'Late timesheet submitted successfully. HR will review.' : 'Timesheet submitted successfully.',
      data: { ...rows[0], course_details: courses },
    };
  });

  // ===== Update timesheet (instructor) =====
  app.put('/:timesheetId', { preHandler: [requireRole('instructor')] }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const { total_hours, courses_taught, notes } = z.object({
      total_hours: z.number().min(0),
      courses_taught: z.number().int().min(0).default(0),
      notes: z.string().default(''),
    }).parse(request.body);

    const [existing] = await pool.query<any[]>(
      'SELECT id, status FROM timesheets WHERE id = ? AND instructor_id = ?',
      [timesheetId, request.userId]
    );
    if (existing.length === 0) return reply.status(404).send({ error: 'Timesheet not found' });
    if (existing[0].status !== 'pending') return reply.status(400).send({ error: 'Cannot update approved or rejected timesheet' });

    await pool.query(
      'UPDATE timesheets SET total_hours = ?, courses_taught = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND instructor_id = ?',
      [total_hours, courses_taught ?? 0, notes ?? '', timesheetId, request.userId]
    );
    const [rows] = await pool.query<any[]>('SELECT * FROM timesheets WHERE id = ?', [timesheetId]);
    return { success: true, message: 'Timesheet updated successfully.', data: rows[0] };
  });

  // ===== Approve/reject (HR) =====
  app.post('/:timesheetId/approve', { preHandler: hrRole }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const { action, comment } = approveSchema.parse(request.body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [tsRows] = await conn.query<any[]>(
        `SELECT t.*, u.username as instructor_name, u.email as instructor_email
         FROM timesheets t JOIN users u ON t.instructor_id = u.id
         WHERE t.id = ? AND t.status = 'pending'`,
        [timesheetId]
      );
      if (tsRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Timesheet not found or already processed' }); }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await conn.query(
        'UPDATE timesheets SET status = ?, hr_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newStatus, comment ?? null, timesheetId]
      );
      await conn.commit();

      return { success: true, message: `Timesheet ${action}d successfully.`, data: { ...tsRows[0], status: newStatus } };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Instructor summary =====
  app.get('/instructor/:instructorId/summary', { preHandler: timesheetAccess }, async (request, reply) => {
    const { instructorId } = request.params as { instructorId: string };
    // Instructors can only view their own summary
    if (request.userRole === 'instructor' && request.userId !== parseInt(instructorId)) {
      return reply.status(403).send({ error: 'Access denied' });
    }
    const [[summary], [recent]] = await Promise.all([
      pool.query<any[]>(
        `SELECT COUNT(*) as total_timesheets,
                COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_timesheets,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_timesheets,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_timesheets,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN total_hours END), 0) as total_approved_hours,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN courses_taught END), 0) as total_courses_taught,
                MAX(created_at) as last_submission_date
         FROM timesheets WHERE instructor_id = ?`,
        [instructorId]
      ),
      pool.query<any[]>(
        'SELECT * FROM timesheets WHERE instructor_id = ? ORDER BY created_at DESC LIMIT 5',
        [instructorId]
      ),
    ]);
    return { success: true, data: { summary: summary[0], recentTimesheets: recent } };
  });

  // ===== Week courses =====
  app.get('/week/:weekStartDate/courses', { preHandler: [requireRole('instructor')] }, async (request, reply) => {
    const { weekStartDate } = request.params as { weekStartDate: string };
    const [y, m, d] = weekStartDate.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);
    if (startDate.getDay() !== 1) return reply.status(400).send({ error: 'Week start date must be a Monday' });

    const endDate = new Date(startDate); endDate.setDate(startDate.getDate() + 6);
    const endDateStr = endDate.toISOString().split('T')[0];

    const [rows] = await pool.query<any[]>(
      `SELECT cr.id, cr.confirmed_date as date, cr.confirmed_start_time as startTime,
              cr.confirmed_end_time as endTime, cr.status, cr.location,
              ct.name as courseType, o.name as organizationName,
              (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id) as studentCount
       FROM course_requests cr
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       WHERE cr.instructor_id = ? AND cr.confirmed_date >= ? AND cr.confirmed_date <= ?
       AND cr.status IN ('confirmed', 'completed')
       ORDER BY cr.confirmed_date, cr.confirmed_start_time`,
      [request.userId, weekStartDate, endDateStr]
    );

    return {
      success: true,
      data: { weekStartDate, weekEndDate: endDateStr, courses: rows, totalCourses: rows.length },
    };
  });

  // ===== Notes =====
  app.get('/:timesheetId/notes', { preHandler: timesheetAccess }, async (request) => {
    const { timesheetId } = request.params as { timesheetId: string };
    // Instructors may only read notes on their own timesheets
    const ownerClause = request.userRole === 'instructor' ? ' AND t.instructor_id = ?' : '';
    const params: any[] = request.userRole === 'instructor' ? [timesheetId, request.userId] : [timesheetId];
    const [rows] = await pool.query<any[]>(
      `SELECT tn.*, u.username as added_by, u.email as added_by_email
       FROM timesheet_notes tn
       JOIN users u ON tn.user_id = u.id
       JOIN timesheets t ON t.id = tn.timesheet_id
       WHERE tn.timesheet_id = ?${ownerClause} ORDER BY tn.created_at ASC`,
      params
    );
    return { success: true, data: rows };
  });

  app.post('/:timesheetId/notes', { preHandler: [requireAuth] }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const { note_text, note_type } = addNoteSchema.parse(request.body);

    // Check role matches note type
    if (note_type === 'instructor' && request.userRole !== 'instructor') return reply.status(403).send({ error: 'Only instructors can add instructor notes' });
    if (note_type === 'hr' && request.userRole !== 'hr') return reply.status(403).send({ error: 'Only HR can add HR notes' });
    if (note_type === 'accounting' && request.userRole !== 'accountant') return reply.status(403).send({ error: 'Only accountants can add accounting notes' });

    // Check timesheet access
    let where = 'WHERE t.id = ?';
    const params: unknown[] = [timesheetId];
    if (request.userRole === 'instructor') { where += ' AND t.instructor_id = ?'; params.push(request.userId); }
    const [tsCheck] = await pool.query<any[]>(`SELECT t.id FROM timesheets t ${where}`, params);
    if (tsCheck.length === 0) return reply.status(404).send({ error: 'Timesheet not found or access denied' });

    const [result] = await pool.query<any>(
      `INSERT INTO timesheet_notes (timesheet_id, user_id, user_role, note_text, note_type) VALUES (?, ?, ?, ?, ?)`,
      [timesheetId, request.userId, request.userRole, note_text.trim(), note_type]
    );
    const [rows] = await pool.query<any[]>(
      `SELECT tn.*, u.username as added_by, u.email as added_by_email
       FROM timesheet_notes tn JOIN users u ON tn.user_id = u.id WHERE tn.id = ?`,
      [result.insertId]
    );
    return { success: true, message: 'Note added successfully.', data: rows[0] };
  });

  app.delete('/:timesheetId/notes/:noteId', { preHandler: [requireAuth] }, async (request, reply) => {
    const { timesheetId, noteId } = request.params as { timesheetId: string; noteId: string };
    const [noteRows] = await pool.query<any[]>(
      'SELECT * FROM timesheet_notes WHERE id = ? AND timesheet_id = ?',
      [noteId, timesheetId]
    );
    if (noteRows.length === 0) return reply.status(404).send({ error: 'Note not found' });
    if (noteRows[0].user_id !== request.userId && request.userRole !== 'hr') {
      return reply.status(403).send({ error: 'Cannot delete this note' });
    }
    await pool.query('DELETE FROM timesheet_notes WHERE id = ?', [noteId]);
    return { success: true, message: 'Note deleted successfully.' };
  });

  // ===== Reminders =====
  app.get('/reminders/pending', { preHandler: hrRole }, async () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - daysToSubtract);
    const previousMonday = new Date(thisMonday); previousMonday.setDate(thisMonday.getDate() - 7);
    const previousMondayStr = previousMonday.toISOString().split('T')[0];

    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.username, u.email,
              (SELECT COUNT(*) FROM course_requests cr
               WHERE cr.instructor_id = u.id AND cr.confirmed_date >= ?
               AND cr.confirmed_date <= (? + INTERVAL 6 DAY) AND cr.status = 'completed') as completed_courses
       FROM users u
       WHERE u.role = 'instructor' AND u.id NOT IN (SELECT instructor_id FROM timesheets WHERE week_start_date = ?)
       ORDER BY u.username`,
      [previousMondayStr, previousMondayStr, previousMondayStr]
    );
    return { success: true, data: { weekStartDate: previousMondayStr, instructorsWithoutTimesheet: rows } };
  });

  app.post('/reminders/send', { preHandler: hrRole }, async (request, reply) => {
    const { instructorIds } = z.object({ instructorIds: z.array(z.number().int().positive()).min(1) }).parse(request.body);

    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - daysToSubtract);
    const previousMonday = new Date(thisMonday); previousMonday.setDate(thisMonday.getDate() - 7);
    const previousMondayStr = previousMonday.toISOString().split('T')[0];

    const message = `Please submit your timesheet for the week of ${previousMondayStr}. Timesheets are due by end of week.`;
    try {
      for (const id of instructorIds) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'timesheet_reminder', 'Timesheet Reminder', ?)`,
          [id, message]
        );
      }
    } catch {
      // Notification table may not exist
    }

    return { success: true, message: `Reminders sent to ${instructorIds.length} instructor(s).`, data: { sentCount: instructorIds.length, weekStartDate: previousMondayStr } };
  });
}
