import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { emailService } from '../services/EmailService.js';
import { env } from '../config/env.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const previewSchema = z.object({
  variables: z.record(z.string()).default({}),
});

const cloneSchema = z.object({
  name: z.string().min(1, 'New template name is required'),
});

const testSendSchema = z.object({
  to: z.string().email('Valid recipient email is required'),
});

const templateSchema = z.object({
  name: z.string().min(1),
  key: z.string().optional(),
  category: z.union([z.string(), z.array(z.string())]),
  subCategory: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().optional(),
  htmlContent: z.string().optional(),
  textContent: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function emailTemplateRoutes(app: FastifyInstance) {
  const pool = getPool();
  const adminRole = [requireRole('admin', 'sysadmin')];

  // Get all email templates
  app.get('/', { preHandler: adminRole }, async (request) => {
    const { category, active, search, page = '1', limit = '100' } = request.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let where = '';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) { conditions.push('category = ?'); params.push(category); }
    if (active === 'true') { conditions.push('is_active = true'); }
    if (search) { conditions.push('(name LIKE ? OR subject LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (conditions.length > 0) where = 'WHERE ' + conditions.join(' AND ');

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM email_templates ${where} ORDER BY category, name LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM email_templates ${where}`, params
    );
    const total = Number(countRows[0]?.count ?? 0);

    return { success: true, data: rows, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } };
  });

  // Get single template
  app.get('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [parseInt(id)]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Template not found' });
    return { success: true, data: rows[0] };
  });

  // Create template
  app.post('/', { preHandler: adminRole }, async (request) => {
    const data = templateSchema.parse(request.body);
    const category = Array.isArray(data.category) ? data.category[0] : data.category;
    const body = data.htmlContent || data.body || data.textContent || '';
    const key = data.key || data.name.toUpperCase().replace(/\s+/g, '_');

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO email_templates (name, \`key\`, category, sub_category, subject, body, is_active, is_system, created_by, last_modified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, false, ?, ?)`,
      [data.name, key, category, data.subCategory ?? null, data.subject, body,
       data.isActive ?? true, request.userId, request.userId]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [result.insertId]);
    return { success: true, data: rows[0] };
  });

  // Update template
  app.put('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = templateSchema.partial().parse(request.body);
    const category = data.category ? (Array.isArray(data.category) ? data.category[0] : data.category) : null;
    const body = data.htmlContent || data.body || data.textContent || null;

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE email_templates SET
       name = COALESCE(?, name), category = COALESCE(?, category),
       sub_category = COALESCE(?, sub_category), subject = COALESCE(?, subject),
       body = COALESCE(?, body), is_active = COALESCE(?, is_active),
       last_modified_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [data.name ?? null, category, data.subCategory ?? null, data.subject ?? null,
       body, data.isActive ?? null, request.userId, parseInt(id)]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Template not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [parseInt(id)]);
    return { success: true, data: rows[0] };
  });

  // Delete template
  app.delete('/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM email_templates WHERE id = ?', [parseInt(id)]);
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Template not found' });
    return { success: true, message: 'Email template deleted successfully' };
  });

  // Preview template
  app.post('/:id/preview', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [parseInt(id)]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Template not found' });

    const { variables } = previewSchema.parse(request.body);
    let rendered = rows[0].body || '';
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return { success: true, data: { subject: rows[0].subject, body: rendered } };
  });

  // Clone template
  app.post('/:id/clone', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [parseInt(id)]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Template not found' });

    const { name } = cloneSchema.parse(request.body);

    const original = rows[0];
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO email_templates (name, \`key\`, category, sub_category, subject, body, is_active, is_system, created_by, last_modified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, false, ?, ?)`,
      [name, name.toLowerCase().replace(/\s+/g, '_'), original.category, original.sub_category,
       original.subject, original.body, original.is_active, request.userId, request.userId]
    );
    const [newRows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Email template cloned successfully', data: newRows[0] };
  });

  // Test-send a template
  app.post('/:id/test-send', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { to } = testSendSchema.parse(request.body);

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM email_templates WHERE id = ?', [parseInt(id)]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Template not found' });

    const template = rows[0];
    const connected = await emailService.verifyConnection();
    if (!connected) return reply.status(503).send({ error: 'Email service not configured (RESEND_API_KEY missing)' });

    // Replace sample variables
    let rendered = template.body || '';
    const sampleVars: Record<string, string> = {
      firstName: 'Test', lastName: 'User', email: to,
      courseType: 'Basic CPR', courseDate: 'January 15, 2026',
      courseTime: '9:00 AM - 12:00 PM', location: 'Main Training Center',
      organization: 'Sample Organization', instructorName: 'Dr. John Smith',
      appName: 'CPR Training System', appUrl: 'https://stagecprapp.kpbc.ca',
      currentYear: new Date().getFullYear().toString(),
    };
    for (const [key, value] of Object.entries(sampleVars)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    // Use the raw sendEmail via a direct Resend call
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [to],
          subject: `[TEST] ${template.subject}`,
          html: rendered,
        }),
      });
      const data = await response.json() as { id?: string; message?: string };
      if (!response.ok) return reply.status(502).send({ error: 'Resend API error', details: data });
      return { success: true, message: `Test email sent to ${to}`, data: { resendId: data.id } };
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to send test email', details: (err as Error).message });
    }
  });

  // Verify email service connection
  app.get('/status', { preHandler: adminRole }, async () => {
    const connected = await emailService.verifyConnection();
    return { success: true, data: { configured: connected, provider: 'resend' } };
  });

  // Get event triggers metadata
  app.get('/meta/event-triggers', { preHandler: adminRole }, async () => {
    return {
      success: true,
      data: [
        { value: 'course_assigned_instructor', label: 'Course Assigned to Instructor', category: 'course' },
        { value: 'course_scheduled_organization', label: 'Course Scheduled for Organization', category: 'course' },
        { value: 'course_reminder_instructor', label: 'Course Reminder - Instructor', category: 'reminder' },
        { value: 'course_reminder_student', label: 'Course Reminder - Student', category: 'reminder' },
        { value: 'course_cancelled', label: 'Course Cancelled', category: 'course' },
        { value: 'course_completed', label: 'Course Completed', category: 'course' },
        { value: 'instructor_approved', label: 'Instructor Application Approved', category: 'notification' },
        { value: 'instructor_rejected', label: 'Instructor Application Rejected', category: 'notification' },
        { value: 'organization_approved', label: 'Organization Application Approved', category: 'notification' },
        { value: 'organization_rejected', label: 'Organization Application Rejected', category: 'notification' },
        { value: 'password_reset', label: 'Password Reset', category: 'system' },
        { value: 'account_created', label: 'Account Created', category: 'system' },
        { value: 'custom', label: 'Custom Event', category: 'custom' },
      ],
    };
  });

  // Get template variables metadata
  app.get('/meta/variables', { preHandler: adminRole }, async () => {
    return {
      success: true,
      data: [
        { name: 'firstName', description: 'User first name', sampleValue: 'John' },
        { name: 'lastName', description: 'User last name', sampleValue: 'Doe' },
        { name: 'email', description: 'User email address', sampleValue: 'john.doe@example.com' },
        { name: 'courseType', description: 'Type of course', sampleValue: 'Basic CPR Training' },
        { name: 'courseDate', description: 'Course date', sampleValue: 'January 15, 2024' },
        { name: 'courseTime', description: 'Course time', sampleValue: '9:00 AM - 12:00 PM' },
        { name: 'location', description: 'Course location', sampleValue: 'Main Training Center' },
        { name: 'organization', description: 'Organization name', sampleValue: 'Sample Organization' },
        { name: 'instructorName', description: 'Instructor full name', sampleValue: 'Dr. John Smith' },
        { name: 'appName', description: 'Application name', sampleValue: 'CPR Training System' },
        { name: 'appUrl', description: 'Application URL', sampleValue: 'https://cpr-training.com' },
        { name: 'currentYear', description: 'Current year', sampleValue: new Date().getFullYear().toString() },
      ],
    };
  });
}
