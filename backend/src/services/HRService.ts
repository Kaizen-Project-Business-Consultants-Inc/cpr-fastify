import { getPool } from '../config/database.js';
import { torontoTodaySql } from '../utils/torontoDate.js';
import type { RowDataPacket } from 'mysql2/promise';
import { completedClassDate } from '../utils/classDateSql.js';

/** An HR request that can't be done. `statusCode` is the HTTP status to answer with (400 by default). */
export class HRError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'HRError';
  }
}

/**
 * What the HR screens read: dashboard counts, the instructor list, a user's
 * profile, and the payment requests that were returned for a decision
 * (override-approve or final reject). Throws HRError.
 */
export class HRService {
  async getDashboardStats() {
    const pool = getPool();

    const [[activeInstructors], [orgs], [expiring]] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM users WHERE role = 'instructor' AND id IN (
           SELECT DISTINCT instructor_id FROM course_requests
           WHERE status IN ('confirmed', 'completed')
           AND created_at >= NOW() - INTERVAL 30 DAY
         )`
      ),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM organizations`),
      // Certificates live on course_students (the legacy certifications table is empty);
      // same rule as Sysadmin -> Certification Tracking: attended, expiring in 30 days.
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM course_students
         WHERE attended = true AND deleted_at IS NULL AND certificate_expires_at BETWEEN ${torontoTodaySql()} AND ${torontoTodaySql()} + INTERVAL 30 DAY`
      ),
    ]);

    return {
      activeInstructors: Number(activeInstructors[0]?.count ?? 0),
      organizations: Number(orgs[0]?.count ?? 0),
      expiringCertifications: Number(expiring[0]?.count ?? 0),
    };
  }

  async getInstructors(options: { search?: string; page: number; limit: number }) {
    const pool = getPool();
    const safeLimit = Math.min(options.limit, 100);
    const offset = (options.page - 1) * safeLimit;
    const params: unknown[] = [];
    let searchClause = '';

    if (options.search) {
      searchClause = 'AND (u.username LIKE ? OR u.email LIKE ?)';
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.phone, u.created_at as createdAt, u.updated_at as updatedAt,
              COUNT(DISTINCT cr.id) as totalCourses,
              COUNT(DISTINCT CASE WHEN cr.status IN ('completed', 'invoiced') THEN cr.id END) as completedCourses,
              COUNT(DISTINCT CASE WHEN cr.status = 'confirmed' THEN cr.id END) as activeCourses,
              MAX(${completedClassDate('cr')}) as lastCourseDate
       FROM users u
       LEFT JOIN course_requests cr ON u.id = cr.instructor_id AND cr.deleted_at IS NULL
       WHERE u.role = 'instructor' AND u.status = 'active' ${searchClause}
       GROUP BY u.id, u.username, u.email, u.phone, u.created_at, u.updated_at
       ORDER BY u.username
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users WHERE role = 'instructor' AND status = 'active' ${searchClause}`,
      params
    );

    return {
      instructors: rows,
      pagination: { page: options.page, limit: safeLimit, total: Number(countRows[0]?.total ?? 0), pages: Math.ceil(Number(countRows[0]?.total ?? 0) / safeLimit) },
    };
  }

  async getUserProfile(userId: number) {
    const pool = getPool();

    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.first_name as firstName, u.last_name as lastName,
              u.phone, u.mobile, u.address, u.organization_id as organizationId, o.name as organizationName,
              u.date_onboarded as dateOnboarded, u.date_offboarded as dateOffboarded,
              u.created_at as createdAt, u.updated_at as updatedAt
       FROM users u LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = ?`,
      [userId]
    );

    if (userRows.length === 0) throw new HRError('User not found', 404);
    const user = userRows[0];

    let courseHistory: RowDataPacket[] = [];
    if (user.role === 'instructor') {
      const [courses] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.status, ct.name as courseName, COALESCE(cr.confirmed_date, cr.scheduled_date) as courseDate,
                o.name as organizationName, cr.location
         FROM course_requests cr
         LEFT JOIN class_types ct ON cr.course_type_id = ct.id
         LEFT JOIN organizations o ON cr.organization_id = o.id
         WHERE cr.instructor_id = ?
         ORDER BY cr.created_at DESC LIMIT 10`,
        [userId]
      );
      courseHistory = courses;
    }

    return { user, courseHistory };
  }

  async getReturnedPaymentRequests(options: { page: number; limit: number }) {
    const pool = getPool();
    const safeLimit = Math.min(options.limit, 100);
    const offset = (options.page - 1) * safeLimit;

    const [rows] = await pool.query<RowDataPacket[]>(
      // ReturnedPaymentRequests.tsx reads the camelCase copies.
      `SELECT pr.*, u.username as instructor_name, u.email as instructor_email,
              t.week_start_date, t.total_hours, t.courses_taught, t.hr_comment as timesheet_comment,
              COALESCE(ipr.hourly_rate, 25.00) as hourly_rate,
              COALESCE(ipr.course_bonus, 50.00) as course_bonus,
              (t.total_hours * COALESCE(ipr.hourly_rate, 25.00)) as base_amount,
              (t.courses_taught * COALESCE(ipr.course_bonus, 50.00)) as bonus_amount,
              COALESCE(prt.name, 'Default') as tier_name,
              pr.instructor_id as instructorId, u.username as instructorName, u.email as instructorEmail,
              t.week_start_date as weekStartDate, t.total_hours as totalHours, t.courses_taught as coursesTaught,
              t.hr_comment as timesheetComment,
              COALESCE(ipr.hourly_rate, 25.00) as hourlyRate, COALESCE(ipr.course_bonus, 50.00) as courseBonus,
              (t.total_hours * COALESCE(ipr.hourly_rate, 25.00)) as baseAmount,
              (t.courses_taught * COALESCE(ipr.course_bonus, 50.00)) as bonusAmount,
              COALESCE(prt.name, 'Default') as tierName,
              pr.created_at as createdAt, pr.updated_at as updatedAt
       FROM payment_requests pr
       JOIN users u ON pr.instructor_id = u.id
       JOIN timesheets t ON pr.timesheet_id = t.id
       LEFT JOIN instructor_pay_rates ipr ON ipr.instructor_id = pr.instructor_id
         AND ipr.is_active = true AND ipr.effective_date <= t.week_start_date
       LEFT JOIN pay_rate_tiers prt ON ipr.tier_id = prt.id
       WHERE pr.status = 'returned_to_hr'
       ORDER BY pr.updated_at DESC
       LIMIT ? OFFSET ?`,
      [safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM payment_requests WHERE status = 'returned_to_hr'`
    );

    return {
      requests: rows,
      pagination: { page: options.page, limit: safeLimit, total: Number(countRows[0]?.total ?? 0), pages: Math.ceil(Number(countRows[0]?.total ?? 0) / safeLimit) },
    };
  }

  async processReturnedPaymentRequest(requestId: number, action: 'override_approve' | 'final_reject', notes: string) {
    if (!notes?.trim()) throw new HRError('Notes are required when processing returned payment request');

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [requestRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM payment_requests WHERE id = ? AND status = 'returned_to_hr'`,
        [requestId]
      );

      if (requestRows.length === 0) {
        throw new HRError('Returned payment request not found or already processed', 404);
      }

      const newStatus = action === 'override_approve' ? 'approved' : 'rejected';
      const hrNotes = `HR Decision (${action === 'override_approve' ? 'Override' : 'Final Reject'}): ${notes}`;

      await conn.query(
        `UPDATE payment_requests SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newStatus, hrNotes, requestId]
      );

      if (action === 'override_approve') {
        // Find the payment first, then update it: MariaDB refuses an UPDATE whose
        // WHERE subquery reads the same table (error 1093).
        const [paymentRows] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM payroll_payments
           WHERE instructor_id = ? AND amount = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [requestRows[0].instructor_id, requestRows[0].amount]
        );
        if (paymentRows.length > 0) {
          await conn.query(
            `UPDATE payroll_payments SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [paymentRows[0].id]
          );
        }
      }

      await conn.commit();
      return { message: `Payment request ${action === 'override_approve' ? 'approved by HR override' : 'finally rejected by HR'} successfully` };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}
