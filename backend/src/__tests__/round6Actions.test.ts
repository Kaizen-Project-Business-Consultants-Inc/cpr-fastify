import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Round 6: buttons for features that already had a server side.
const { mockQuery, mockConnQuery, mockSendReset, currentUser } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnQuery: vi.fn(),
  mockSendReset: vi.fn(),
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
vi.mock('../services/EmailService.js', () => ({ emailService: { sendPasswordResetEmail: mockSendReset } }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number; userRole: string }) => {
    request.userId = currentUser.id;
    request.userRole = currentUser.role;
  },
}));

import { adminRoutes } from '../routes/admin.js';
import { vendorAdminRoutes } from '../routes/vendor-admin.js';
import { vendorRoutes } from '../routes/vendors.js';
import { CourseService, CourseError } from '../services/CourseService.js';
import { errorHandler } from '../plugins/errorHandler.js';

async function appWith(register: (app: FastifyInstance) => Promise<void>) {
  const app = Fastify();
  app.decorateRequest('userId', 0);
  app.decorateRequest('userRole', '');
  app.setErrorHandler(errorHandler); // as in app.ts: zod -> 400, statusCode errors keep their status
  await register(app);
  await app.ready();
  return app;
}

describe('sysadmin: send password reset link', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    currentUser.role = 'sysadmin';
    app = await appWith((a) => a.register(adminRoutes, { prefix: '/sysadmin' }));
  });
  afterEach(() => app.close());

  it('emails a one-hour reset link and stores only its hash', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT id, username, email, status') ? [[{ id: 5, username: 'pat', email: 'pat@x.com', status: 'active' }]] : [{}]);
    mockSendReset.mockResolvedValue(true);

    const res = await app.inject({ method: 'POST', url: '/sysadmin/users/5/reset-password' });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('A password reset link was emailed to pat@x.com.');
    const [to, username, link] = mockSendReset.mock.calls[0];
    expect([to, username]).toEqual(['pat@x.com', 'pat']);
    expect(link).toMatch(/^https:\/\/example\.test\/reset-password\?token=[0-9a-f]{64}$/);
    const insert = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO password_resets'));
    expect(insert![1][1]).not.toBe(link.split('token=')[1]); // stored hashed, not the token itself
  });

  it('lets only a sysadmin send a link to an admin or sysadmin', async () => {
    currentUser.role = 'admin';
    mockQuery.mockResolvedValueOnce([[{ id: 2, username: 'root', email: 'root@x.com', status: 'active', role: 'sysadmin' }]]);

    const res = await app.inject({ method: 'POST', url: '/sysadmin/users/2/reset-password' });

    expect(res.statusCode).toBe(403);
    expect(mockSendReset).not.toHaveBeenCalled();
  });

  it('explains when the account cannot receive a link', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 5, username: 'pat', email: null, status: 'active' }]]);

    const res = await app.inject({ method: 'POST', url: '/sysadmin/users/5/reset-password' });

    expect(res.statusCode).toBe(400);
    expect(mockSendReset).not.toHaveBeenCalled();
  });
});

describe('sysadmin: erase personal data', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    currentUser.id = 1;
    app = await appWith((a) => a.register(adminRoutes, { prefix: '/sysadmin' }));
  });
  afterEach(() => app.close());

  it('blanks the person, signs them out and keeps only the role in the audit entry', async () => {
    mockConnQuery.mockImplementation(async (sql: string) =>
      sql.includes('FOR UPDATE') ? [[{ id: 9, username: 'jane', role: 'instructor' }]] : [{ affectedRows: 1 }]);

    const res = await app.inject({ method: 'DELETE', url: '/sysadmin/users/9/personal-data' });

    expect(res.statusCode).toBe(200);
    const sqls = mockConnQuery.mock.calls.map(([sql]) => String(sql));
    const update = sqls.find((q) => q.startsWith('UPDATE users'))!;
    expect(update).toContain("status = 'deleted'");
    expect(update).toContain('address = NULL');
    expect(update).toContain('mfa_secret = NULL');
    expect(sqls.some((q) => q.startsWith('UPDATE refresh_tokens SET revoked_at'))).toBe(true);
    expect(sqls.some((q) => q.startsWith('UPDATE password_resets SET used_at'))).toBe(true);
    const audit = mockConnQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
    expect(JSON.parse(audit![1][5])).toEqual({ role: 'instructor' });
  });

  it('scrambles the password, signs them out now and scrubs their details elsewhere', async () => {
    mockConnQuery.mockImplementation(async (sql: string) =>
      sql.includes('FOR UPDATE') ? [[{ id: 9, username: 'jane', email: 'jane@x.com', role: 'instructor' }]] : [{ affectedRows: 1 }]);

    await app.inject({ method: 'DELETE', url: '/sysadmin/users/9/personal-data' });

    const calls = mockConnQuery.mock.calls.map(([sql, params]) => [String(sql), params] as const);
    const update = calls.find(([q]) => q.startsWith('UPDATE users'))!;
    expect(update[0]).toContain('password_hash = ?');
    expect(String(update[1][0])).toMatch(/^\$2[aby]\$/); // a fresh bcrypt hash, not the old one
    expect(calls.some(([q]) => q.startsWith('INSERT INTO token_blacklist'))).toBe(true);
    expect(calls.some(([q]) => q.includes("SET details = NULL WHERE entity_type = 'user'"))).toBe(true);
    const typedLogins = calls.find(([q]) => q.includes('WHERE user_id IS NULL AND username IN'))!;
    expect(typedLogins[1]).toEqual(['jane', 'jane@x.com']);
    expect(calls.some(([q]) => q.startsWith('UPDATE profile_changes'))).toBe(true);
    expect(calls.some(([q]) => q.startsWith('UPDATE inbound_emails'))).toBe(true);
  });

  it('refuses to edit an erased account (it can never be reactivated)', async () => {
    mockConnQuery.mockResolvedValueOnce([[{ email: 'deleted_9@deleted.invalid' }]]);

    const res = await app.inject({ method: 'PUT', url: '/sysadmin/users/9', payload: { status: 'active' } });

    expect(res.statusCode).toBe(400);
    expect(mockConnQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE users'))).toBe(false);
  });

  it('will not erase the signed-in sysadmin', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/sysadmin/users/1/personal-data' });

    expect(res.statusCode).toBe(400);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });
});

describe('accounting: reject a vendor invoice', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await appWith((a) => a.register(vendorAdminRoutes));
  });
  afterEach(() => app.close());

  it('refuses once a payment has gone out', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ id: 4, status: 'submitted_to_accounting' }]])
      .mockResolvedValueOnce([[{ n: 1 }]]);

    const res = await app.inject({ method: 'POST', url: '/accounting/vendor-invoices/4/reject', payload: { notes: 'Wrong rate' } });

    expect(res.statusCode).toBe(400);
    expect(mockConnQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE vendor_invoices'))).toBe(false);
  });
});

describe('vendor: resend a rejected invoice', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await appWith((a) => a.register(vendorRoutes, { prefix: '/vendor' }));
  });
  afterEach(() => app.close());

  it('sends it back to admin with the vendor note, only from a rejected state', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT email FROM users')) return [[{ email: 'v@x.com' }]];
      if (sql.startsWith('SELECT id FROM vendors')) return [[{ id: 3 }]];
      return [{ affectedRows: 1 }];
    });

    const res = await app.inject({ method: 'POST', url: '/vendor/invoices/7/resend-to-admin', payload: { notes: 'Fixed the rate' } });

    expect(res.statusCode).toBe(200);
    const update = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE vendor_invoices'))!;
    expect(String(update[0])).toContain("status IN ('rejected_by_admin', 'rejected_by_accountant')");
    expect(update[1]).toEqual(['Fixed the rate', 7, 3]);
  });

  it('needs a note', async () => {
    const res = await app.inject({ method: 'POST', url: '/vendor/invoices/7/resend-to-admin', payload: { notes: '  ' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('organization: remove a student from a roster', () => {
  it('is only allowed before the class is completed', async () => {
    const courseRepo = { forOrg: () => ({ findById: async () => ({ id: 3, status: 'completed' }) }) };
    const studentRepo = { removeFromCourse: vi.fn() };
    const service = new CourseService(courseRepo as never, studentRepo as never, {} as never);

    await expect(service.removeStudent(3, 12, 40)).rejects.toThrow(CourseError);
    expect(studentRepo.removeFromCourse).not.toHaveBeenCalled();
  });

  it('applies the same rule to adding students', async () => {
    const courseRepo = { forOrg: () => ({ findById: async () => ({ id: 3, status: 'invoiced' }) }) };
    const service = new CourseService(courseRepo as never, {} as never, {} as never);

    await expect(service.addStudents(3, 12, [{ firstName: 'A', lastName: 'B' }])).rejects.toThrow(/before the class/);
  });
});
