import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// The sysadmin Audit Log screen: names instead of user ids, and the money filter.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../services/CertReminderService.js', () => ({ CertReminderService: class {} }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async () => {},
}));

import { adminRoutes } from '../routes/admin.js';

describe('audit log routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('COUNT(*)') ? [[{ count: 1 }]] : [[{ id: 1, username: 'accountant', action: 'record_payment' }]]);
    app = Fastify();
    await app.register(adminRoutes, { prefix: '/sysadmin' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('shows the username from users when the entry only stored a user id', async () => {
    const res = await app.inject({ method: 'GET', url: '/sysadmin/audit-logs' });

    expect(res.statusCode).toBe(200);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('LEFT JOIN users u ON u.id = a.user_id');
    expect(sql).toContain('COALESCE(u.username, a.username) AS username');
  });

  it('"All money activity" selects every money entity type', async () => {
    await app.inject({ method: 'GET', url: '/sysadmin/audit-logs?entity_type=money' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('a.entity_type IN (');
    expect(params).toEqual(expect.arrayContaining(['invoice', 'payment', 'payroll_payment', 'vendor_invoice', 'timesheet', 'set_instructor_pay_rate']));
    expect(params).not.toContain('money');
  });

  it('CSV export applies the same search as the screen', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await app.inject({ method: 'GET', url: '/sysadmin/audit-logs/export/csv?search=payment' });

    expect(res.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('a.action LIKE ?');
    expect(params).toEqual(['%payment%', '%payment%', '%payment%', '%payment%']);
  });
});
