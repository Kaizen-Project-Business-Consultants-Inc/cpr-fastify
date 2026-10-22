import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// UAT 2026-10-21: attendance is marked before Complete Class, but only the
// attendance tick set certificate dates (and only for an already-completed
// class), so new students never got certificate or expiry dates.
const { mockQuery, mockConn } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConn: { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve(mockConn) }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://example.test' } }));
vi.mock('../services/CertReminderService.js', () => ({ CertReminderService: class {} }));
vi.mock('../services/EmailService.js', () => ({ emailService: { sendCourseCompletedEmail: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId?: number; userRole?: string }) => {
    request.userId = 4;
    request.userRole = 'instructor';
  },
}));

import { instructorRoutes } from '../routes/instructors.js';
import { adminRoutes } from '../routes/admin.js';
import { ISSUE_CERTIFICATES_SQL, completedClassDate } from '../utils/classDateSql.js';
import { migrations } from '../config/migrations.js';

const flat = (sql: unknown) => String(sql).replace(/\s+/g, ' ');

describe('certificate dates', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConn.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    mockQuery.mockReset();
    app = Fastify();
    await app.register(instructorRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('are issued on the class day, expiring after the course validity', () => {
    const sql = flat(ISSUE_CERTIFICATES_SQL);
    expect(sql).toContain(`cs.certificate_issued_at = ${completedClassDate('cr')}`);
    expect(sql).toContain(`DATE_ADD(${completedClassDate('cr')}, INTERVAL ct.certification_validity_months MONTH)`);
    for (const rule of ['cs.attended = true', 'cs.deleted_at IS NULL', 'cr.completed_at IS NOT NULL', 'ct.certification_validity_months IS NOT NULL']) {
      expect(sql).toContain(rule);
    }
  });

  it('Complete Class sets them for the attended students, inside the transaction', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 9, status: 'confirmed' }]]) // ownership check
      .mockResolvedValue([[{ id: 9, status: 'completed' }]]);

    const res = await app.inject({ method: 'POST', url: '/classes/9/complete', payload: {} });

    expect(res.statusCode).toBe(200);
    const calls = mockConn.query.mock.calls.map(([sql, params]) => [flat(sql), params]);
    const completeIdx = calls.findIndex(([sql]) => (sql as string).includes("SET status = 'completed'"));
    const certIdx = calls.findIndex(([sql]) => (sql as string).includes('UPDATE course_students cs'));
    expect(certIdx).toBeGreaterThan(completeIdx);
    expect(calls[certIdx][0]).toContain('AND cs.course_request_id = ?');
    expect(calls[certIdx][1]).toEqual(['9']);
    expect(mockConn.commit).toHaveBeenCalledTimes(1);
  });

  it('marking a student present sets them only through the completed-class rule', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 9 }]]) // ownership check
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // attendance update
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // certificates (class not completed yet)
      .mockResolvedValueOnce([[{ id: 3, first_name: 'Ava', last_name: 'Lee', attended: 1, attendance_marked: 1 }]]);

    const res = await app.inject({ method: 'PUT', url: '/classes/9/students/3/attendance', payload: { attended: true } });

    expect(res.statusCode).toBe(200);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(flat(updateSql)).not.toContain('certificate_issued_at');
    expect(updateParams).toEqual([true, '3', '9']);
    const [certSql, certParams] = mockQuery.mock.calls[2];
    expect(flat(certSql)).toContain('UPDATE course_students cs');
    expect(flat(certSql)).toContain('AND cs.id = ? AND cs.course_request_id = ?');
    expect(certParams).toEqual(['3', '9']);
  });

  it('marking a student absent clears them', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 3, first_name: 'Ava', last_name: 'Lee', attended: 0, attendance_marked: 1 }]]);

    const res = await app.inject({ method: 'PUT', url: '/classes/9/students/3/attendance', payload: { attended: false } });

    expect(res.statusCode).toBe(200);
    expect(flat(mockQuery.mock.calls[1][0])).toContain('certificate_issued_at = NULL, certificate_expires_at = NULL');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('migration 30 re-derives them for every completed class', async () => {
    const query = vi.fn().mockResolvedValue([{ affectedRows: 2 }]);
    await (migrations.find((m) => m.version === 30)!.up as (pool: unknown) => Promise<void>)({ query });
    expect(query).toHaveBeenCalledTimes(1);
    // Frozen copy of today's helper.
    expect(flat(query.mock.calls[0][0])).toBe(flat(ISSUE_CERTIFICATES_SQL));
  });
});

describe('changing a course validity period', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset().mockImplementation(async (sql: string) =>
      /^\s*UPDATE/.test(sql) ? [{ affectedRows: 1 }] : [[{ id: 18, certification_validity_months: 24 }]]);
    app = Fastify();
    await app.register(adminRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('fills in certificates for classes already completed', async () => {
    const res = await app.inject({ method: 'PUT', url: '/courses/18', payload: { certification_validity_months: 24 } });
    expect(res.statusCode).toBe(200);
    const cert = mockQuery.mock.calls.find(([sql]) => flat(sql).includes('UPDATE course_students cs'));
    expect(cert).toBeTruthy();
    expect(flat(cert![0])).toContain('AND ct.id = ?');
    expect(cert![1]).toEqual(['18']);
  });

  it('leaves issued certificates alone when the period is removed or not changed', async () => {
    await app.inject({ method: 'PUT', url: '/courses/18', payload: { certification_validity_months: null } });
    await app.inject({ method: 'PUT', url: '/courses/18', payload: { name: 'Basic First Aid' } });
    expect(mockQuery.mock.calls.some(([sql]) => flat(sql).includes('UPDATE course_students cs'))).toBe(false);
  });
});
