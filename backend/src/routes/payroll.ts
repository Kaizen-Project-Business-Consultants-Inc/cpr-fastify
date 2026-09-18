import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const createPaymentSchema = z.object({
  instructor_id: z.number().int().positive(),
  amount: z.number().positive(),
  payment_date: z.string(),
  payment_method: z.string().default('direct_deposit'),
  notes: z.string().optional().default(''),
});

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
    if (month) { where += ' AND MONTH(p.payment_date) = ?'; params.push(month); }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, u.username as instructor_name, u.email as instructor_email
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

  // ===== Payment detail =====
  app.get('/payments/:paymentId', { preHandler: hrRole }, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, u.username as instructor_name, u.email as instructor_email
       FROM payroll_payments p JOIN users u ON p.instructor_id = u.id WHERE p.id = ?`,
      [paymentId]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Payment not found' });
    return { success: true, data: rows[0] };
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

  // ===== Create payment =====
  app.post('/payments', { preHandler: hrRole }, async (request, reply) => {
    const data = createPaymentSchema.parse(request.body);
    const [instrCheck] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE id = ? AND role = 'instructor'", [data.instructor_id]
    );
    if (instrCheck.length === 0) return reply.status(404).send({ error: 'Instructor not found' });

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO payroll_payments (instructor_id, amount, payment_date, payment_method, notes, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [data.instructor_id, data.amount, data.payment_date, data.payment_method, data.notes]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM payroll_payments WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Payment created successfully.', data: rows[0] };
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
      await conn.commit();
      return { success: true, message: `Payment ${action}d successfully.` };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  });

  // ===== Report =====
  app.get('/report', { preHandler: hrRole }, async (request) => {
    const { start_date, end_date, instructor_id } = request.query as Record<string, string>;
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (start_date) { where += ' AND p.payment_date >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND p.payment_date <= ?'; params.push(end_date); }
    if (instructor_id) { where += ' AND p.instructor_id = ?'; params.push(instructor_id); }

    const [[summary], [byInstructor], [byMonth]] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as total_payments,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_payments,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_payments,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN amount END), 0) as total_paid,
                COALESCE(AVG(CASE WHEN status = 'completed' THEN amount END), 0) as average_payment
         FROM payroll_payments p ${where}`,
        params
      ),
      pool.query<RowDataPacket[]>(
        `SELECT p.instructor_id, u.username as instructor_name, COUNT(*) as payment_count,
                COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount END), 0) as total_paid,
                COALESCE(AVG(CASE WHEN p.status = 'completed' THEN p.amount END), 0) as average_payment
         FROM payroll_payments p JOIN users u ON p.instructor_id = u.id
         ${where} GROUP BY p.instructor_id, u.username ORDER BY total_paid DESC`,
        params
      ),
      pool.query<RowDataPacket[]>(
        `SELECT YEAR(payment_date) as year, MONTH(payment_date) as month,
                COUNT(*) as payment_count,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN amount END), 0) as total_paid
         FROM payroll_payments p ${where}
         GROUP BY YEAR(payment_date), MONTH(payment_date) ORDER BY year DESC, month DESC`,
        params
      ),
    ]);

    return { success: true, data: { summary: summary[0], byInstructor, byMonth } };
  });

  // ===== Instructor payroll summary =====
  app.get('/instructor/:instructorId/summary', { preHandler: hrRole }, async (request, reply) => {
    const { instructorId } = request.params as { instructorId: string };
    const [[instrRows], [summary], [recent]] = await Promise.all([
      pool.query<RowDataPacket[]>('SELECT username, email FROM users WHERE id = ?', [instructorId]),
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as total_payments,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_payments,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN amount END), 0) as total_paid,
                COALESCE(AVG(CASE WHEN status = 'completed' THEN amount END), 0) as average_payment,
                MAX(payment_date) as last_payment_date
         FROM payroll_payments WHERE instructor_id = ?`,
        [instructorId]
      ),
      pool.query<RowDataPacket[]>(
        'SELECT * FROM payroll_payments WHERE instructor_id = ? ORDER BY payment_date DESC LIMIT 5',
        [instructorId]
      ),
    ]);
    if (instrRows.length === 0) return reply.status(404).send({ error: 'Instructor not found' });
    return { success: true, data: { instructor: instrRows[0], summary: summary[0], recentPayments: recent } };
  });
}
