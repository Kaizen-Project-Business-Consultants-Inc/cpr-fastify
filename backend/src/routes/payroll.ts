import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { monthRangeOrThrow } from '../utils/monthRange.js';
import { writeAudit } from '../utils/auditLog.js';
import type { RowDataPacket } from 'mysql2/promise';

const processPaymentSchema = z.object({
  action: z.enum(['approve', 'reject']),
  transaction_id: z.string().optional(),
  notes: z.string().optional().default(''),
});

const calculateSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
  hourly_rate: z.number().positive().optional(),
});

export async function payrollRoutes(app: FastifyInstance) {
  const pool = getPool();
  const hrRole = [requireRole('hr')];

  // ===== Stats =====
  app.get('/stats', { preHandler: hrRole }, async () => {
    const [[totalPayroll], [pending], [instructors], [avg]] = await Promise.all([
      pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(amount), 0) as total FROM payroll_payments WHERE MONTH(payment_date) = MONTH(CURRENT_DATE) AND YEAR(payment_date) = YEAR(CURRENT_DATE)`),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM payroll_payments WHERE status = 'pending'`),
      pool.query<RowDataPacket[]>(`SELECT COUNT(DISTINCT instructor_id) as count FROM payroll_payments WHERE status = 'pending'`),
      pool.query<RowDataPacket[]>(`SELECT COALESCE(AVG(amount), 0) as average FROM payroll_payments WHERE status = 'completed'`),
    ]);
    return {
      success: true,
      data: {
        totalPayrollThisMonth: Number(totalPayroll[0]?.total ?? 0),
        pendingPayments: Number(pending[0]?.count ?? 0),
        instructorsWithPending: Number(instructors[0]?.count ?? 0),
        averagePayment: Number(avg[0]?.average ?? 0),
      },
    };
  });

  // ===== Payments listing =====
  app.get('/payments', { preHandler: hrRole }, async (request) => {
    const { page = '1', limit = '10', status = '', instructor_id = '', month = '' } = request.query as Record<string, string>;
    const safeLimit = Math.min(parseInt(limit), 100);
    const offset = (parseInt(page) - 1) * safeLimit;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (instructor_id) { where += ' AND p.instructor_id = ?'; params.push(instructor_id); }
    if (month) { where += ' AND p.payment_date >= ? AND p.payment_date < ?'; params.push(...monthRangeOrThrow(month)); }

    // PayrollManagement.tsx reads these in camelCase, both for the list rows
    // and for the detail dialog (populated from a list row, not the
    // separate /payments/:id endpoint).
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, u.username as instructor_name, u.username as instructorName,
              u.email as instructor_email, u.email as instructorEmail,
              p.instructor_id as instructorId, p.payment_date as paymentDate,
              p.payment_method as paymentMethod, p.transaction_id as transactionId,
              p.hr_notes as hrNotes, p.created_at as createdAt
       FROM payroll_payments p JOIN users u ON p.instructor_id = u.id
       ${where} ORDER BY p.payment_date DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM payroll_payments p ${where}`, params
    );
    const total = Number(countRows[0]?.total ?? 0);

    return {
      success: true,
      data: { payments: rows, pagination: { page: parseInt(page), limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } },
    };
  });

  // ===== Calculate payroll =====
  app.post('/calculate/:instructorId', { preHandler: hrRole }, async (request, reply) => {
    const { instructorId } = request.params as { instructorId: string };
    const { start_date, end_date, hourly_rate: overrideRate } = calculateSchema.parse(request.body);

    const [[timesheetData], [instructorRows]] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT SUM(total_hours) as total_hours, SUM(courses_taught) as total_courses, COUNT(*) as timesheet_count
         FROM timesheets WHERE instructor_id = ? AND status = 'approved' AND week_start_date >= ? AND week_start_date <= ?`,
        [instructorId, start_date, end_date]
      ),
      pool.query<RowDataPacket[]>('SELECT username, email FROM users WHERE id = ?', [instructorId]),
    ]);

    if (instructorRows.length === 0) return reply.status(404).send({ error: 'Instructor not found' });

    const ts = timesheetData[0] ?? {};
    const totalHours = Number(ts.total_hours ?? 0);
    const totalCourses = Number(ts.total_courses ?? 0);

    let payRate = overrideRate ?? 25;
    let courseBonusRate = 50;
    let tierName = 'Default';
    let isDefaultRate = true;

    if (!overrideRate) {
      const [rateRows] = await pool.query<RowDataPacket[]>(
        `SELECT ipr.hourly_rate, ipr.course_bonus, prt.name as tier_name
         FROM instructor_pay_rates ipr LEFT JOIN pay_rate_tiers prt ON ipr.tier_id = prt.id
         WHERE ipr.instructor_id = ? AND ipr.is_active = true AND ipr.effective_date <= ?
         AND (ipr.end_date IS NULL OR ipr.end_date >= ?)
         ORDER BY ipr.effective_date DESC LIMIT 1`,
        [instructorId, start_date, start_date]
      );
      if (rateRows.length > 0) {
        payRate = Number(rateRows[0].hourly_rate);
        courseBonusRate = Number(rateRows[0].course_bonus);
        tierName = rateRows[0].tier_name || 'Custom';
        isDefaultRate = false;
      }
    }

    const baseAmount = totalHours * payRate;
    const courseBonus = totalCourses * courseBonusRate;

    return {
      success: true,
      data: {
        instructor: instructorRows[0],
        period: { start_date, end_date },
        timesheets: { count: Number(ts.timesheet_count ?? 0), totalHours, totalCourses },
        rates: { hourlyRate: payRate, courseBonus: courseBonusRate, tierName, isDefaultRate },
        calculation: { baseAmount, courseBonus, totalAmount: baseAmount + courseBonus },
      },
    };
  });

  // ===== Process payment =====
  app.post('/payments/:paymentId/process', { preHandler: hrRole }, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const { action, transaction_id, notes } = processPaymentSchema.parse(request.body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [payRows] = await conn.query<RowDataPacket[]>(
        "SELECT * FROM payroll_payments WHERE id = ? AND status = 'pending'", [paymentId]
      );
      if (payRows.length === 0) { await conn.rollback(); return reply.status(404).send({ error: 'Payment not found or already processed' }); }

      const newStatus = action === 'approve' ? 'completed' : 'rejected';
      await conn.query(
        'UPDATE payroll_payments SET status = ?, transaction_id = ?, hr_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newStatus, transaction_id ?? null, notes, paymentId]
      );
      await writeAudit(conn, { userId: request.userId, action: action === 'approve' ? 'complete_payroll_payment' : 'reject_payroll_payment', entityType: 'payroll_payment', entityId: parseInt(paymentId), details: { instructorId: payRows[0].instructor_id, amount: Number(payRows[0].amount), transactionId: transaction_id, notes }, ipAddress: request.ip });
      await conn.commit();
      return { success: true, message: `Payment ${action}d successfully.` };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });
}
