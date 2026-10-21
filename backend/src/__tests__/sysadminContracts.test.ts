import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

// Sysadmin + HR screens: the fields each screen reads and the bodies it sends.
const { mockQuery, mockConnQuery, currentUser } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnQuery: vi.fn(),
  currentUser: { id: 1, role: 'sysadmin' },
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({
    query: mockQuery,
    getConnection: async () => ({
      query: mockConnQuery, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    }),
  }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://example.test', BCRYPT_SALT_ROUNDS: 4 } }));
vi.mock('../services/CertReminderService.js', () => ({ CertReminderService: class {} }));
vi.mock('../services/EmailService.js', () => ({ emailService: { sendPasswordResetEmail: vi.fn() } }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number; userRole: string }) => {
    request.userId = currentUser.id;
    request.userRole = currentUser.role;
  },
}));

import { adminRoutes, SECRET_MASK } from '../routes/admin.js';
import { payRateRoutes } from '../routes/pay-rates.js';
import { HRService } from '../services/HRService.js';
import { errorHandler } from '../plugins/errorHandler.js';

async function appWith(register: (app: FastifyInstance) => Promise<void>) {
  const app = Fastify();
  app.decorateRequest('userId', 0);
  app.decorateRequest('userRole', '');
  app.setErrorHandler(errorHandler);
  await register(app);
  await app.ready();
  return app;
}

const sqlOf = (mock: ReturnType<typeof vi.fn>, start: string) =>
  mock.mock.calls.find(([sql]) => String(sql).trim().startsWith(start));

describe('sysadmin screens', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    currentUser.role = 'sysadmin';
    app = await appWith((a) => a.register(adminRoutes, { prefix: '/sysadmin' }));
  });
  afterEach(() => app.close());

  describe('User Management', () => {
    it('lists users with the camelCase fields the table reads', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 3 }]]).mockResolvedValueOnce([[{ count: 1 }]]);

      await app.inject({ method: 'GET', url: '/sysadmin/users' });

      const sql = String(mockQuery.mock.calls[0][0]);
      for (const alias of ['AS firstName', 'AS lastName', 'AS fullName', 'AS organizationName', 'AS organizationId',
        'AS locationId', 'AS locationName', 'AS dateOnboarded', 'AS userComments']) {
        expect(sql).toContain(alias);
      }
      expect(sql).not.toMatch(/password_hash|reset_token|mfa_secret/);
    });

    it('saves an edit with no organization, a new password, onboarding date and comments', async () => {
      mockConnQuery.mockImplementation(async (sql: string) =>
        sql.includes('FOR UPDATE') ? [[{ email: 'pat@x.com' }]] : sql.startsWith('UPDATE') ? [{ affectedRows: 1 }] : [[{ id: 5 }]]);

      const res = await app.inject({
        method: 'PUT', url: '/sysadmin/users/5',
        payload: { username: 'pat', email: 'pat@x.com', role: 'instructor', organizationId: null, locationId: null,
          dateOnboarded: '2026-10-01', userComments: 'Starts Monday', status: 'active', password: 'NewPass123' },
      });

      expect(res.statusCode).toBe(200);
      const [sql, params] = sqlOf(mockConnQuery, 'UPDATE users')!;
      expect(sql).toContain('organization_id = ?');
      expect(sql).toContain('location_id = ?');
      expect(sql).toContain('date_onboarded = ?');
      expect(sql).toContain('user_comments = ?');
      expect(sql).toContain('password_hash = ?');
      expect(params).toContain('2026-10-01');
      expect(params).toContain('Starts Monday');
      const hash = (params as unknown[]).find((p) => typeof p === 'string' && p.startsWith('$2'));
      expect(await bcrypt.compare('NewPass123', String(hash))).toBe(true);
      expect(params).not.toContain('NewPass123');
      // A new password signs the user out everywhere, in the same transaction.
      expect(sqlOf(mockConnQuery, 'INSERT INTO token_blacklist')![1][0]).toBe('5');
      expect(sqlOf(mockConnQuery, 'UPDATE refresh_tokens SET revoked_at')![1]).toEqual(['5']);
      expect(sqlOf(mockConnQuery, 'UPDATE password_resets SET used_at')![1]).toEqual(['5']);
    });

    it('keeps the password, organization and location when they are left out or blank', async () => {
      mockConnQuery.mockImplementation(async (sql: string) =>
        sql.includes('FOR UPDATE') ? [[{ email: 'pat@x.com' }]] : sql.startsWith('UPDATE') ? [{ affectedRows: 1 }] : [[{ id: 5 }]]);

      const res = await app.inject({ method: 'PUT', url: '/sysadmin/users/5', payload: { status: 'inactive', password: '' } });

      expect(res.statusCode).toBe(200);
      const [sql] = sqlOf(mockConnQuery, 'UPDATE users')!;
      expect(sql).not.toContain('password_hash');
      expect(sql).not.toContain('organization_id = ?');
      expect(sqlOf(mockConnQuery, 'INSERT INTO token_blacklist')).toBeUndefined();
      expect(sqlOf(mockConnQuery, 'UPDATE refresh_tokens')).toBeUndefined();
      expect(sqlOf(mockConnQuery, 'UPDATE password_resets')).toBeUndefined();
    });

    it('refuses a new password shorter than 8 characters', async () => {
      const res = await app.inject({ method: 'PUT', url: '/sysadmin/users/5', payload: { password: 'short' } });
      expect(res.statusCode).toBe(400);
    });

    it('creates a user with onboarding date and comments', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      mockConnQuery.mockImplementation(async (sql: string) =>
        sql.startsWith('INSERT INTO users') ? [{ insertId: 8 }] : [[]]);

      const res = await app.inject({
        method: 'POST', url: '/sysadmin/users',
        payload: { username: 'newbie', email: 'n@x.com', password: 'Password1', role: 'hr', organizationId: null,
          locationId: null, dateOnboarded: '2026-10-20', userComments: 'Hi' },
      });

      expect(res.statusCode).toBe(200);
      const [sql, params] = sqlOf(mockConnQuery, 'INSERT INTO users')!;
      expect(sql).toContain('date_onboarded, user_comments');
      expect((params as unknown[]).slice(-4)).toEqual([null, null, '2026-10-20', 'Hi']);
    });
  });

  describe('Organizations', () => {
    it('lists organizations with screen names and user/course counts', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ id: 1, name: 'Acme', organizationName: 'Acme', userCount: '2', courseCount: '0' }]])
        .mockResolvedValueOnce([[{ count: 1 }]]);

      const res = await app.inject({ method: 'GET', url: '/sysadmin/organizations?search=ac' });

      expect(res.json().data[0]).toMatchObject({ organizationName: 'Acme', userCount: 2, courseCount: 0 });
      const sql = String(mockQuery.mock.calls[0][0]);
      for (const alias of ['AS contactPerson', 'AS contactEmail', 'AS contactPhone', 'AS postalCode',
        'AS organizationComments', 'AS userCount', 'AS courseCount']) {
        expect(sql).toContain(alias);
      }
      expect(sql).toContain('o.contact_name LIKE ?'); // there is no contact_person column
    });

    it('gives pickers a lean id/name list with ?basic=1', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, name: 'Acme', status: null }]]);

      const res = await app.inject({ method: 'GET', url: '/sysadmin/organizations?basic=1' });

      expect(res.json().data).toEqual([{ id: 1, name: 'Acme', status: null }]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(String(mockQuery.mock.calls[0][0])).toBe('SELECT id, name, status FROM organizations ORDER BY name LIMIT 5000');
    });

    it('updates only the fields sent, storing NULL for a cleared one', async () => {
      mockConnQuery.mockImplementation(async (sql: string) =>
        sql.startsWith('UPDATE organizations') ? [{ affectedRows: 1 }] : [[{ id: 4 }]]);

      const res = await app.inject({ method: 'PUT', url: '/sysadmin/organizations/4', payload: { name: 'Acme', contact_email: '' } });

      expect(res.statusCode).toBe(200);
      const [sql, params] = sqlOf(mockConnQuery, 'UPDATE organizations')!;
      expect(sql).toContain('SET name = ?, contact_email = ?, updated_at');
      expect(sql).not.toContain('COALESCE');
      expect(params).toEqual(['Acme', null, '4']);
    });

    it('creates an organization from the real columns, with a blank email', async () => {
      mockConnQuery.mockImplementation(async (sql: string) =>
        sql.startsWith('INSERT INTO organizations') ? [{ insertId: 4 }] : [[{ id: 4 }]]);

      const res = await app.inject({
        method: 'POST', url: '/sysadmin/organizations',
        payload: { name: 'Acme', contact_name: 'Jo Park', contact_position: 'Owner', contact_email: '',
          address_city: 'Toronto', address_postal_code: 'M1M 1M1', organization_comments: 'VIP' },
      });

      expect(res.statusCode).toBe(200);
      const [sql, params] = sqlOf(mockConnQuery, 'INSERT INTO organizations')!;
      expect(sql).toContain('contact_name');
      expect(sql).toContain('organization_comments');
      expect(params).toEqual(['Acme', 'Jo Park', 'Owner', null, null, null, 'Toronto', null, 'M1M 1M1', null, 'VIP']);
    });
  });

  describe('Locations', () => {
    it('returns camelCase fields, a true/false isActive and usage counts', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 2, location_name: 'HQ', locationName: 'HQ', is_active: 0, userCount: '3', courseCount: '1' }]]);

      const res = await app.inject({ method: 'GET', url: '/sysadmin/organizations/1/locations' });

      expect(res.json().data[0]).toMatchObject({ locationName: 'HQ', isActive: false, userCount: 3, courseCount: 1 });
      const sql = String(mockQuery.mock.calls[0][0]);
      for (const alias of ['AS contactFirstName', 'AS contactLastName', 'AS contactEmail', 'AS postalCode']) {
        expect(sql).toContain(alias);
      }
    });
  });

  describe('Vendors', () => {
    it('creates a vendor from the real columns; a blank email is allowed', async () => {
      mockQuery.mockResolvedValueOnce([{ insertId: 6 }]).mockResolvedValueOnce([[{ id: 6, name: 'Supply Co', is_active: 1 }]]);

      const res = await app.inject({
        method: 'POST', url: '/sysadmin/vendors',
        payload: { name: 'Supply Co', contact_name: 'Ann', contact_email: '', vendor_type: 'Other', notes: 'n', is_active: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ vendorName: 'Supply Co', isActive: true, status: 'active' });
      const [sql, params] = sqlOf(mockQuery, 'INSERT INTO vendors')!;
      expect(sql).not.toMatch(/vendor_name|address_street/);
      expect(params).toEqual(['Supply Co', 'Ann', null, null, null, 'Other', null, null, null, 'n', 1]);
    });

    it('needs a vendor name', async () => {
      const res = await app.inject({ method: 'POST', url: '/sysadmin/vendors', payload: { contact_name: 'Ann' } });
      expect(res.statusCode).toBe(400);
    });

    it('updates only the fields sent and can deactivate', async () => {
      mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ id: 6, name: 'S', is_active: 0 }]]);

      await app.inject({ method: 'PUT', url: '/sysadmin/vendors/6', payload: { contact_email: '', is_active: false } });

      const [sql, params] = sqlOf(mockQuery, 'UPDATE vendors')!;
      expect(sql).toContain('contact_email = ?, is_active = ?, updated_at');
      expect(sql).not.toContain('name = ?');
      expect(params).toEqual([null, 0, 6]);
    });
  });

  describe('System Configuration', () => {
    const rows = [
      { id: 1, config_key: 'email_smtp_host', config_value: 'smtp.x.com', description: 'Host', category: 'email' },
      { id: 2, config_key: 'email_smtp_pass', config_value: 'hunter2', description: 'Password', category: 'email' },
      { id: 3, config_key: 'site_name', config_value: 'CPR', description: 'Name', category: 'general' },
      { id: 4, config_key: 'password_min_length', config_value: '8', description: 'Min', category: 'security' },
    ];

    it('groups by category in camelCase and never sends a password back', async () => {
      mockQuery.mockResolvedValueOnce([rows]);

      const res = await app.inject({ method: 'GET', url: '/sysadmin/configurations' });

      const data = res.json().data;
      expect(Object.keys(data)).toEqual(['email', 'general', 'security']);
      // Only keys ending _pass/_password/_secret/_token/_api_key are secrets.
      expect(data.security[0]).toMatchObject({ configKey: 'password_min_length', configValue: '8', isSecret: false });
      expect(data.email[0]).toMatchObject({ configKey: 'email_smtp_host', configValue: 'smtp.x.com', isSecret: false });
      expect(data.email[1]).toMatchObject({ configKey: 'email_smtp_pass', configValue: SECRET_MASK, isSecret: true });
      expect(res.body).not.toContain('hunter2');
    });

    it('ignores the mask when it is saved back unchanged', async () => {
      const res = await app.inject({ method: 'PUT', url: '/sysadmin/configurations/email_smtp_pass', payload: { value: SECRET_MASK } });

      expect(res.statusCode).toBe(200);
      expect(mockConnQuery).not.toHaveBeenCalled();
    });

    it('saves a new password without echoing it or writing it to the audit log', async () => {
      mockConnQuery.mockImplementation(async (sql: string) =>
        sql.startsWith('UPDATE') ? [{ affectedRows: 1 }] : [[{ config_value: 'hunter2' }]]);

      const res = await app.inject({ method: 'PUT', url: '/sysadmin/configurations/email_smtp_pass', payload: { value: 'n3w-secret' } });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('n3w-secret');
      const audit = mockConnQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'))!;
      expect(JSON.stringify(audit[1])).not.toMatch(/hunter2|n3w-secret/);
    });
  });

  describe('Course Management', () => {
    it('sends isActive as true/false next to is_active', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, name: 'CPR', is_active: 0 }, { id: 2, name: 'BLS', is_active: 1 }]]);

      const res = await app.inject({ method: 'GET', url: '/sysadmin/courses' });

      expect(res.json().data.map((c: { isActive: boolean }) => c.isActive)).toEqual([false, true]);
    });
  });

  describe('Student Directory search', () => {
    it('includes the organization and says when only the first 50 matches are shown', async () => {
      mockQuery.mockResolvedValueOnce([Array.from({ length: 51 }, (_, i) => ({ id: i, organization_name: 'Acme' }))]);

      const res = await app.inject({ method: 'GET', url: '/sysadmin/students?q=sm' });

      const body = res.json();
      expect(body.data).toHaveLength(50);
      expect(body.truncated).toBe(true);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('LEFT JOIN organizations o ON s.organization_id = o.id');
      expect(sql).toContain('o.name as organization_name');
      expect(params[3]).toBe(51);
    });
  });
});

describe('HR pay rate screens', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await appWith((a) => a.register(payRateRoutes, { prefix: '/pay-rates' }));
  });
  afterEach(() => app.close());

  it('sends tiers with number rates and a true/false isActive', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1, name: 'Senior', base_hourly_rate: '42.50', course_bonus: '60.00', is_active: 1 }]]);

    const res = await app.inject({ method: 'GET', url: '/pay-rates/tiers' });

    expect(res.json().data[0]).toMatchObject({ baseHourlyRate: 42.5, courseBonus: 60, isActive: true });
  });

  it('lists instructors with rateStatus and rateActive', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 4, rateStatus: 'Set', rateActive: 1 }, { id: 5, rateStatus: 'Not Set', rateActive: null }]])
      .mockResolvedValueOnce([[{ total: 2 }]]);

    const res = await app.inject({ method: 'GET', url: '/pay-rates/instructors' });

    expect(res.json().data.instructors).toEqual([
      { id: 4, rateStatus: 'Set', rateActive: true },
      { id: 5, rateStatus: 'Not Set', rateActive: null },
    ]);
    expect(String(mockQuery.mock.calls[0][0])).toContain('as rateStatus');
  });
});

describe('HRService screens', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returned payment requests carry the camelCase fields the screen reads', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

    await new HRService().getReturnedPaymentRequests({ page: 1, limit: 10 });

    const sql = String(mockQuery.mock.calls[0][0]);
    for (const alias of ['as instructorName', 'as instructorEmail', 'as weekStartDate', 'as totalHours',
      'as coursesTaught', 'as hourlyRate', 'as courseBonus', 'as baseAmount', 'as bonusAmount', 'as tierName']) {
      expect(sql).toContain(alias);
    }
  });

  it('counts expiring certificates from course_students, not the empty certifications table', async () => {
    mockQuery.mockResolvedValue([[{ count: 0 }]]);

    await new HRService().getDashboardStats();

    const sql = String(mockQuery.mock.calls[2][0]);
    expect(sql).toContain('FROM course_students');
    expect(sql).toContain('certificate_expires_at');
    expect(sql).not.toContain('FROM certifications');
  });
});
