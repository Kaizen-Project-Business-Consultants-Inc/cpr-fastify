import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Sysadmin → Colleges screen: add, rename, show/hide, delete.
const { mockQuery, mockAudit } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockAudit: vi.fn() }));

vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../utils/auditLog.js', () => ({ logAudit: mockAudit }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number }) => { request.userId = 1; },
}));

import { collegeRoutes } from '../routes/colleges.js';
import { errorHandler } from '../plugins/errorHandler.js';

describe('college admin routes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.decorateRequest('userId', 0);
    app.setErrorHandler(errorHandler);
    await app.register(collegeRoutes, { prefix: '/colleges' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('adds a trimmed name and records it in the audit log', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('INSERT') ? [{ insertId: 7 }] : sql.startsWith('SELECT *') ? [[{ id: 7, name: 'Seneca' }]] : [[]]);

    const res = await app.inject({ method: 'POST', url: '/colleges', payload: { name: '  Seneca  ' } });

    expect(res.statusCode).toBe(200);
    expect(mockQuery.mock.calls.find(([s]) => String(s).startsWith('INSERT'))![1]).toEqual(['Seneca']);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'college_created', entityId: 7 }));
  });

  it('refuses a blank name', async () => {
    const res = await app.inject({ method: 'POST', url: '/colleges', payload: { name: '   ' } });
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses renaming to a name another college already has', async () => {
    mockQuery.mockResolvedValueOnce([[{ name: 'Old', is_active: 1 }]]).mockResolvedValueOnce([[{ id: 3 }]]);

    const res = await app.inject({ method: 'PUT', url: '/colleges/5', payload: { name: 'Seneca' } });

    expect(res.statusCode).toBe(400);
    expect(mockQuery.mock.calls[1][1]).toEqual(['Seneca', 5]); // its own name doesn't count
    expect(mockQuery.mock.calls.some(([s]) => String(s).startsWith('UPDATE'))).toBe(false);
  });

  it('hides a college and logs the before and after', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT name, is_active') ? [[{ name: 'Seneca', is_active: 1 }]] : sql.startsWith('SELECT *') ? [[{ id: 5 }]] : [{}]);

    const res = await app.inject({ method: 'PUT', url: '/colleges/5', payload: { isActive: false } });

    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'college_updated', entityId: 5, details: expect.objectContaining({ before: { name: 'Seneca', isActive: true }, isActive: false }),
    }));
  });

  it('returns 404 when updating a college that is not there', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await app.inject({ method: 'PUT', url: '/colleges/99', payload: { name: 'Seneca' } });
    expect(res.statusCode).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when deleting a college that is not there', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await app.inject({ method: 'DELETE', url: '/colleges/99' });
    expect(res.statusCode).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/colleges/abc' });
    expect(res.statusCode).toBe(400);
  });

  it('deletes and keeps the name in the audit log', async () => {
    mockQuery.mockResolvedValueOnce([[{ name: 'Seneca' }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await app.inject({ method: 'DELETE', url: '/colleges/5' });
    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'college_deleted', details: { name: 'Seneca' } }));
  });
});
