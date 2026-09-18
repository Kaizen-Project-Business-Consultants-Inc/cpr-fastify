import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { OrganizationService, OrgError } from '../services/OrganizationService.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { CourseService, CourseError } from '../services/CourseService.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { toCSV } from '../utils/csv.js';
import type { RowDataPacket } from 'mysql2/promise';

const updateProfileSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().default(''),
  contactPhone: z.string().optional().default(''),
  contactEmail: z.string().email().optional().default(''),
});

const courseRequestSchema = z.object({
  courseTypeId: z.number().int().positive(),
  scheduledDate: z.string().min(1),
  location: z.string().min(1),
  locationId: z.number().int().positive().optional(),
  registeredStudents: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof OrgError || err instanceof CourseError) return reply.status(err.statusCode).send({ error: err.message });
  throw err;
}

export async function organizationRoutes(app: FastifyInstance) {
  const service = new OrganizationService(new OrganizationRepository());
  const courseService = new CourseService(
    new CourseRequestRepository(),
    new CourseStudentRepository(),
    new UserRepository(),
  );
  const orgRole = [requireRole('organization')];
  const adminRole = [requireRole('admin', 'sysadmin')];

  // ===== Org user: get own org =====
  app.get('/profile', { preHandler: orgRole }, async (request, reply) => {
    try {
      if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked to this account' });
      return { success: true, data: await service.getOrganization(request.userOrgId) };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Org user: update own org =====
  app.put('/profile', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked to this account' });
    const data = updateProfileSchema.parse(request.body);
    try {
      return { success: true, data: await service.updateProfile(request.userOrgId, data) };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Org user: export courses CSV =====
  app.get('/courses/export/csv', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked' });
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.scheduled_date, ct.name as course_type, cr.location,
              CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as instructor,
              cr.registered_students, cr.status
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cr.organization_id = ?
       ORDER BY cr.scheduled_date DESC`,
      [request.userOrgId]
    );
    const csv = toCSV(rows, [
      { key: 'scheduled_date', label: 'Scheduled Date' },
      { key: 'course_type', label: 'Course Type' },
      { key: 'location', label: 'Location' },
      { key: 'instructor', label: 'Instructor' },
      { key: 'registered_students', label: 'Students Registered' },
      { key: 'status', label: 'Status' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="courses-${new Date().toISOString().split('T')[0]}.csv"`);
    return reply.send(csv);
  });

  // ===== Org user: export roster CSV =====
  app.get('/roster/export/csv', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked' });
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.first_name, s.last_name, s.email, s.phone,
              ct.name as course_type, cr.scheduled_date as course_date,
              cs.attended, cs.certificate_number, cs.certificate_expires_at
       FROM course_students cs
       JOIN students s ON cs.student_id = s.id
       JOIN course_requests cr ON cs.course_request_id = cr.id
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       WHERE cr.organization_id = ?
       ORDER BY cr.scheduled_date DESC, s.last_name, s.first_name`,
      [request.userOrgId]
    );
    const csv = toCSV(rows, [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'course_type', label: 'Course' },
      { key: 'course_date', label: 'Date' },
      { key: 'attended', label: 'Attendance' },
      { key: 'certificate_number', label: 'Certificate Number' },
      { key: 'certificate_expires_at', label: 'Certificate Expiry' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="roster-${new Date().toISOString().split('T')[0]}.csv"`);
    return reply.send(csv);
  });

  // ===== Admin: get any org =====
  app.get('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { success: true, data: await service.getOrganization(parseInt(id)) };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Admin: update any org =====
  app.put('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateProfileSchema.parse(request.body);
    try {
      return { success: true, data: await service.updateProfile(parseInt(id), data) };
    } catch (err) { return handleError(err, reply); }
  });

  // ===== Org user: own courses =====
  app.get('/courses', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked' });
    const { page = '1', limit = '50', from, to } = request.query as Record<string, string>;
    const dateRange = (from || to) ? { from, to } : undefined;
    const result = await service.getCourses(request.userOrgId, parseInt(page), parseInt(limit), dateRange);
    return { success: true, data: result.rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: result.total } };
  });

  // ===== Org user: archived courses =====
  app.get('/archive', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked' });
    const { from, to } = request.query as Record<string, string>;
    const dateRange = (from || to) ? { from, to } : undefined;
    const result = await service.getArchivedCourses(request.userOrgId, dateRange);
    return { success: true, data: result.rows };
  });

  // ===== Org dashboard =====
  app.get('/dashboard', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked' });
    const pool = getPool();
    const orgId = request.userOrgId;
    const { from, to } = request.query as Record<string, string>;

    let dateFilter = '';
    const dateParams: unknown[] = [];
    if (from) { dateFilter += ' AND cr.date_scheduled >= ?'; dateParams.push(from); }
    if (to) { dateFilter += ' AND cr.date_scheduled <= ?'; dateParams.push(to); }

    let invoiceDateFilter = '';
    const invoiceDateParams: unknown[] = [];
    if (from) { invoiceDateFilter += ' AND i.created_at >= ?'; invoiceDateParams.push(from); }
    if (to) { invoiceDateFilter += ' AND i.created_at <= ?'; invoiceDateParams.push(to); }

    const [[activeCourses], [completedCourses], [pendingInvoices], [totalSpent],
           [coursesThisYear], [coursesLastYear], [studentsThisYear], [studentsLastYear], [revenueThisYear], [revenueLastYear]] = await Promise.all([
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM course_requests cr WHERE cr.organization_id = ? AND cr.status = 'confirmed'${dateFilter}`, [orgId, ...dateParams]),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM course_requests cr WHERE cr.organization_id = ? AND cr.status = 'completed'${dateFilter}`, [orgId, ...dateParams]),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM invoices i WHERE i.organization_id = ? AND i.status IN ('posted_to_org', 'overdue')${invoiceDateFilter}`, [orgId, ...invoiceDateParams]),
      pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(p.amount), 0) as total FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.organization_id = ?${invoiceDateFilter}`, [orgId, ...invoiceDateParams]),
      // YoY: courses this year vs last year
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM course_requests WHERE organization_id = ? AND YEAR(created_at) = YEAR(CURDATE())`, [orgId]),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM course_requests WHERE organization_id = ? AND YEAR(created_at) = YEAR(CURDATE()) - 1`, [orgId]),
      // YoY: students this year vs last year
      pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(cr.registered_students), 0) as count FROM course_requests cr WHERE cr.organization_id = ? AND YEAR(cr.created_at) = YEAR(CURDATE())`, [orgId]),
      pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(cr.registered_students), 0) as count FROM course_requests cr WHERE cr.organization_id = ? AND YEAR(cr.created_at) = YEAR(CURDATE()) - 1`, [orgId]),
      // YoY: revenue this year vs last year
      pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(p.amount), 0) as total FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.organization_id = ? AND YEAR(p.created_at) = YEAR(CURDATE())`, [orgId]),
      pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(p.amount), 0) as total FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.organization_id = ? AND YEAR(p.created_at) = YEAR(CURDATE()) - 1`, [orgId]),
    ]);

    return {
      success: true,
      data: {
        activeCourses: Number(activeCourses[0]?.count ?? 0),
        completedCourses: Number(completedCourses[0]?.count ?? 0),
        pendingInvoices: Number(pendingInvoices[0]?.count ?? 0),
        totalSpent: Number(totalSpent[0]?.total ?? 0),
        coursesThisYear: Number(coursesThisYear[0]?.count ?? 0),
        coursesLastYear: Number(coursesLastYear[0]?.count ?? 0),
        studentsThisYear: Number(studentsThisYear[0]?.count ?? 0),
        studentsLastYear: Number(studentsLastYear[0]?.count ?? 0),
        revenueThisYear: Number(revenueThisYear[0]?.total ?? 0),
        revenueLastYear: Number(revenueLastYear[0]?.total ?? 0),
      },
    };
  });

  // ===== Org course request (POST /organization/course-request) =====
  app.post('/course-request', { preHandler: orgRole }, async (request, reply) => {
    if (!request.userOrgId) return reply.status(400).send({ error: 'No organization linked' });
    const { courseTypeId, scheduledDate, location, locationId, registeredStudents, notes } = courseRequestSchema.parse(request.body);

    try {
      const course = await courseService.createRequest({
        organizationId: request.userOrgId,
        courseTypeId,
        scheduledDate,
        location,
        locationId,
        registeredStudents,
        notes,
      });
      return { success: true, message: 'Course request submitted successfully', data: course };
    } catch (err) { return handleError(err, reply); }
  });
}
