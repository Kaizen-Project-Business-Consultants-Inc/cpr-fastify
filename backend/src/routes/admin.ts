import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import bcrypt from 'bcryptjs';
import { StudentRepository } from '../repositories/StudentRepository.js';
import { parsePagination, paginatedQuery } from '../utils/pagination.js';
import { toCSV } from '../utils/csv.js';
import { CertReminderService } from '../services/CertReminderService.js';
import { logAudit } from '../utils/auditLog.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  role: z.enum(['admin', 'instructor', 'organization', 'accountant', 'hr', 'courseadmin', 'vendor', 'sysadmin']),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  organizationId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
});

const createCourseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  duration_minutes: z.number().int().positive(),
  course_code: z.string().optional(),
  is_active: z.boolean().default(true),
  certification_validity_months: z.number().int().min(1).max(120).nullable().optional(),
});

const createOrgSchema = z.object({
  name: z.string().min(1),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().optional(),
  address: z.string().optional(),
});

const vendorBodySchema = z.object({
  vendor_name: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  contactEmail: z.string().email().optional(),
  contact_email: z.string().email().optional(),
  phone: z.string().optional(),
  contact_phone: z.string().optional(),
  address: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_province: z.string().optional(),
  address_postal_code: z.string().optional(),
  vendor_type: z.string().optional(),
  is_active: z.boolean().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  const pool = getPool();
  const adminRole = [requireRole('admin', 'sysadmin')];
  const sysadminRole = [requireRole('sysadmin')];

  // ===== Course type management =====
  app.get('/courses', { preHandler: adminRole }, async () => {
    const [rows] = await pool.query<any[]>(
      `SELECT id, name, description, duration_minutes, course_code,
              certification_validity_months,
              COALESCE(is_active, true) as is_active, created_at, updated_at
       FROM class_types ORDER BY name`
    );
    return { success: true, data: rows };
  });

  app.post('/courses', { preHandler: adminRole }, async (request, reply) => {
    const data = createCourseSchema.parse(request.body);
    const [existing] = await pool.query<any[]>('SELECT id FROM class_types WHERE LOWER(name) = LOWER(?)', [data.name]);
    if (existing.length > 0) return reply.status(400).send({ error: 'A course with this name already exists' });

    const [result] = await pool.query<any>(
      'INSERT INTO class_types (name, description, duration_minutes, course_code, is_active, certification_validity_months) VALUES (?, ?, ?, ?, ?, ?)',
      [data.name, data.description ?? null, data.duration_minutes, data.course_code ?? null, data.is_active, data.certification_validity_months ?? null]
    );
    const [rows] = await pool.query<any[]>('SELECT * FROM class_types WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Course created successfully', data: rows[0] };
  });

  app.put('/courses/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, description, duration_minutes, course_code, is_active, certification_validity_months } = createCourseSchema.partial().parse(request.body);

    if (name) {
      const [dup] = await pool.query<any[]>('SELECT id FROM class_types WHERE LOWER(name) = LOWER(?) AND id != ?', [name, id]);
      if (dup.length > 0) return reply.status(400).send({ error: 'A course with this name already exists' });
    }

    const [result] = await pool.query<any>(
      `UPDATE class_types SET name = COALESCE(?, name), description = COALESCE(?, description),
       duration_minutes = COALESCE(?, duration_minutes), course_code = COALESCE(?, course_code),
       is_active = COALESCE(?, is_active),
       certification_validity_months = ${certification_validity_months !== undefined ? '?' : 'certification_validity_months'},
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name ?? null, description ?? null, duration_minutes ?? null, course_code ?? null, is_active ?? null,
       ...(certification_validity_months !== undefined ? [certification_validity_months ?? null] : []), id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Course not found' });
    const [rows] = await pool.query<any[]>('SELECT * FROM class_types WHERE id = ?', [id]);
    return { success: true, message: 'Course updated successfully', data: rows[0] };
  });

  app.put('/courses/:id/toggle-active', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<any>(
      'UPDATE class_types SET is_active = NOT COALESCE(is_active, true), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Course not found' });
    const [rows] = await pool.query<any[]>('SELECT * FROM class_types WHERE id = ?', [id]);
    return { success: true, message: `Course ${rows[0].is_active ? 'activated' : 'deactivated'} successfully`, data: rows[0] };
  });

  app.delete('/courses/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [usage] = await pool.query<any[]>('SELECT COUNT(*) as count FROM course_requests WHERE course_type_id = ?', [id]);
    if (Number(usage[0].count) > 0) {
      await pool.query('UPDATE class_types SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      const [rows] = await pool.query<any[]>('SELECT * FROM class_types WHERE id = ?', [id]);
      return { success: true, message: `Course deactivated (${usage[0].count} course requests exist)`, data: rows[0], softDeleted: true };
    }
    const [result] = await pool.query<any>('DELETE FROM class_types WHERE id = ?', [id]);
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Course not found' });
    return { success: true, message: 'Course deleted permanently', softDeleted: false };
  });

  // ===== User management =====
  app.get('/users', { preHandler: adminRole }, async (request) => {
    const { search = '', role = '' } = request.query as Record<string, string>;
    const pg = parsePagination(request.query as Record<string, string>);

    let where = '';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (search) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (role) { conditions.push('u.role = ?'); params.push(role); }
    if (conditions.length > 0) where = 'WHERE ' + conditions.join(' AND ');

    const result = await paginatedQuery(
      `SELECT u.id, u.username, u.email, u.role, u.phone, u.mobile,
              u.first_name, u.last_name, u.full_name,
              u.organization_id, o.name as organization_name,
              u.location_id, ol.location_name,
              u.date_onboarded, u.date_offboarded, u.user_comments, u.status,
              u.created_at, u.updated_at
       FROM users u
       LEFT JOIN organizations o ON u.organization_id = o.id
       LEFT JOIN organization_locations ol ON u.location_id = ol.id
       ${where} ORDER BY u.created_at DESC`,
      `SELECT COUNT(*) as count FROM users u ${where}`,
      params,
      pg,
    );

    return { success: true, ...result };
  });

  // Roles that only a sysadmin may assign or administer.
  const PRIVILEGED_ROLES = ['admin', 'sysadmin'];

  async function targetIsPrivileged(userId: string | number): Promise<boolean> {
    const [rows] = await pool.query<any[]>('SELECT role FROM users WHERE id = ?', [userId]);
    return rows.length > 0 && PRIVILEGED_ROLES.includes(rows[0].role);
  }

  app.post('/users', { preHandler: adminRole }, async (request, reply) => {
    const data = createUserSchema.parse(request.body);

    // Only a sysadmin may create admin/sysadmin accounts
    if (PRIVILEGED_ROLES.includes(data.role) && request.userRole !== 'sysadmin') {
      return reply.status(403).send({ error: 'Only a system administrator can create admin or sysadmin users' });
    }

    // Check duplicates
    const [existingUser] = await pool.query<any[]>(
      'SELECT id FROM users WHERE username = ? OR email = ?', [data.username, data.email]
    );
    if (existingUser.length > 0) return reply.status(400).send({ error: 'Username or email already exists' });

    if (!data.password) return reply.status(400).send({ error: 'Password is required' });
    const password = data.password;
    const hash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

    const [result] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role, first_name, last_name,
       phone, mobile, organization_id, location_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.username, data.email, hash, data.role, data.firstName ?? null, data.lastName ?? null,
       data.phone ?? null, data.mobile ?? null, data.organizationId ?? null, data.locationId ?? null]
    );
    const [rows] = await pool.query<any[]>(
      'SELECT id, username, email, role, first_name, last_name, organization_id, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    logAudit({ userId: request.userId, username: request.userRole, action: 'create_user', entityType: 'user', entityId: result.insertId, details: { username: data.username, role: data.role }, ipAddress: request.ip });
    return { success: true, message: 'User created successfully', data: rows[0] };
  });

  app.put('/users/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { username, email, role, firstName, lastName, phone, mobile, organizationId, locationId, status } = createUserSchema.extend({
      status: z.enum(['active', 'inactive', 'deleted']).optional(),
    }).partial().parse(request.body);

    // Only a sysadmin may grant admin/sysadmin, or modify an existing admin/sysadmin account
    if (request.userRole !== 'sysadmin') {
      if ((role && PRIVILEGED_ROLES.includes(role)) || (await targetIsPrivileged(id))) {
        return reply.status(403).send({ error: 'Only a system administrator can modify admin or sysadmin users' });
      }
    }

    const [result] = await pool.query<any>(
      `UPDATE users SET username = COALESCE(?, username), email = COALESCE(?, email),
       role = COALESCE(?, role), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
       phone = COALESCE(?, phone), mobile = COALESCE(?, mobile),
       organization_id = COALESCE(?, organization_id), location_id = COALESCE(?, location_id),
       status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [username ?? null, email ?? null, role ?? null, firstName ?? null, lastName ?? null,
       phone ?? null, mobile ?? null, organizationId ?? null, locationId ?? null, status ?? null, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'User not found' });
    const [rows] = await pool.query<any[]>(
      `SELECT id, username, email, full_name, first_name, last_name, role,
              organization_id, location_id, status, phone, mobile, address,
              date_onboarded, date_offboarded, created_at, updated_at
       FROM users WHERE id = ?`, [id]
    );
    logAudit({ userId: request.userId, action: 'update_user', entityType: 'user', entityId: parseInt(id), details: { username, email, role, status }, ipAddress: request.ip });
    return { success: true, message: 'User updated successfully', data: rows[0] };
  });

  app.post('/users/:id/reset-password', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { password } = z.object({ password: z.string().min(8) }).parse(request.body);
    // Only a sysadmin may reset an admin/sysadmin password
    if (request.userRole !== 'sysadmin' && (await targetIsPrivileged(id))) {
      return reply.status(403).send({ error: 'Only a system administrator can reset admin or sysadmin passwords' });
    }
    const hash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
    const [result] = await pool.query<any>(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hash, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'User not found' });
    return { success: true, message: 'Password reset successfully' };
  });

  // ===== Organization management =====
  app.get('/organizations', { preHandler: adminRole }, async (request) => {
    const { search = '' } = request.query as Record<string, string>;
    const pg = parsePagination(request.query as Record<string, string>);

    let where = '';
    const params: unknown[] = [];
    if (search) {
      where = 'WHERE name LIKE ? OR contact_email LIKE ? OR contact_person LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const result = await paginatedQuery(
      `SELECT * FROM organizations ${where} ORDER BY name`,
      `SELECT COUNT(*) as count FROM organizations ${where}`,
      params,
      pg,
    );
    return { success: true, ...result };
  });

  app.post('/organizations', { preHandler: adminRole }, async (request) => {
    const data = createOrgSchema.parse(request.body);
    const [result] = await pool.query<any>(
      'INSERT INTO organizations (name, contact_email, contact_phone, address) VALUES (?, ?, ?, ?)',
      [data.name, data.contact_email ?? null, data.contact_phone ?? null, data.address ?? null]
    );
    const [rows] = await pool.query<any[]>('SELECT * FROM organizations WHERE id = ?', [result.insertId]);
    logAudit({ userId: request.userId, action: 'create_organization', entityType: 'organization', entityId: result.insertId, details: { name: data.name }, ipAddress: request.ip });
    return { success: true, message: 'Organization created successfully', data: rows[0] };
  });

  app.put('/organizations/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, contact_email, contact_phone, address } = createOrgSchema.partial().parse(request.body);
    const [result] = await pool.query<any>(
      `UPDATE organizations SET name = COALESCE(?, name), contact_email = COALESCE(?, contact_email),
       contact_phone = COALESCE(?, contact_phone), address = COALESCE(?, address),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name ?? null, contact_email ?? null, contact_phone ?? null, address ?? null, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Organization not found' });
    const [rows] = await pool.query<any[]>('SELECT * FROM organizations WHERE id = ?', [id]);
    logAudit({ userId: request.userId, action: 'update_organization', entityType: 'organization', entityId: parseInt(id), details: { name }, ipAddress: request.ip });
    return { success: true, message: 'Organization updated successfully', data: rows[0] };
  });

  // ===== Sysadmin: PIPEDA data erasure =====
  app.delete('/users/:userId/personal-data', { preHandler: sysadminRole }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const id = parseInt(userId);
    if (isNaN(id) || id <= 0) return reply.status(400).send({ error: 'Invalid userId' });

    const [check] = await pool.query<any[]>('SELECT id FROM users WHERE id = ?', [id]);
    if (check.length === 0) return reply.status(404).send({ error: `User ${id} not found` });

    await pool.query(
      `UPDATE users SET username = CONCAT('deleted_', id), email = CONCAT('deleted_', id, '@deleted.invalid'),
       first_name = NULL, last_name = NULL, phone = NULL, status = 'deleted' WHERE id = ?`,
      [id]
    );
    logger.info({ userId: id, sysadmin: request.userId }, 'PIPEDA personal data anonymised');
    return { success: true, message: 'Personal data anonymised' };
  });

  // ===== Instructor list for dropdowns =====
  app.get('/instructors', { preHandler: adminRole }, async () => {
    const [rows] = await pool.query<any[]>(
      `SELECT id, username, email, first_name, last_name FROM users
       WHERE role = 'instructor' AND status = 'active' ORDER BY username`
    );
    return { success: true, data: rows };
  });

  // ===== Organization locations =====
  app.get('/organizations/:orgId/locations', { preHandler: adminRole }, async (request) => {
    const { orgId } = request.params as { orgId: string };
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM organization_locations WHERE organization_id = ? ORDER BY location_name', [orgId]
    );
    return { success: true, data: rows };
  });

  // ===== System admin dashboard =====
  app.get('/dashboard', { preHandler: adminRole }, async (request) => {
    const { from, to } = request.query as Record<string, string>;

    let userDateFilter = '';
    const userDateParams: unknown[] = [];
    if (from) { userDateFilter += ' AND created_at >= ?'; userDateParams.push(from); }
    if (to) { userDateFilter += ' AND created_at <= ?'; userDateParams.push(to); }

    let orgDateFilter = '';
    const orgDateParams: unknown[] = [];
    if (from) { orgDateFilter += ' AND created_at >= ?'; orgDateParams.push(from); }
    if (to) { orgDateFilter += ' AND created_at <= ?'; orgDateParams.push(to); }

    const [[userCount], [orgCount], [courseCount], [vendorCount],
           [usersThisYear], [usersLastYear], [orgsThisYear], [orgsLastYear], [coursesThisYear], [coursesLastYear]] = await Promise.all([
      pool.query<any[]>(`SELECT COUNT(*) as count FROM users WHERE 1=1${userDateFilter}`, userDateParams),
      pool.query<any[]>(`SELECT COUNT(*) as count FROM organizations WHERE 1=1${orgDateFilter}`, orgDateParams),
      pool.query<any[]>('SELECT COUNT(*) as count FROM class_types WHERE is_active = true'),
      pool.query<any[]>('SELECT COUNT(*) as count FROM vendors WHERE is_active = true'),
      // YoY: users this year vs last year
      pool.query<any[]>('SELECT COUNT(*) as count FROM users WHERE YEAR(created_at) = YEAR(CURDATE())'),
      pool.query<any[]>('SELECT COUNT(*) as count FROM users WHERE YEAR(created_at) = YEAR(CURDATE()) - 1'),
      // YoY: organizations this year vs last year
      pool.query<any[]>('SELECT COUNT(*) as count FROM organizations WHERE YEAR(created_at) = YEAR(CURDATE())'),
      pool.query<any[]>('SELECT COUNT(*) as count FROM organizations WHERE YEAR(created_at) = YEAR(CURDATE()) - 1'),
      // YoY: course types this year vs last year
      pool.query<any[]>('SELECT COUNT(*) as count FROM class_types WHERE is_active = true AND YEAR(created_at) = YEAR(CURDATE())'),
      pool.query<any[]>('SELECT COUNT(*) as count FROM class_types WHERE is_active = true AND YEAR(created_at) = YEAR(CURDATE()) - 1'),
    ]);

    const [recentUsers] = await pool.query<any[]>(
      `SELECT username, role, created_at as createdAt FROM users WHERE 1=1${userDateFilter} ORDER BY created_at DESC LIMIT 5`,
      userDateParams
    );
    const [recentCourses] = await pool.query<any[]>(
      `SELECT name, course_code as courseCode, created_at as createdAt
       FROM class_types WHERE is_active = true ORDER BY created_at DESC LIMIT 5`
    );

    return {
      success: true,
      data: {
        summary: {
          totalUsers: Number(userCount[0]?.count ?? 0),
          totalOrganizations: Number(orgCount[0]?.count ?? 0),
          totalCourses: Number(courseCount[0]?.count ?? 0),
          totalVendors: Number(vendorCount[0]?.count ?? 0),
          usersThisYear: Number(usersThisYear[0]?.count ?? 0),
          usersLastYear: Number(usersLastYear[0]?.count ?? 0),
          orgsThisYear: Number(orgsThisYear[0]?.count ?? 0),
          orgsLastYear: Number(orgsLastYear[0]?.count ?? 0),
          coursesThisYear: Number(coursesThisYear[0]?.count ?? 0),
          coursesLastYear: Number(coursesLastYear[0]?.count ?? 0),
        },
        recentActivity: { users: recentUsers, courses: recentCourses },
      },
    };
  });

  // ===== System configurations =====
  app.get('/configurations', { preHandler: sysadminRole }, async () => {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM system_configurations ORDER BY category, config_key LIMIT 500'
    );
    return { success: true, data: rows };
  });

  app.get('/configurations/categories', { preHandler: sysadminRole }, async () => {
    const [rows] = await pool.query<any[]>(
      'SELECT DISTINCT category FROM system_configurations ORDER BY category'
    );
    return { success: true, data: rows.map((r: any) => r.category) };
  });

  app.get('/configurations/category/:category', { preHandler: sysadminRole }, async (request) => {
    const { category } = request.params as { category: string };
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM system_configurations WHERE category = ? ORDER BY config_key',
      [category]
    );
    return { success: true, data: rows };
  });

  app.get('/configurations/:key', { preHandler: sysadminRole }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM system_configurations WHERE config_key = ?', [key]
    );
    if (rows.length === 0) return reply.status(404).send({ error: `Configuration key '${key}' not found` });
    return { success: true, data: { key, value: rows[0].config_value } };
  });

  app.put('/configurations/:key', { preHandler: sysadminRole }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const { value } = request.body as { value: string };
    if (!value) return reply.status(400).send({ error: 'Configuration value is required' });

    const [result] = await pool.query<any>(
      `UPDATE system_configurations SET config_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE config_key = ?`,
      [value, request.userId, key]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: `Configuration key '${key}' not found` });
    const [rows] = await pool.query<any[]>('SELECT * FROM system_configurations WHERE config_key = ?', [key]);
    return { success: true, data: rows[0], message: `Configuration '${key}' updated successfully` };
  });

  // ===== Vendor entity CRUD (sysadmin) =====
  app.get('/vendors', { preHandler: adminRole }, async () => {
    const [rows] = await pool.query<any[]>(
      `SELECT id, name as vendorName, contact_email as email, contact_phone as phone,
              address, vendor_type as vendorType, is_active as isActive,
              created_at as createdAt, updated_at as updatedAt
       FROM vendors ORDER BY name`
    );
    const vendors = rows.map((v: any) => {
      let addressStreet = '', addressCity = '', addressProvince = '', addressPostalCode = '';
      if (v.address) {
        const parts = v.address.split(',').map((p: string) => p.trim());
        addressStreet = parts[0] || '';
        addressCity = parts[1] || '';
        addressProvince = parts[2] || '';
        addressPostalCode = parts[3] || '';
      }
      return { ...v, addressStreet, addressCity, addressProvince, addressPostalCode,
               status: v.isActive ? 'active' : 'inactive' };
    });
    return { success: true, data: vendors };
  });

  app.post('/vendors', { preHandler: adminRole }, async (request, reply) => {
    const { vendor_name, name, email, contactEmail, contact_email, phone, contact_phone,
            address, address_street, address_city, address_province, address_postal_code,
            vendor_type, is_active } = vendorBodySchema.parse(request.body);

    const vendorName = vendor_name || name;
    if (!vendorName) return reply.status(400).send({ error: 'Vendor name is required' });

    let fullAddress = address;
    if (address_street || address_city || address_province || address_postal_code) {
      fullAddress = [address_street, address_city, address_province, address_postal_code].filter(Boolean).join(', ');
    }

    const [result] = await pool.query<any>(
      'INSERT INTO vendors (name, contact_email, contact_phone, address, vendor_type, is_active) VALUES (?, ?, ?, ?, ?, COALESCE(?, true))',
      [vendorName, email || contactEmail || contact_email || null, phone || contact_phone || null,
       fullAddress || null, vendor_type || null, is_active ?? true]
    );
    const [rows] = await pool.query<any[]>('SELECT * FROM vendors WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Vendor created successfully', data: rows[0] };
  });

  app.put('/vendors/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { vendor_name, name, email, contact_email, phone, contact_phone,
            address, address_street, address_city, address_province, address_postal_code,
            vendor_type, is_active } = vendorBodySchema.parse(request.body);

    const vendorName = vendor_name || name;
    let fullAddress = address;
    if (address_street || address_city || address_province || address_postal_code) {
      fullAddress = [address_street, address_city, address_province, address_postal_code].filter(Boolean).join(', ');
    }

    const [result] = await pool.query<any>(
      `UPDATE vendors SET name = COALESCE(?, name), contact_email = COALESCE(?, contact_email),
       contact_phone = COALESCE(?, contact_phone), address = COALESCE(?, address),
       vendor_type = COALESCE(?, vendor_type), is_active = COALESCE(?, is_active),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [vendorName || null, email || contact_email || null, phone || contact_phone || null,
       fullAddress || null, vendor_type || null, is_active ?? null, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Vendor not found' });
    const [rows] = await pool.query<any[]>('SELECT * FROM vendors WHERE id = ?', [id]);
    return { success: true, message: 'Vendor updated successfully', data: rows[0] };
  });

  app.delete('/vendors/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<any>(
      'UPDATE vendors SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Vendor not found' });
    const [rows] = await pool.query<any[]>('SELECT * FROM vendors WHERE id = ?', [id]);
    return { success: true, message: 'Vendor deactivated successfully', data: rows[0] };
  });

  // ===== Student directory =====
  const studentRepo = new StudentRepository();

  // Search students by name or email
  app.get('/students', { preHandler: adminRole }, async (request) => {
    const { q, orgId } = request.query as { q?: string; orgId?: string };

    if (orgId) {
      const students = await studentRepo.findByOrg(parseInt(orgId));
      return { success: true, data: students };
    }

    if (q && q.trim().length >= 2) {
      const students = await studentRepo.search(q.trim());
      return { success: true, data: students };
    }

    // No filter — return recent students (last 100)
    const [rows] = await pool.query<any[]>(
      `SELECT s.*, COUNT(DISTINCT cs.course_request_id) as course_count,
              MAX(cr.completed_at) as last_course_date,
              o.name as organization_name
       FROM students s
       LEFT JOIN course_students cs ON cs.student_id = s.id
       LEFT JOIN course_requests cr ON cs.course_request_id = cr.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       GROUP BY s.id
       ORDER BY s.created_at DESC LIMIT 100`
    );
    return { success: true, data: rows };
  });

  // Get single student with full course history
  app.get('/students/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const student = await studentRepo.findById(parseInt(id));
    if (!student) return reply.status(404).send({ error: 'Student not found' });

    const history = await studentRepo.getCourseHistory(parseInt(id));
    return { success: true, data: { ...student, courses: history } };
  });

  // Update student details
  app.put('/students/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = z.object({
      first_name: z.string().min(1).optional(),
      last_name: z.string().min(1).optional(),
      phone: z.string().optional(),
      organization_id: z.number().int().positive().nullable().optional(),
      notes: z.string().optional(),
    }).parse(request.body);

    const student = await studentRepo.findById(parseInt(id));
    if (!student) return reply.status(404).send({ error: 'Student not found' });

    const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
    const values = fields.map(([, v]) => v);

    await pool.query(
      `UPDATE students SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...values, id]
    );

    const updated = await studentRepo.findById(parseInt(id));
    return { success: true, data: updated };
  });

  // Update marketing consent
  app.put('/students/:id/consent', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { marketing_consent } = z.object({
      marketing_consent: z.boolean(),
    }).parse(request.body);

    const student = await studentRepo.findById(parseInt(id));
    if (!student) return reply.status(404).send({ error: 'Student not found' });

    await studentRepo.updateMarketingConsent(parseInt(id), marketing_consent);
    return { success: true, message: `Marketing consent ${marketing_consent ? 'granted' : 'revoked'}` };
  });

  // ===== Certification expiry tracking =====
  app.get('/certifications/expiring', { preHandler: adminRole }, async (request) => {
    const { days } = request.query as { days?: string };
    const withinDays = parseInt(days || '90') || 90;
    const pg = parsePagination(request.query as Record<string, string>);

    const baseFrom = `FROM course_students cs
       JOIN students s ON cs.student_id = s.id
       JOIN course_requests cr ON cs.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       WHERE cs.certificate_expires_at IS NOT NULL
         AND cs.certificate_expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
         AND cs.attended = true`;

    const result = await paginatedQuery(
      `SELECT s.id as student_id, s.email, s.first_name, s.last_name, s.phone,
              o.name as organization_name,
              ct.name as course_type_name, ct.certification_validity_months,
              cs.certificate_issued_at, cs.certificate_expires_at,
              cs.certificate_number,
              DATEDIFF(cs.certificate_expires_at, NOW()) as days_until_expiry
       ${baseFrom}
       ORDER BY cs.certificate_expires_at ASC`,
      `SELECT COUNT(*) as count ${baseFrom}`,
      [withinDays],
      pg,
    );
    return { success: true, ...result };
  });

  app.get('/certifications/expired', { preHandler: adminRole }, async (request) => {
    const pg = parsePagination(request.query as Record<string, string>);

    const baseFrom = `FROM course_students cs
       JOIN students s ON cs.student_id = s.id
       JOIN course_requests cr ON cs.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       WHERE cs.certificate_expires_at IS NOT NULL
         AND cs.certificate_expires_at < NOW()
         AND cs.attended = true`;

    const result = await paginatedQuery(
      `SELECT s.id as student_id, s.email, s.first_name, s.last_name, s.phone,
              o.name as organization_name,
              ct.name as course_type_name,
              cs.certificate_issued_at, cs.certificate_expires_at,
              cs.certificate_number,
              DATEDIFF(NOW(), cs.certificate_expires_at) as days_expired
       ${baseFrom}
       ORDER BY cs.certificate_expires_at DESC`,
      `SELECT COUNT(*) as count ${baseFrom}`,
      [],
      pg,
    );
    return { success: true, ...result };
  });

  // Summary stats for dashboard
  app.get('/certifications/stats', { preHandler: adminRole }, async () => {
    const [rows] = await pool.query<any[]>(`
      SELECT
        COUNT(CASE WHEN cs.certificate_expires_at > NOW() THEN 1 END) as active_certs,
        COUNT(CASE WHEN cs.certificate_expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY) THEN 1 END) as expiring_30d,
        COUNT(CASE WHEN cs.certificate_expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 90 DAY) THEN 1 END) as expiring_90d,
        COUNT(CASE WHEN cs.certificate_expires_at < NOW() THEN 1 END) as expired
      FROM course_students cs
      WHERE cs.certificate_expires_at IS NOT NULL AND cs.attended = true
    `);
    return { success: true, data: rows[0] };
  });

  // Manual trigger for cert reminders (sysadmin only)
  app.post('/certifications/send-reminders', { preHandler: sysadminRole }, async () => {
    const service = new CertReminderService();
    const result = await service.sendReminders();
    return { success: true, message: `Sent ${result.sent} reminders`, ...result };
  });

  // ===== CSV Exports =====

  // CSV Export: Organizations
  app.get('/organizations/export/csv', { preHandler: adminRole }, async (request, reply) => {
    const { search = '' } = request.query as Record<string, string>;
    let where = '';
    const params: unknown[] = [];
    if (search) {
      where = 'WHERE name LIKE ? OR contact_email LIKE ? OR contact_person LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query<any[]>(`SELECT * FROM organizations ${where} ORDER BY name`, params);
    const csv = toCSV(rows, [
      { key: 'name', label: 'Organization' },
      { key: 'contact_person', label: 'Contact Person' },
      { key: 'contact_email', label: 'Email' },
      { key: 'contact_phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'province', label: 'Province' },
      { key: 'created_at', label: 'Created' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="organizations-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  // CSV Export: Expiring Certifications
  app.get('/certifications/expiring/export/csv', { preHandler: adminRole }, async (request, reply) => {
    const { days = '90' } = request.query as Record<string, string>;
    const withinDays = parseInt(days) || 90;
    const [rows] = await pool.query<any[]>(
      `SELECT s.id as student_id, s.email, s.first_name, s.last_name, s.phone,
              o.name as organization_name,
              ct.name as course_type_name, ct.certification_validity_months,
              cs.certificate_issued_at, cs.certificate_expires_at,
              cs.certificate_number,
              DATEDIFF(cs.certificate_expires_at, NOW()) as days_until_expiry
       FROM course_students cs
       JOIN students s ON cs.student_id = s.id
       JOIN course_requests cr ON cs.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       WHERE cs.certificate_expires_at IS NOT NULL
         AND cs.certificate_expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
         AND cs.attended = true
       ORDER BY cs.certificate_expires_at ASC`,
      [withinDays]
    );
    const csv = toCSV(rows, [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'organization_name', label: 'Organization' },
      { key: 'course_type_name', label: 'Course' },
      { key: 'certificate_number', label: 'Certificate #' },
      { key: 'certificate_expires_at', label: 'Expires' },
      { key: 'days_until_expiry', label: 'Days Until Expiry' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="expiring-certifications-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  // ===== Audit Logs (sysadmin only) =====
  app.get('/audit-logs', { preHandler: sysadminRole }, async (request) => {
    const { action, entity_type, user_id, from, to, search, startDate, endDate } = request.query as Record<string, string>;
    const pg = parsePagination(request.query as Record<string, string>);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (entity_type) { conditions.push('entity_type = ?'); params.push(entity_type); }
    if (user_id) { conditions.push('user_id = ?'); params.push(parseInt(user_id)); }
    if (search && search.trim().length >= 2) {
      conditions.push('(username LIKE ? OR action LIKE ? OR CAST(details AS CHAR) LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }
    // Support both from/to and startDate/endDate param names
    const dateFrom = from || startDate;
    const dateTo = to || endDate;
    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('created_at <= ?'); params.push(`${dateTo} 23:59:59`); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await paginatedQuery(
      `SELECT id, user_id, username, action, entity_type, entity_id, details, ip_address, created_at
       FROM audit_logs ${where} ORDER BY created_at DESC`,
      `SELECT COUNT(*) as count FROM audit_logs ${where}`,
      params,
      pg,
    );
    return { success: true, ...result };
  });

  app.get('/audit-logs/stats', { preHandler: sysadminRole }, async () => {
    const [rows] = await pool.query<any[]>(`
      SELECT
        COUNT(*) as total_entries,
        COUNT(CASE WHEN created_at >= CURDATE() THEN 1 END) as entries_today,
        COUNT(DISTINCT user_id) as unique_users
      FROM audit_logs
    `);
    const [topActions] = await pool.query<any[]>(`
      SELECT action, COUNT(*) as count
      FROM audit_logs
      GROUP BY action
      ORDER BY count DESC
      LIMIT 5
    `);
    return {
      success: true,
      data: {
        totalEntries: Number(rows[0]?.total_entries ?? 0),
        entriesToday: Number(rows[0]?.entries_today ?? 0),
        uniqueUsers: Number(rows[0]?.unique_users ?? 0),
        topActions: topActions,
      },
    };
  });

  app.get('/audit-logs/export/csv', { preHandler: sysadminRole }, async (request, reply) => {
    const { action, entity_type, user_id, from, to } = request.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (entity_type) { conditions.push('entity_type = ?'); params.push(entity_type); }
    if (user_id) { conditions.push('user_id = ?'); params.push(parseInt(user_id)); }
    if (from) { conditions.push('created_at >= ?'); params.push(from); }
    if (to) { conditions.push('created_at <= ?'); params.push(`${to} 23:59:59`); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await pool.query<any[]>(
      `SELECT id, user_id, username, action, entity_type, entity_id, details, ip_address, created_at
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 10000`,
      params,
    );

    const csv = toCSV(rows, [
      { key: 'created_at', label: 'Timestamp' },
      { key: 'username', label: 'User' },
      { key: 'action', label: 'Action' },
      { key: 'entity_type', label: 'Entity Type' },
      { key: 'entity_id', label: 'Entity ID' },
      { key: 'ip_address', label: 'IP Address' },
      { key: 'details', label: 'Details' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  // CSV Export: Students
  app.get('/students/export/csv', { preHandler: adminRole }, async (request, reply) => {
    const { q, orgId } = request.query as { q?: string; orgId?: string };
    let where = '';
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (q && q.trim().length >= 2) {
      conditions.push('(s.first_name LIKE ? OR s.last_name LIKE ? OR s.email LIKE ?)');
      const term = `%${q.trim()}%`;
      params.push(term, term, term);
    }
    if (orgId) {
      conditions.push('s.organization_id = ?');
      params.push(parseInt(orgId));
    }
    if (conditions.length > 0) where = 'WHERE ' + conditions.join(' AND ');

    const [rows] = await pool.query<any[]>(
      `SELECT s.first_name, s.last_name, s.email, s.phone,
              o.name as organization_name,
              COUNT(DISTINCT cs.course_request_id) as course_count,
              MAX(cr.completed_at) as last_course_date,
              s.created_at
       FROM students s
       LEFT JOIN course_students cs ON cs.student_id = s.id
       LEFT JOIN course_requests cr ON cs.course_request_id = cr.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       ${where}
       GROUP BY s.id
       ORDER BY s.last_name, s.first_name`,
      params
    );
    const csv = toCSV(rows, [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'organization_name', label: 'Organization' },
      { key: 'course_count', label: 'Courses' },
      { key: 'last_course_date', label: 'Last Course' },
      { key: 'created_at', label: 'Created' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="students-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  // ===== WSIB Training History Reporting =====

  // Shared query builder for WSIB training history
  function buildWSIBQuery(query: Record<string, string>) {
    const conditions: string[] = ['cr.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (query.org_id) {
      conditions.push('s.organization_id = ?');
      params.push(parseInt(query.org_id));
    }
    if (query.search) {
      conditions.push('(s.first_name LIKE ? OR s.last_name LIKE ? OR s.email LIKE ?)');
      const term = `%${query.search}%`;
      params.push(term, term, term);
    }
    if (query.from) {
      conditions.push('cr.scheduled_date >= ?');
      params.push(query.from);
    }
    if (query.to) {
      conditions.push('cr.scheduled_date <= ?');
      params.push(query.to);
    }
    if (query.course_type_id) {
      conditions.push('cr.course_type_id = ?');
      params.push(parseInt(query.course_type_id));
    }
    if (query.course_type) {
      conditions.push('ct.name LIKE ?');
      params.push(`%${query.course_type}%`);
    }
    if (query.compliance_status) {
      if (query.compliance_status === 'valid') {
        conditions.push('cs.certificate_expires_at > NOW()');
      } else if (query.compliance_status === 'expiring') {
        conditions.push('cs.certificate_expires_at > NOW() AND cs.certificate_expires_at <= DATE_ADD(NOW(), INTERVAL 90 DAY)');
      } else if (query.compliance_status === 'expired') {
        conditions.push('(cs.certificate_expires_at IS NOT NULL AND cs.certificate_expires_at <= NOW())');
      }
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const selectSQL = `SELECT s.first_name, s.last_name, s.email,
              o.name as organization_name,
              ct.name as course_type_name,
              cr.scheduled_date as course_date,
              cr.location,
              cs.attended,
              cs.certificate_number,
              cs.certificate_issued_at,
              cs.certificate_expires_at,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username) as instructor_name,
              CASE
                WHEN cs.certificate_expires_at IS NULL THEN 'expired'
                WHEN cs.certificate_expires_at <= NOW() THEN 'expired'
                WHEN cs.certificate_expires_at <= DATE_ADD(NOW(), INTERVAL 90 DAY) THEN 'expiring'
                ELSE 'valid'
              END as compliance_status
       FROM course_students cs
       JOIN students s ON cs.student_id = s.id
       JOIN course_requests cr ON cs.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       ${where}
       ORDER BY s.last_name, s.first_name, cr.scheduled_date DESC`;

    const countSQL = `SELECT COUNT(*) as count
       FROM course_students cs
       JOIN students s ON cs.student_id = s.id
       JOIN course_requests cr ON cs.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON s.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       ${where}`;

    return { selectSQL, countSQL, params };
  }

  // Paginated WSIB training history
  app.get('/wsib/training-history', { preHandler: adminRole }, async (request) => {
    const q = request.query as Record<string, string>;
    const pg = parsePagination(q);
    const { selectSQL, countSQL, params } = buildWSIBQuery(q);

    const result = await paginatedQuery(selectSQL, countSQL, params, pg);
    return { success: true, ...result };
  });

  // CSV export of WSIB training history (no pagination)
  app.get('/wsib/training-history/export/csv', { preHandler: adminRole }, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const { selectSQL, params } = buildWSIBQuery(q);

    const [rows] = await pool.query<any[]>(selectSQL, params);

    const csv = toCSV(rows, [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'organization_name', label: 'Organization' },
      { key: 'course_type_name', label: 'Course Type' },
      { key: 'course_date', label: 'Course Date' },
      { key: 'location', label: 'Location' },
      { key: 'attended', label: 'Attended' },
      { key: 'certificate_number', label: 'Certificate #' },
      { key: 'certificate_issued_at', label: 'Cert Issued' },
      { key: 'certificate_expires_at', label: 'Cert Expires' },
      { key: 'compliance_status', label: 'Compliance Status' },
      { key: 'instructor_name', label: 'Instructor' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="wsib-training-history-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  // Dedicated WSIB CSV export endpoint (alias)
  app.get('/wsib/export/csv', { preHandler: adminRole }, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const { selectSQL, params } = buildWSIBQuery(q);

    const [rows] = await pool.query<any[]>(selectSQL, params);

    const csv = toCSV(rows, [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'organization_name', label: 'Organization' },
      { key: 'course_type_name', label: 'Course Type' },
      { key: 'course_date', label: 'Course Date' },
      { key: 'location', label: 'Location' },
      { key: 'attended', label: 'Attended' },
      { key: 'certificate_number', label: 'Certificate #' },
      { key: 'certificate_issued_at', label: 'Cert Issued' },
      { key: 'certificate_expires_at', label: 'Cert Expires' },
      { key: 'compliance_status', label: 'Compliance Status' },
      { key: 'instructor_name', label: 'Instructor' },
    ]);
    reply.header('Content-Type', 'text/csv;charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="wsib-compliance-${new Date().toISOString().split('T')[0]}.csv"`);
    return csv;
  });

  // WSIB compliance summary stats
  app.get('/wsib/compliance-summary', { preHandler: adminRole }, async (request) => {
    const q = request.query as Record<string, string>;
    const orgCondition = q.org_id ? 'AND s.organization_id = ?' : '';
    const orgParams = q.org_id ? [parseInt(q.org_id)] : [];

    const [summaryRows] = await pool.query<any[]>(`
      SELECT
        COUNT(DISTINCT s.id) as total_trained,
        COUNT(DISTINCT CASE WHEN cs.certificate_expires_at > NOW() THEN s.id END) as current_certs,
        COUNT(DISTINCT CASE WHEN cs.certificate_expires_at IS NOT NULL AND cs.certificate_expires_at <= NOW() THEN s.id END) as expired_certs,
        COUNT(DISTINCT CASE WHEN cs.certificate_expires_at > NOW() AND cs.certificate_expires_at <= DATE_ADD(NOW(), INTERVAL 30 DAY) THEN s.id END) as expiring_30d,
        COUNT(DISTINCT CASE WHEN cs.certificate_expires_at > NOW() AND cs.certificate_expires_at <= DATE_ADD(NOW(), INTERVAL 60 DAY) THEN s.id END) as expiring_60d,
        COUNT(DISTINCT CASE WHEN cs.certificate_expires_at > NOW() AND cs.certificate_expires_at <= DATE_ADD(NOW(), INTERVAL 90 DAY) THEN s.id END) as expiring_90d,
        COUNT(DISTINCT CASE WHEN cr.scheduled_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH) THEN s.id END) as trained_last_12mo
      FROM course_students cs
      JOIN students s ON cs.student_id = s.id
      JOIN course_requests cr ON cs.course_request_id = cr.id
      WHERE cr.deleted_at IS NULL ${orgCondition}
    `, orgParams);

    const summary = summaryRows[0];
    const totalTrained = Number(summary.total_trained) || 0;
    const currentCerts = Number(summary.current_certs) || 0;
    const complianceRate = totalTrained > 0 ? Math.round((currentCerts / totalTrained) * 100) : 0;

    const [orgRows] = await pool.query<any[]>(`
      SELECT o.name as organization_name, COUNT(DISTINCT s.id) as student_count
      FROM course_students cs
      JOIN students s ON cs.student_id = s.id
      JOIN course_requests cr ON cs.course_request_id = cr.id
      LEFT JOIN organizations o ON s.organization_id = o.id
      WHERE cr.deleted_at IS NULL ${orgCondition}
      GROUP BY o.id, o.name
      ORDER BY student_count DESC
      LIMIT 10
    `, orgParams);

    return {
      success: true,
      data: {
        ...summary,
        compliance_rate: complianceRate,
        top_organizations: orgRows,
      },
    };
  });
}
