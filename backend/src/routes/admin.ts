import { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireRole } from '../plugins/auth.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import bcrypt from 'bcryptjs';
import { StudentRepository } from '../repositories/StudentRepository.js';
import { parsePagination, paginatedQuery, maybePaginate, paginatedResponse, isPaginated } from '../utils/pagination.js';
import { toCSV } from '../utils/csv.js';
import { writeAudit, logAudit } from '../utils/auditLog.js';
import { canReceiveReset, sendPasswordResetLink, type ResetTarget } from '../services/passwordReset.js';
import { randomBytes } from 'node:crypto';
import { ERASED_EMAIL_DOMAIN, isErased, notReservedEmail, notReservedUsername } from '../utils/userAccount.js';
import { completedClassDate } from '../utils/classDateSql.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/)
    .refine(notReservedUsername, 'Usernames starting with "deleted_" are reserved'),
  email: z.string().email().refine(notReservedEmail, 'This email domain is reserved'),
  password: z.string().min(8).optional(),
  // 'courseadmin' is intentionally absent: it has no portal, so such a user couldn't use the app.
  role: z.enum(['admin', 'instructor', 'organization', 'accountant', 'hr', 'vendor', 'sysadmin']),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  // null = no organization / location (the screen's "None").
  organizationId: z.number().int().positive().nullish(),
  locationId: z.number().int().positive().nullish(),
  dateOnboarded: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date onboarded must be YYYY-MM-DD')]).nullish(),
  userComments: z.string().max(5000).nullish(),
});

const createCourseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  duration_minutes: z.number().int().positive(),
  course_code: z.string().optional(),
  is_active: z.boolean().default(true),
  certification_validity_months: z.number().int().min(1).max(120).nullable().optional(),
});

// The organizations table's own column names ('' clears a field on update).
const createOrgSchema = z.object({
  name: z.string().trim().min(1),
  contact_name: z.string().max(255).optional(),
  contact_position: z.string().max(100).optional(),
  contact_email: z.union([z.literal(''), z.string().email().max(255)]).optional(),
  contact_phone: z.string().max(50).optional(),
  address: z.string().optional(),
  address_city: z.string().max(100).optional(),
  address_province: z.string().max(100).optional(),
  address_postal_code: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  organization_comments: z.string().max(5000).optional(),
});

// Columns written by POST / PUT /organizations, in createOrgSchema order.
const ORG_COLUMNS = ['name', 'contact_name', 'contact_position', 'contact_email', 'contact_phone', 'address',
  'address_city', 'address_province', 'address_postal_code', 'country', 'organization_comments'] as const;

// The Organizations screen's camelCase names, next to the raw columns (o.*).
const ORG_LIST_COLUMNS = `o.*, o.name AS organizationName, o.contact_name AS contactPerson,
  o.contact_position AS contactPosition, o.contact_email AS contactEmail, o.contact_phone AS contactPhone,
  o.address_city AS city, o.address_province AS province, o.address_postal_code AS postalCode,
  o.organization_comments AS organizationComments,
  (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS userCount,
  (SELECT COUNT(*) FROM course_requests cr WHERE cr.organization_id = o.id AND cr.deleted_at IS NULL) AS courseCount`;

// Matches the LocationsDialog / OrganizationWizard payloads (camelCase).
const locationSchema = z.object({
  locationName: z.string().min(1).max(255),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  contactFirstName: z.string().max(100).optional(),
  contactLastName: z.string().max(100).optional(),
  contactEmail: z.union([z.literal(''), z.string().email()]).optional(),
  contactPhone: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
});

// The vendors table's own column names. '' clears a text field on update.
// (vendors.status is left alone: is_active is what every screen and route reads.)
const vendorBodySchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(255),
  contact_name: z.string().max(255).optional(),
  contact_email: z.union([z.literal(''), z.string().email().max(255)]).optional(),
  contact_phone: z.string().max(20).optional(),
  address: z.string().max(5000).optional(),
  vendor_type: z.string().max(100).optional(),
  company_name: z.string().max(255).optional(),
  tax_id: z.string().max(100).optional(),
  payment_terms: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
  is_active: z.boolean().optional(),
});
const VENDOR_TEXT_COLUMNS = ['name', 'contact_name', 'contact_email', 'contact_phone', 'address', 'vendor_type',
  'company_name', 'tax_id', 'payment_terms', 'notes'] as const;

/** What GET /configurations shows instead of a secret's value. */
export const SECRET_MASK = '********';

/** An expected 4xx raised inside a transaction: rolls back, then becomes the reply. */
class TxAbort extends Error {
  constructor(public statusCode: number, public payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Transaction aborted'));
    this.name = 'TxAbort';
  }
}

export async function adminRoutes(app: FastifyInstance) {
  const pool = getPool();
  const adminRole = [requireRole('admin', 'sysadmin')];
  const sysadminRole = [requireRole('sysadmin')];

  /**
   * Run `fn` inside a transaction. Commits on normal return; rolls back on any
   * throw. Throw `TxAbort` for an expected 4xx — it rolls back and is turned
   * into the error response rather than a 500.
   */
  async function inTransaction<T>(
    reply: FastifyReply,
    fn: (conn: PoolConnection) => Promise<T>,
  ): Promise<T | FastifyReply> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      if (err instanceof TxAbort) return reply.status(err.statusCode).send(err.payload);
      throw err;
    } finally {
      conn.release();
    }
  }

  // ===== Course type management =====
  app.get('/courses', { preHandler: adminRole }, async (request) => {
    const result = await maybePaginate(
      `SELECT id, name, description, duration_minutes, course_code,
              certification_validity_months,
              COALESCE(is_active, true) as is_active, created_at, updated_at
       FROM class_types ORDER BY name`,
      'SELECT COUNT(*) as count FROM class_types',
      [],
      request.query as Record<string, string>,
    );
    // Course Management reads isActive (true/false); is_active stays 0/1 for other callers.
    return paginatedResponse(result, (rows) => rows.map((r: RowDataPacket) => ({ ...r, isActive: Boolean(r.is_active) })));
  });

  app.post('/courses', { preHandler: adminRole }, async (request, reply) => {
    const data = createCourseSchema.parse(request.body);
    const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM class_types WHERE LOWER(name) = LOWER(?)', [data.name]);
    if (existing.length > 0) return reply.status(400).send({ error: 'A course with this name already exists' });

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO class_types (name, description, duration_minutes, course_code, is_active, certification_validity_months) VALUES (?, ?, ?, ?, ?, ?)',
      [data.name, data.description ?? null, data.duration_minutes, data.course_code ?? null, data.is_active, data.certification_validity_months ?? null]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM class_types WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Course created successfully', data: rows[0] };
  });

  app.put('/courses/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, description, duration_minutes, course_code, is_active, certification_validity_months } = createCourseSchema.partial().parse(request.body);

    if (name) {
      const [dup] = await pool.query<RowDataPacket[]>('SELECT id FROM class_types WHERE LOWER(name) = LOWER(?) AND id != ?', [name, id]);
      if (dup.length > 0) return reply.status(400).send({ error: 'A course with this name already exists' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE class_types SET name = COALESCE(?, name), description = COALESCE(?, description),
       duration_minutes = COALESCE(?, duration_minutes), course_code = COALESCE(?, course_code),
       is_active = COALESCE(?, is_active),
       certification_validity_months = ${certification_validity_months !== undefined ? '?' : 'certification_validity_months'},
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name ?? null, description ?? null, duration_minutes ?? null, course_code ?? null, is_active ?? null,
       ...(certification_validity_months !== undefined ? [certification_validity_months ?? null] : []), id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Course not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM class_types WHERE id = ?', [id]);
    return { success: true, message: 'Course updated successfully', data: rows[0] };
  });

  app.delete('/courses/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // The usage count decides soft- vs hard-delete, so read and write together.
    return inTransaction(reply, async (conn) => {
      const [usage] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM course_requests WHERE course_type_id = ?', [id]);
      if (Number(usage[0].count) > 0) {
        await conn.query('UPDATE class_types SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        const [rows] = await conn.query<RowDataPacket[]>('SELECT * FROM class_types WHERE id = ?', [id]);
        return { success: true, message: `Course deactivated (${usage[0].count} course requests exist)`, data: rows[0], softDeleted: true };
      }
      const [result] = await conn.query<ResultSetHeader>('DELETE FROM class_types WHERE id = ?', [id]);
      if (result.affectedRows === 0) throw new TxAbort(404, { error: 'Course not found' });
      return { success: true, message: 'Course deleted permanently', softDeleted: false };
    });
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
      // camelCase copies are what User Management reads; the snake names stay for older callers.
      `SELECT u.id, u.username, u.email, u.role, u.phone, u.mobile,
              u.first_name, u.last_name, u.full_name,
              u.first_name AS firstName, u.last_name AS lastName, u.full_name AS fullName,
              u.organization_id, o.name as organization_name,
              u.organization_id AS organizationId, o.name AS organizationName,
              u.location_id, ol.location_name,
              u.location_id AS locationId, ol.location_name AS locationName,
              u.date_onboarded, u.date_offboarded, u.user_comments, u.status,
              DATE_FORMAT(u.date_onboarded, '%Y-%m-%d') AS dateOnboarded, u.user_comments AS userComments,
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
    const [rows] = await pool.query<RowDataPacket[]>('SELECT role FROM users WHERE id = ?', [userId]);
    return rows.length > 0 && PRIVILEGED_ROLES.includes(rows[0].role);
  }

  app.post('/users', { preHandler: adminRole }, async (request, reply) => {
    const data = createUserSchema.parse(request.body);

    // Only a sysadmin may create admin/sysadmin accounts
    if (PRIVILEGED_ROLES.includes(data.role) && request.userRole !== 'sysadmin') {
      return reply.status(403).send({ error: 'Only a system administrator can create admin or sysadmin users' });
    }

    // Check duplicates
    const [existingUser] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ? OR email = ?', [data.username, data.email]
    );
    if (existingUser.length > 0) return reply.status(400).send({ error: 'Username or email already exists' });

    if (!data.password) return reply.status(400).send({ error: 'Password is required' });
    const password = data.password;
    const hash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

    // users + audit_logs are two tables; keep them atomic.
    return inTransaction(reply, async (conn) => {
      // Re-check under the transaction — the pool-level check above can race.
      const [dup] = await conn.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE username = ? OR email = ?', [data.username, data.email]
      );
      if (dup.length > 0) throw new TxAbort(400, { error: 'Username or email already exists' });

      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO users (username, email, password_hash, role, first_name, last_name,
         phone, mobile, organization_id, location_id, date_onboarded, user_comments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.username, data.email, hash, data.role, data.firstName ?? null, data.lastName ?? null,
         data.phone ?? null, data.mobile ?? null, data.organizationId ?? null, data.locationId ?? null,
         data.dateOnboarded || null, data.userComments || null]
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT id, username, email, role, first_name, last_name, organization_id, created_at FROM users WHERE id = ?',
        [result.insertId]
      );
      await writeAudit(conn, { userId: request.userId, action: 'create_user', entityType: 'user', entityId: result.insertId, details: { username: data.username, role: data.role }, ipAddress: request.ip });
      return { success: true, message: 'User created successfully', data: rows[0] };
    });
  });

  app.put('/users/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { username, email, role, firstName, lastName, phone, mobile, organizationId, locationId,
            dateOnboarded, userComments, status, password } = createUserSchema.extend({
      status: z.enum(['active', 'inactive', 'deleted']).optional(),
      // An admin may set a new password while editing; '' (or leaving it out) keeps the current one.
      password: z.union([z.literal(''), z.string().min(8)]).optional(),
    }).partial().parse(request.body);
    const passwordHash = password ? await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS) : null;

    // Only a sysadmin may grant admin/sysadmin, or modify an existing admin/sysadmin account
    if (request.userRole !== 'sysadmin') {
      if ((role && PRIVILEGED_ROLES.includes(role)) || (await targetIsPrivileged(id))) {
        return reply.status(403).send({ error: 'Only a system administrator can modify admin or sysadmin users' });
      }
    }

    return inTransaction(reply, async (conn) => {
      const [current] = await conn.query<RowDataPacket[]>('SELECT email FROM users WHERE id = ? FOR UPDATE', [id]);
      if (current.length === 0) throw new TxAbort(404, { error: 'User not found' });
      if (isErased(current[0].email)) throw new TxAbort(400, { error: 'This account was erased and cannot be changed' });
      // These can be cleared: a field left out keeps its value, null (or '') empties it.
      const clearable: [string, unknown][] = [
        ['organization_id', organizationId], ['location_id', locationId],
        ['date_onboarded', dateOnboarded], ['user_comments', userComments],
      ];
      const clearableSet = clearable.filter(([, v]) => v !== undefined);
      const passwordSet = passwordHash ? ', password_hash = ?, password_changed_at = CURRENT_TIMESTAMP' : '';
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE users SET username = COALESCE(?, username), email = COALESCE(?, email),
         role = COALESCE(?, role), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
         phone = COALESCE(?, phone), mobile = COALESCE(?, mobile),
         ${clearableSet.map(([col]) => `${col} = ?, `).join('')}status = COALESCE(?, status)${passwordSet},
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [username ?? null, email ?? null, role ?? null, firstName ?? null, lastName ?? null,
         phone ?? null, mobile ?? null, ...clearableSet.map(([, v]) => v || null), status ?? null,
         ...(passwordHash ? [passwordHash] : []), id]
      );
      if (result.affectedRows === 0) throw new TxAbort(404, { error: 'User not found' });
      if (passwordHash) {
        // A new password signs the user out everywhere, as reset and change-password do:
        // older access tokens are refused, refresh tokens and open reset links revoked.
        await conn.query(
          'INSERT INTO token_blacklist (user_id, invalidated_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE invalidated_at = VALUES(invalidated_at)', [id, new Date()]
        );
        await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
        await conn.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [id]);
      }
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, username, email, full_name, first_name, last_name, role,
                organization_id, location_id, status, phone, mobile, address,
                date_onboarded, date_offboarded, created_at, updated_at
         FROM users WHERE id = ?`, [id]
      );
      await writeAudit(conn, { userId: request.userId, action: 'update_user', entityType: 'user', entityId: parseInt(id), details: { username, email, role, status, passwordChanged: Boolean(passwordHash) }, ipAddress: request.ip });
      return { success: true, message: 'User updated successfully', data: rows[0] };
    });
  });

  // POST /users/:id/reset-password: email the user a one-hour reset link (the same
  // email "Forgot password" sends). No password is ever set or shown by an admin.
  app.post('/users/:id/reset-password', { preHandler: adminRole }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, username, email, status, role FROM users WHERE id = ?', [id]);
    const user = rows[0] as (ResetTarget & { role: string }) | undefined;
    if (!user) return reply.status(404).send({ error: 'User not found' });
    // Only a sysadmin may reset an admin/sysadmin password
    if (request.userRole !== 'sysadmin' && PRIVILEGED_ROLES.includes(user.role)) {
      return reply.status(403).send({ error: 'Only a system administrator can reset admin or sysadmin passwords' });
    }
    if (!canReceiveReset(user)) {
      return reply.status(400).send({ error: 'This account has no email address or is not active, so no reset link can be sent.' });
    }
    const sent = await sendPasswordResetLink(user);
    logAudit({ userId: request.userId, action: 'admin_password_reset_link', entityType: 'user', entityId: id, details: { username: user.username, emailed: sent }, ipAddress: request.ip });
    if (!sent) return reply.status(502).send({ error: 'The reset link was created but the email could not be sent. Try again shortly.' });
    return { success: true, message: `A password reset link was emailed to ${user.email}.` };
  });

  // ===== Organization management =====
  app.get('/organizations', { preHandler: adminRole }, async (request) => {
    const { search = '', basic = '' } = request.query as Record<string, string>;
    // ?basic=1: every organization as { id, name, status } for pickers (User Management),
    // unpaged and without the count subqueries. Inactive ones are kept so a user's
    // current organization still shows; the screen labels them.
    if (basic === '1') {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id, name, status FROM organizations ORDER BY name LIMIT 5000');
      return { success: true, data: rows };
    }
    const pg = parsePagination(request.query as Record<string, string>);

    let where = '';
    const params: unknown[] = [];
    if (search) {
      where = 'WHERE o.name LIKE ? OR o.contact_email LIKE ? OR o.contact_name LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const result = await paginatedQuery<RowDataPacket>(
      `SELECT ${ORG_LIST_COLUMNS} FROM organizations o ${where} ORDER BY o.name`,
      `SELECT COUNT(*) as count FROM organizations o ${where}`,
      params,
      pg,
    );
    const data = result.data.map((o) => ({ ...o, userCount: Number(o.userCount), courseCount: Number(o.courseCount) }));
    return { success: true, ...result, data };
  });

  // `locations` is optional; when present the org and all of its locations are
  // written in one transaction so a half-built organization can never persist.
  const orgWithLocationsSchema = createOrgSchema.extend({
    locations: z.array(locationSchema).optional(),
  });
  const orgUpdateWithLocationsSchema = createOrgSchema.partial().extend({
    locations: z.array(locationSchema.partial().extend({ id: z.number().int().positive().optional() })).optional(),
  });

  async function insertLocation(conn: PoolConnection, orgId: number, loc: z.infer<typeof locationSchema>) {
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO organization_locations
         (organization_id, location_name, address, city, province, postal_code,
          contact_first_name, contact_last_name, contact_email, contact_phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orgId, loc.locationName, loc.address ?? null, loc.city ?? null, loc.province ?? null,
       loc.postalCode ?? null, loc.contactFirstName ?? null, loc.contactLastName ?? null,
       loc.contactEmail || null, loc.contactPhone ?? null, loc.isActive === false ? 0 : 1]
    );
    return res.insertId as number;
  }

  app.post('/organizations', { preHandler: adminRole }, async (request, reply) => {
    const data = orgWithLocationsSchema.parse(request.body);
    return inTransaction(reply, async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO organizations (${ORG_COLUMNS.join(', ')}) VALUES (${ORG_COLUMNS.map(() => '?').join(', ')})`,
        ORG_COLUMNS.map((col) => data[col] || null)
      );
      for (const loc of data.locations ?? []) {
        await insertLocation(conn, result.insertId, loc);
      }
      const [rows] = await conn.query<RowDataPacket[]>('SELECT * FROM organizations WHERE id = ?', [result.insertId]);
      await writeAudit(conn, { userId: request.userId, action: 'create_organization', entityType: 'organization', entityId: result.insertId, details: { name: data.name, locations: data.locations?.length ?? 0 }, ipAddress: request.ip });
      return { success: true, message: 'Organization created successfully', data: rows[0] };
    });
  });

  app.put('/organizations/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { locations, ...fields } = orgUpdateWithLocationsSchema.parse(request.body);
    const { name } = fields;

    return inTransaction(reply, async (conn) => {
      // A field left out keeps its value; '' stores NULL, as POST does (the name can't be emptied).
      const sent = ORG_COLUMNS.filter((col) => fields[col] !== undefined);
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE organizations SET ${sent.map((col) => `${col} = ?, `).join('')}updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...sent.map((col) => fields[col] || null), id]
      );
      if (result.affectedRows === 0) throw new TxAbort(404, { error: 'Organization not found' });

      // Locations with an id are updated, those without are inserted — all in
      // the same transaction as the organization row itself.
      for (const loc of locations ?? []) {
        if (loc.id) {
          await conn.query(
            `UPDATE organization_locations SET
               location_name = COALESCE(?, location_name), address = COALESCE(?, address),
               city = COALESCE(?, city), province = COALESCE(?, province), postal_code = COALESCE(?, postal_code),
               contact_first_name = COALESCE(?, contact_first_name), contact_last_name = COALESCE(?, contact_last_name),
               contact_email = COALESCE(?, contact_email), contact_phone = COALESCE(?, contact_phone),
               is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND organization_id = ?`,
            [loc.locationName ?? null, loc.address ?? null, loc.city ?? null, loc.province ?? null,
             loc.postalCode ?? null, loc.contactFirstName ?? null, loc.contactLastName ?? null,
             loc.contactEmail ?? null, loc.contactPhone ?? null,
             loc.isActive === undefined ? null : (loc.isActive ? 1 : 0), loc.id, id]
          );
        } else if (loc.locationName) {
          await insertLocation(conn, parseInt(id), loc as z.infer<typeof locationSchema>);
        }
      }

      const [rows] = await conn.query<RowDataPacket[]>('SELECT * FROM organizations WHERE id = ?', [id]);
      await writeAudit(conn, { userId: request.userId, action: 'update_organization', entityType: 'organization', entityId: parseInt(id), details: { name, locations: locations?.length ?? 0 }, ipAddress: request.ip });
      return { success: true, message: 'Organization updated successfully', data: rows[0] };
    });
  });

  // DELETE /organizations/:id — soft delete (organizations.status = 'inactive').
  // Refuses when the org still has live course requests or invoices so history
  // stays consistent; those must be cancelled/archived first.
  app.delete('/organizations/:id', { preHandler: sysadminRole }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    return inTransaction(reply, async (conn) => {
      const [orgRows] = await conn.query<RowDataPacket[]>('SELECT id, name, status FROM organizations WHERE id = ?', [id]);
      if (orgRows.length === 0) throw new TxAbort(404, { error: 'Organization not found' });
      if (orgRows[0].status === 'inactive') {
        return { success: true, message: 'Organization is already inactive' };
      }

      // The guard counts and the status write must see the same snapshot.
      const [[courses]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM course_requests
         WHERE organization_id = ? AND deleted_at IS NULL AND status NOT IN ('cancelled', 'completed', 'invoiced')`,
        [id]
      );
      if (Number(courses.count) > 0) {
        throw new TxAbort(409, { error: `Organization has ${courses.count} open course request(s); cancel or complete them first` });
      }
      const [[invoices]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM invoices WHERE organization_id = ? AND deleted_at IS NULL AND status NOT IN ('paid', 'cancelled', 'void')`,
        [id]
      );
      if (Number(invoices.count) > 0) {
        throw new TxAbort(409, { error: `Organization has ${invoices.count} outstanding invoice(s); settle them first` });
      }

      await conn.query(
        `UPDATE organizations SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]
      );
      await writeAudit(conn, { userId: request.userId, action: 'deactivate_organization', entityType: 'organization', entityId: id, details: { name: orgRows[0].name }, ipAddress: request.ip });
      return { success: true, message: 'Organization deactivated successfully' };
    });
  });

  // ===== Sysadmin: PIPEDA data erasure =====
  // DELETE /users/:userId/personal-data: privacy-law (PIPEDA) erasure. The account row stays
  // for audit and history, but everything that identifies the person is blanked, it can no
  // longer sign in, and its sessions and reset links are revoked. Cannot be undone.
  app.delete('/users/:userId/personal-data', { preHandler: sysadminRole }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const id = parseInt(userId);
    if (isNaN(id) || id <= 0) return reply.status(400).send({ error: 'Invalid userId' });
    if (id === request.userId) return reply.status(400).send({ error: 'You cannot erase your own account' });

    return inTransaction(reply, async (conn) => {
      const [check] = await conn.query<RowDataPacket[]>('SELECT id, username, email, role FROM users WHERE id = ? FOR UPDATE', [id]);
      if (check.length === 0) throw new TxAbort(404, { error: `User ${id} not found` });
      if (isErased(check[0].email)) throw new TxAbort(400, { error: 'This account was already erased' });
      const { username: oldUsername, email: oldEmail } = check[0];
      // A password nobody knows: even if the row were ever reactivated, the old one is gone.
      const unusableHash = await bcrypt.hash(randomBytes(32).toString('hex'), env.BCRYPT_SALT_ROUNDS);

      await conn.query(
        `UPDATE users SET username = CONCAT('deleted_', id), email = CONCAT('deleted_', id, '@deleted.invalid'),
           full_name = NULL, first_name = NULL, last_name = NULL, phone = NULL, mobile = NULL, address = NULL,
           emergency_contact_name = NULL, emergency_contact_phone = NULL, user_comments = NULL,
           mfa_enabled = 0, mfa_secret = NULL, mfa_backup_codes = NULL, reset_token = NULL, reset_token_expires = NULL,
           password_hash = ?, status = 'deleted', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [unusableHash, id]
      );
      // Sign out everywhere now: access tokens issued before this are refused, and refresh tokens revoked.
      await conn.query(
        'INSERT INTO token_blacklist (user_id, invalidated_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE invalidated_at = VALUES(invalidated_at)', [id, new Date()]
      );
      await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
      await conn.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [id]);
      // Audit entries keep the account id (a key to a now-blank row) but not who it was:
      // their name as the actor, details about them as the subject, and failed logins typed with it.
      await conn.query('UPDATE audit_logs SET username = NULL WHERE user_id = ?', [id]);
      await conn.query(`UPDATE audit_logs SET details = NULL WHERE entity_type = 'user' AND entity_id = ?`, [id]);
      await conn.query('UPDATE audit_logs SET username = NULL WHERE user_id IS NULL AND username IN (?, ?)', [oldUsername, oldEmail ?? oldUsername]);
      await conn.query('UPDATE profile_changes SET old_value = NULL, new_value = NULL WHERE user_id = ?', [id]);
      await conn.query('UPDATE inbound_emails SET from_address = ?, body_text = NULL WHERE matched_user_id = ?', [`deleted_${id}${ERASED_EMAIL_DOMAIN}`, id]);
      // Only the role is kept in the audit entry: the point is to forget who it was.
      await writeAudit(conn, { userId: request.userId, action: 'erase_personal_data', entityType: 'user', entityId: id, details: { role: check[0].role }, ipAddress: request.ip });
      logger.info({ userId: id, sysadmin: request.userId }, 'PIPEDA personal data anonymised');
      return { success: true, message: 'Personal data erased' };
    });
  });

  // ===== Organization locations =====
  // The Locations dialog and User Management read camelCase; the raw columns (ol.*) stay too.
  const LOCATION_COLUMNS = `ol.*, ol.organization_id AS organizationId, ol.location_name AS locationName,
    ol.postal_code AS postalCode, ol.contact_first_name AS contactFirstName, ol.contact_last_name AS contactLastName,
    ol.contact_email AS contactEmail, ol.contact_phone AS contactPhone,
    (SELECT COUNT(*) FROM users u WHERE u.location_id = ol.id) AS userCount,
    (SELECT COUNT(*) FROM course_requests cr WHERE cr.location_id = ol.id AND cr.deleted_at IS NULL) AS courseCount`;
  const toLocation = (row: RowDataPacket) => ({
    ...row, isActive: Boolean(row.is_active), userCount: Number(row.userCount), courseCount: Number(row.courseCount),
  });
  async function selectLocation(conn: PoolConnection, locationId: number) {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${LOCATION_COLUMNS} FROM organization_locations ol WHERE ol.id = ?`, [locationId]);
    return rows[0] ? toLocation(rows[0]) : undefined;
  }

  app.get('/organizations/:orgId/locations', { preHandler: adminRole }, async (request) => {
    const { orgId } = request.params as { orgId: string };
    const result = await maybePaginate<RowDataPacket>(
      `SELECT ${LOCATION_COLUMNS} FROM organization_locations ol WHERE ol.organization_id = ? ORDER BY ol.location_name`,
      'SELECT COUNT(*) as count FROM organization_locations WHERE organization_id = ?',
      [orgId],
      request.query as Record<string, string>,
    );
    return paginatedResponse(result, (rows) => rows.map(toLocation));
  });

  const orgLocationParams = z.object({
    orgId: z.coerce.number().int().positive(),
    locationId: z.coerce.number().int().positive().optional(),
  });

  // POST /organizations/:orgId/locations
  app.post('/organizations/:orgId/locations', { preHandler: adminRole }, async (request, reply) => {
    const { orgId } = orgLocationParams.parse(request.params);
    const data = locationSchema.parse(request.body);

    return inTransaction(reply, async (conn) => {
      const [org] = await conn.query<RowDataPacket[]>('SELECT id FROM organizations WHERE id = ?', [orgId]);
      if (org.length === 0) throw new TxAbort(404, { error: 'Organization not found' });

      const insertId = await insertLocation(conn, orgId, data);
      const location = await selectLocation(conn, insertId);
      await writeAudit(conn, { userId: request.userId, action: 'create_location', entityType: 'organization_location', entityId: insertId, details: { organizationId: orgId, locationName: data.locationName }, ipAddress: request.ip });
      return { success: true, message: 'Location created successfully', data: location };
    });
  });

  // PUT /organizations/:orgId/locations/:locationId
  app.put('/organizations/:orgId/locations/:locationId', { preHandler: adminRole }, async (request, reply) => {
    const { orgId, locationId } = orgLocationParams.required().parse(request.params);
    const data = locationSchema.partial().parse(request.body);

    return inTransaction(reply, async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE organization_locations SET
           location_name = COALESCE(?, location_name), address = COALESCE(?, address),
           city = COALESCE(?, city), province = COALESCE(?, province), postal_code = COALESCE(?, postal_code),
           contact_first_name = COALESCE(?, contact_first_name), contact_last_name = COALESCE(?, contact_last_name),
           contact_email = COALESCE(?, contact_email), contact_phone = COALESCE(?, contact_phone),
           is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ?`,
        [data.locationName ?? null, data.address ?? null, data.city ?? null, data.province ?? null,
         data.postalCode ?? null, data.contactFirstName ?? null, data.contactLastName ?? null,
         data.contactEmail ?? null, data.contactPhone ?? null,
         data.isActive === undefined ? null : (data.isActive ? 1 : 0), locationId, orgId]
      );
      if (result.affectedRows === 0) throw new TxAbort(404, { error: 'Location not found' });
      const location = await selectLocation(conn, locationId);
      await writeAudit(conn, { userId: request.userId, action: 'update_location', entityType: 'organization_location', entityId: locationId, details: { organizationId: orgId, ...data }, ipAddress: request.ip });
      return { success: true, message: 'Location updated successfully', data: location };
    });
  });

  // DELETE /organizations/:orgId/locations/:locationId — hard delete unless referenced
  app.delete('/organizations/:orgId/locations/:locationId', { preHandler: adminRole }, async (request, reply) => {
    const { orgId, locationId } = orgLocationParams.required().parse(request.params);

    return inTransaction(reply, async (conn) => {
      // The reference counts decide delete-vs-deactivate, so they must be read
      // in the same transaction as the write they gate.
      const [[users]] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM users WHERE location_id = ?', [locationId]);
      const [[courses]] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM course_requests WHERE location_id = ? AND deleted_at IS NULL', [locationId]
      );
      if (Number(users.count) > 0 || Number(courses.count) > 0) {
        // Referenced: deactivate instead of deleting so history keeps resolving.
        const [result] = await conn.query<ResultSetHeader>(
          `UPDATE organization_locations SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
          [locationId, orgId]
        );
        if (result.affectedRows === 0) throw new TxAbort(404, { error: 'Location not found' });
        await writeAudit(conn, { userId: request.userId, action: 'deactivate_location', entityType: 'organization_location', entityId: locationId, details: { organizationId: orgId, users: users.count, courses: courses.count }, ipAddress: request.ip });
        return { success: true, message: 'Location is in use and was deactivated instead of deleted' };
      }

      const [result] = await conn.query<ResultSetHeader>(
        'DELETE FROM organization_locations WHERE id = ? AND organization_id = ?', [locationId, orgId]
      );
      if (result.affectedRows === 0) throw new TxAbort(404, { error: 'Location not found' });
      await writeAudit(conn, { userId: request.userId, action: 'delete_location', entityType: 'organization_location', entityId: locationId, details: { organizationId: orgId }, ipAddress: request.ip });
      return { success: true, message: 'Location deleted successfully' };
    });
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
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM users WHERE 1=1${userDateFilter}`, userDateParams),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM organizations WHERE 1=1${orgDateFilter}`, orgDateParams),
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM class_types WHERE is_active = true'),
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM vendors WHERE is_active = true'),
      // YoY: users this year vs last year
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM users WHERE YEAR(created_at) = YEAR(CURDATE())'),
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM users WHERE YEAR(created_at) = YEAR(CURDATE()) - 1'),
      // YoY: organizations this year vs last year
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM organizations WHERE YEAR(created_at) = YEAR(CURDATE())'),
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM organizations WHERE YEAR(created_at) = YEAR(CURDATE()) - 1'),
      // YoY: course types this year vs last year
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM class_types WHERE is_active = true AND YEAR(created_at) = YEAR(CURDATE())'),
      pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM class_types WHERE is_active = true AND YEAR(created_at) = YEAR(CURDATE()) - 1'),
    ]);

    const [recentUsers] = await pool.query<RowDataPacket[]>(
      `SELECT username, role, created_at as createdAt FROM users WHERE 1=1${userDateFilter} ORDER BY created_at DESC LIMIT 5`,
      userDateParams
    );
    const [recentCourses] = await pool.query<RowDataPacket[]>(
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
  // Secrets (keys ending _pass, _password, _secret, _token, _api_key; e.g. email_smtp_pass) are never sent back: the screen gets SECRET_MASK,
  // and saving SECRET_MASK unchanged leaves the stored value alone.
  const isSecretConfig = (key: string) => /_(pass|password|secret|token|api_key)$/i.test(key);

  // System Configuration reads { [category]: [{ configKey, configValue, ... }] }.
  app.get('/configurations', { preHandler: sysadminRole }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, config_key, config_value, description, category, updated_by, created_at, updated_at
       FROM system_configurations ORDER BY category, config_key LIMIT 500`
    );
    const byCategory: Record<string, Record<string, unknown>[]> = {};
    for (const r of rows) {
      const secret = isSecretConfig(r.config_key);
      const category = r.category || 'general';
      (byCategory[category] ??= []).push({
        id: r.id, configKey: r.config_key, description: r.description, category,
        configValue: secret ? (r.config_value ? SECRET_MASK : '') : r.config_value,
        isSecret: secret, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at,
      });
    }
    return { success: true, data: byCategory };
  });

  app.put('/configurations/:key', { preHandler: sysadminRole }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const { value } = (request.body ?? {}) as { value?: string };
    if (!value) return reply.status(400).send({ error: 'Configuration value is required' });
    if (isSecretConfig(key) && value === SECRET_MASK) {
      return { success: true, message: `Configuration '${key}' unchanged` };
    }

    return inTransaction(reply, async (conn) => {
      const [before] = await conn.query<RowDataPacket[]>(
        'SELECT config_value FROM system_configurations WHERE config_key = ?', [key]
      );
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE system_configurations SET config_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE config_key = ?`,
        [value, request.userId, key]
      );
      if (result.affectedRows === 0) throw new TxAbort(404, { error: `Configuration key '${key}' not found` });
      // A secret's old and new values stay out of the audit log and the reply.
      const secret = isSecretConfig(key);
      await writeAudit(conn, {
        userId: request.userId, action: 'update_configuration', entityType: 'system_configuration',
        details: secret ? { key, changed: true } : { key, oldValue: before[0]?.config_value ?? null, newValue: value },
        ipAddress: request.ip,
      });
      return { success: true, data: { configKey: key, configValue: secret ? SECRET_MASK : value }, message: `Configuration '${key}' updated successfully` };
    });
  });

  // ===== Vendor entity CRUD (sysadmin) =====
  // Vendor Management reads camelCase; the raw columns stay alongside.
  const toVendor = (v: RowDataPacket) => ({
    ...v, vendorName: v.name, contactName: v.contact_name, email: v.contact_email, phone: v.contact_phone,
    vendorType: v.vendor_type, isActive: Boolean(v.is_active), status: v.is_active ? 'active' : 'inactive',
  });

  app.get('/vendors', { preHandler: adminRole }, async (request) => {
    const result = await maybePaginate<RowDataPacket>(
      `SELECT id, name, contact_name, contact_email, contact_phone, address, vendor_type, is_active,
              company_name, tax_id, payment_terms, notes, created_at, updated_at
       FROM vendors ORDER BY name`,
      'SELECT COUNT(*) as count FROM vendors',
      [],
      request.query as Record<string, string>,
    );
    return paginatedResponse(result, (rows) => rows.map(toVendor));
  });

  app.post('/vendors', { preHandler: adminRole }, async (request) => {
    const data = vendorBodySchema.parse(request.body);
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO vendors (${VENDOR_TEXT_COLUMNS.join(', ')}, is_active)
       VALUES (${VENDOR_TEXT_COLUMNS.map(() => '?').join(', ')}, ?)`,
      [...VENDOR_TEXT_COLUMNS.map((col) => data[col] || null), data.is_active === false ? 0 : 1]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM vendors WHERE id = ?', [result.insertId]);
    return { success: true, message: 'Vendor created successfully', data: toVendor(rows[0]) };
  });

  app.put('/vendors/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const data = vendorBodySchema.partial().parse(request.body);
    // A field left out keeps its value; '' empties it.
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of VENDOR_TEXT_COLUMNS) {
      if (data[col] !== undefined) { sets.push(`${col} = ?`); params.push(data[col] || null); }
    }
    if (data.is_active !== undefined) { sets.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE vendors SET ${sets.map((x) => `${x}, `).join('')}updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...params, id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Vendor not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM vendors WHERE id = ?', [id]);
    return { success: true, message: 'Vendor updated successfully', data: toVendor(rows[0]) };
  });

  app.delete('/vendors/:id', { preHandler: adminRole }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE vendors SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Vendor not found' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM vendors WHERE id = ?', [id]);
    return { success: true, message: 'Vendor deactivated successfully', data: rows[0] };
  });

  // ===== Student directory =====
  const studentRepo = new StudentRepository();
  const STUDENT_SEARCH_LIMIT = 50;

  // Search students by name or email
  app.get('/students', { preHandler: adminRole }, async (request) => {
    const query = request.query as Record<string, string>;
    const { q, orgId } = query as { q?: string; orgId?: string };
    const wantsPage = isPaginated(query);

    if (orgId) {
      const students = wantsPage
        ? await studentRepo.findByOrg(parseInt(orgId), parsePagination(query))
        : await studentRepo.findByOrg(parseInt(orgId));
      return paginatedResponse(students);
    }

    if (q && q.trim().length >= 2) {
      // Search answers with the first STUDENT_SEARCH_LIMIT matches; `truncated`
      // tells the screen there are more, so it can ask for a narrower search.
      const students = await studentRepo.search(q.trim(), STUDENT_SEARCH_LIMIT + 1);
      return {
        success: true,
        data: students.slice(0, STUDENT_SEARCH_LIMIT),
        truncated: students.length > STUDENT_SEARCH_LIMIT,
      };
    }

    // No filter — historically the 100 most recent students. When the caller
    // asks for a page we run the same query properly paginated instead.
    if (wantsPage) {
      const result = await paginatedQuery(
        `SELECT s.*, COUNT(DISTINCT cs.course_request_id) as course_count,
                MAX(${completedClassDate('cr')}) as last_course_date,
                o.name as organization_name
         FROM students s
         LEFT JOIN course_students cs ON cs.student_id = s.id
         LEFT JOIN course_requests cr ON cs.course_request_id = cr.id
         LEFT JOIN organizations o ON s.organization_id = o.id
         GROUP BY s.id
         ORDER BY s.created_at DESC`,
        'SELECT COUNT(*) as count FROM students s',
        [],
        parsePagination(query),
      );
      return paginatedResponse(result);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.*, COUNT(DISTINCT cs.course_request_id) as course_count,
              MAX(${completedClassDate('cr')}) as last_course_date,
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
    const [rows] = await pool.query<RowDataPacket[]>(`
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

  // ===== CSV Exports =====

  // CSV Export: Organizations
  app.get('/organizations/export/csv', { preHandler: adminRole }, async (request, reply) => {
    const { search = '' } = request.query as Record<string, string>;
    let where = '';
    const params: unknown[] = [];
    if (search) {
      where = 'WHERE name LIKE ? OR contact_email LIKE ? OR contact_name LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM organizations ${where} ORDER BY name`, params);
    const csv = toCSV(rows, [
      { key: 'name', label: 'Organization' },
      { key: 'contact_name', label: 'Contact Person' },
      { key: 'contact_email', label: 'Email' },
      { key: 'contact_phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
      { key: 'address_city', label: 'City' },
      { key: 'address_province', label: 'Province' },
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
    const [rows] = await pool.query<RowDataPacket[]>(
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
  // Entity types written by the money routes; entity_type=money selects all of them.
  // The frontend menu (AuditLogViewer ENTITY_TYPE_OPTIONS) lists the same types.
  const MONEY_ENTITY_TYPES = ['invoice', 'payment', 'course_pricing', 'organization_pricing', 'pay_rate_tier',
    'payroll_payment', 'vendor_invoice', 'vendor_payment', 'timesheet'];
  const MONEY_ACTIONS = ['set_instructor_pay_rate', 'bulk_set_instructor_pay_rate', 'save_invoice_sequence', 'delete_invoice_sequence'];

  // Filters shared by the audit list and its CSV export. The user's current
  // username comes from users (most entries store only user_id).
  const AUDIT_FROM = 'FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id';
  const AUDIT_COLS = `a.id, a.user_id, COALESCE(u.username, a.username) AS username, a.action, a.entity_type,
       a.entity_id, a.details, a.ip_address, a.created_at`;
  function auditFilter(query: Record<string, string>) {
    const { action, entity_type, user_id, from, to, search, startDate, endDate } = query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action) { conditions.push('a.action = ?'); params.push(action); }
    if (entity_type === 'money') {
      conditions.push(`(a.entity_type IN (${MONEY_ENTITY_TYPES.map(() => '?').join(', ')}) OR a.action IN (${MONEY_ACTIONS.map(() => '?').join(', ')}))`);
      params.push(...MONEY_ENTITY_TYPES, ...MONEY_ACTIONS);
    } else if (entity_type) { conditions.push('a.entity_type = ?'); params.push(entity_type); }
    if (user_id) { conditions.push('a.user_id = ?'); params.push(parseInt(user_id)); }
    if (search && search.trim().length >= 2) {
      conditions.push('(a.username LIKE ? OR u.username LIKE ? OR a.action LIKE ? OR CAST(a.details AS CHAR) LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }
    // Support both from/to and startDate/endDate param names
    const dateFrom = from || startDate;
    const dateTo = to || endDate;
    if (dateFrom) { conditions.push('a.created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('a.created_at <= ?'); params.push(`${dateTo} 23:59:59`); }

    return { where: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '', params };
  }

  app.get('/audit-logs', { preHandler: sysadminRole }, async (request) => {
    const pg = parsePagination(request.query as Record<string, string>);
    const { where, params } = auditFilter(request.query as Record<string, string>);

    const result = await paginatedQuery(
      `SELECT ${AUDIT_COLS}
       ${AUDIT_FROM} ${where} ORDER BY a.created_at DESC`,
      `SELECT COUNT(*) as count ${AUDIT_FROM} ${where}`,
      params,
      pg,
    );
    return { success: true, ...result };
  });

  app.get('/audit-logs/stats', { preHandler: sysadminRole }, async () => {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total_entries,
        COUNT(CASE WHEN created_at >= CURDATE() THEN 1 END) as entries_today,
        COUNT(DISTINCT user_id) as unique_users
      FROM audit_logs
    `);
    const [topActions] = await pool.query<RowDataPacket[]>(`
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
    const { where, params } = auditFilter(request.query as Record<string, string>);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${AUDIT_COLS}
       ${AUDIT_FROM} ${where} ORDER BY a.created_at DESC LIMIT 10000`,
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

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.first_name, s.last_name, s.email, s.phone,
              o.name as organization_name,
              COUNT(DISTINCT cs.course_request_id) as course_count,
              DATE_FORMAT(MAX(${completedClassDate('cr')}), '%Y-%m-%d') as last_course_date,
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

    const [rows] = await pool.query<RowDataPacket[]>(selectSQL, params);

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

  // WSIB compliance summary stats
  app.get('/wsib/compliance-summary', { preHandler: adminRole }, async (request) => {
    const q = request.query as Record<string, string>;
    const orgCondition = q.org_id ? 'AND s.organization_id = ?' : '';
    const orgParams = q.org_id ? [parseInt(q.org_id)] : [];

    const [summaryRows] = await pool.query<RowDataPacket[]>(`
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

    const [orgRows] = await pool.query<RowDataPacket[]>(`
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
