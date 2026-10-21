import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Owner request 2026-10-20: instructors pick several days on My Availability
// and save them in one go. The server applies the single-date rules per date.
const { mockQuery, mockConn } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConn: {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve(mockConn) }),
}));
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId?: number; userRole?: string }) => {
    request.userId = 4;
    request.userRole = 'instructor';
  },
}));
// Pin "today" in Toronto so the day maths is stable.
vi.mock('../utils/torontoDate.js', () => ({ torontoToday: () => '2026-10-21' }));

import { instructorRoutes } from '../routes/instructors.js';

describe('POST /availability/batch', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConn.query.mockReset();
    app = Fastify();
    await app.register(instructorRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  /** First conn query is the existing-dates lookup; later ones are writes. */
  function existing(days: string[]) {
    mockConn.query.mockResolvedValueOnce([days.map((day) => ({ day }))]).mockResolvedValue([{ affectedRows: 1 }]);
  }

  it('adds and removes in one transaction and reports what it did', async () => {
    existing(['2026-11-20']);
    const res = await app.inject({
      method: 'POST', url: '/availability/batch',
      payload: { add: ['2026-11-02', '2026-11-01'], remove: ['2026-11-20'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true, added: ['2026-11-01', '2026-11-02'], removed: ['2026-11-20'], skipped: [],
    });
    expect(mockConn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mockConn.commit).toHaveBeenCalledTimes(1);
    expect(mockConn.rollback).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled(); // every query went through the transaction's connection

    const [lookupSql, lookupParams] = mockConn.query.mock.calls[0];
    expect(lookupSql).toContain('FOR UPDATE');
    expect(lookupParams).toEqual([4, ['2026-11-01', '2026-11-02', '2026-11-20']]);
    const [insertSql, insertParams] = mockConn.query.mock.calls[1];
    expect(insertSql).toContain('INSERT INTO instructor_availability');
    expect(insertParams).toEqual([[[4, '2026-11-01', 'available'], [4, '2026-11-02', 'available']]]);
    const [deleteSql, deleteParams] = mockConn.query.mock.calls[2];
    expect(deleteSql).toContain('DELETE FROM instructor_availability');
    expect(deleteParams).toEqual([4, ['2026-11-20']]);
  });

  it('skips a day that is already available (not an error)', async () => {
    existing(['2026-11-01']);
    const res = await app.inject({ method: 'POST', url: '/availability/batch', payload: { add: ['2026-11-01', '2026-11-03'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      added: ['2026-11-03'], skipped: [{ date: '2026-11-01', reason: 'Already available' }],
    });
  });

  it('refuses a past day for adding, but today is fine', async () => {
    existing([]);
    const res = await app.inject({ method: 'POST', url: '/availability/batch', payload: { add: ['2026-10-20', '2026-10-21'] } });
    expect(res.json()).toMatchObject({
      added: ['2026-10-21'],
      skipped: [{ date: '2026-10-20', reason: 'Availability cannot be added for a past date' }],
    });
  });

  it('refuses removing a day 5 days or less away, allows 6 days away', async () => {
    existing(['2026-10-26', '2026-10-27']);
    const res = await app.inject({ method: 'POST', url: '/availability/batch', payload: { remove: ['2026-10-26', '2026-10-27'] } });
    const body = res.json();
    expect(body.removed).toEqual(['2026-10-27']);
    expect(body.skipped).toEqual([{ date: '2026-10-26', reason: expect.stringContaining('5 days or less') }]);
  });

  it('skips removing a day that is not available', async () => {
    existing([]);
    const res = await app.inject({ method: 'POST', url: '/availability/batch', payload: { remove: ['2026-12-01'] } });
    expect(res.json()).toMatchObject({ removed: [], skipped: [{ date: '2026-12-01', reason: 'Not marked as available' }] });
    expect(mockConn.query).toHaveBeenCalledTimes(1); // nothing to write
    expect(mockConn.commit).toHaveBeenCalled();
  });

  it('rolls back if a write fails', async () => {
    mockConn.query.mockResolvedValueOnce([[]]).mockRejectedValueOnce(new Error('db down'));
    const res = await app.inject({ method: 'POST', url: '/availability/batch', payload: { add: ['2026-11-01'] } });
    expect(res.statusCode).toBe(500);
    expect(mockConn.rollback).toHaveBeenCalledTimes(1);
    expect(mockConn.commit).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no dates', { add: [], remove: [] }],
    ['a bad format', { add: ['11/01/2026'] }],
    ['an impossible date', { add: ['2026-02-30'] }],
    ['the same day in add and remove', { add: ['2026-11-01'], remove: ['2026-11-01'] }],
    ['more than 100 dates', { add: Array.from({ length: 101 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10)) }],
  ])('returns 400 for %s', async (_label, payload) => {
    const res = await app.inject({ method: 'POST', url: '/availability/batch', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual(expect.any(String));
    expect(mockConn.beginTransaction).not.toHaveBeenCalled();
  });
});

describe('POST /availability (single date)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(instructorRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  it('refuses a past date (Toronto day) without touching the database', async () => {
    const res = await app.inject({ method: 'POST', url: '/availability', payload: { date: '2026-10-20' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Availability cannot be added for a past date');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still accepts today', async () => {
    mockQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1, date: '2026-10-21' }]]);
    const res = await app.inject({ method: 'POST', url: '/availability', payload: { date: '2026-10-21' } });
    expect(res.statusCode).toBe(200);
  });

  // MariaDB matches '2026-10-23T00:00:00' or '20261023' against a DATE, so
  // anything but plain YYYY-MM-DD could slip past the date rules.
  it('only accepts plain YYYY-MM-DD dates, so the rules cannot be side-stepped', async () => {
    for (const date of ['2026-10-23T00:00:00', '20261023', '2026-10-23 ', 'October 23 2026']) {
      const add = await app.inject({ method: 'POST', url: '/availability', payload: { date } });
      expect(add.statusCode, `POST ${date}`).toBe(400);
      const del = await app.inject({ method: 'DELETE', url: `/availability/${encodeURIComponent(date)}` });
      expect(del.statusCode, `DELETE ${date}`).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses removing a day 5 days or less away through the single DELETE', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/availability/2026-10-23' });
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
