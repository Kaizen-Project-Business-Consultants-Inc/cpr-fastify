import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// The outside timer runs the class reminders through POST /class-reminders/run, guarded by a shared secret.
const { mockQuery, mockConn, mockEnv } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConn: { query: vi.fn(), release: vi.fn() },
  mockEnv: { FRONTEND_URL: 'https://example.test', JWT_ACCESS_SECRET: 'x'.repeat(40), CRON_SECRET: 'c'.repeat(32) as string | undefined },
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve(mockConn) }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: mockEnv }));
vi.mock('../services/EmailService.js', () => ({ emailService: {} }));
vi.mock('../services/GeocodeService.js', () => ({ geocodeVenue: vi.fn() }));

import { classReminderRoutes } from '../routes/classReminders.js';

describe('POST /run (class reminders, called by the outside timer)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockEnv.CRON_SECRET = 'c'.repeat(32);
    mockQuery.mockReset().mockResolvedValue([[]]); // no classes in the next two days
    mockConn.query.mockReset().mockResolvedValue([[{ got: 1 }]]);
    app = Fastify();
    await app.register(classReminderRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  const run = (headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/run', headers });
  const ranCheck = () => mockConn.query.mock.calls.some(([sql]) => String(sql).includes('GET_LOCK'));

  it('runs the reminder check when the secret matches', async () => {
    const res = await run({ 'x-cron-secret': 'c'.repeat(32) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { sent: 0 } });
    expect(ranCheck()).toBe(true);
  });

  it('refuses a wrong secret, a missing one, and a different-length one, without running anything', async () => {
    for (const headers of [{ 'x-cron-secret': 'wrong' }, {}, { 'x-cron-secret': 'c'.repeat(33) }]) {
      expect((await run(headers)).statusCode).toBe(401);
    }
    expect(ranCheck()).toBe(false);
  });

  it('is switched off until a secret is configured, even for an empty header', async () => {
    mockEnv.CRON_SECRET = undefined;
    expect((await run({ 'x-cron-secret': '' })).statusCode).toBe(503);
    expect((await run()).statusCode).toBe(503);
    expect(ranCheck()).toBe(false);
  });

  it('stays switched off while the secret is too short to be safe', async () => {
    mockEnv.CRON_SECRET = 'short';
    expect((await run({ 'x-cron-secret': 'short' })).statusCode).toBe(503);
    expect(ranCheck()).toBe(false);
  });
});
