import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// HR → Payroll → Calculate: the instructor's own pay rate and course bonus are used, and a typed
// hourly override replaces only the hourly rate.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number }) => { request.userId = 1; },
}));

import { payrollRoutes } from '../routes/payroll.js';
import { errorHandler } from '../plugins/errorHandler.js';

const payload = { start_date: '2026-03-01', end_date: '2026-03-31' };

function db(rate: { hourly_rate: number; course_bonus: number; tier_name: string } | null) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM timesheets')) return [[{ total_hours: 10, total_courses: 3, timesheet_count: 2 }]];
    if (sql.includes('FROM users')) return [[{ username: 'pat', email: 'pat@x.com' }]];
    if (sql.includes('FROM instructor_pay_rates')) return [rate ? [rate] : []];
    return [[]];
  });
}

describe('POST /payroll/calculate/:instructorId', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.decorateRequest('userId', 0);
    app.setErrorHandler(errorHandler);
    await app.register(payrollRoutes, { prefix: '/payroll' });
    await app.ready();
  });
  afterEach(() => app.close());

  it("uses the instructor's own rate and bonus when no override is given", async () => {
    db({ hourly_rate: 30, course_bonus: 40, tier_name: 'Senior' });
    const res = await app.inject({ method: 'POST', url: '/payroll/calculate/4', payload });
    const { rates, calculation } = res.json().data;
    expect(rates).toEqual({ hourlyRate: 30, courseBonus: 40, tierName: 'Senior', isDefaultRate: false });
    expect(calculation).toEqual({ baseAmount: 300, courseBonus: 120, totalAmount: 420 });
  });

  it("an override replaces the hourly rate but keeps the instructor's course bonus", async () => {
    db({ hourly_rate: 30, course_bonus: 40, tier_name: 'Senior' });
    const res = await app.inject({ method: 'POST', url: '/payroll/calculate/4', payload: { ...payload, hourly_rate: 22.5 } });
    const { rates, calculation } = res.json().data;
    expect(rates).toEqual({ hourlyRate: 22.5, courseBonus: 40, tierName: 'Override', isDefaultRate: false });
    expect(calculation).toEqual({ baseAmount: 225, courseBonus: 120, totalAmount: 345 });
  });

  it('falls back to the default rates when none is on file', async () => {
    db(null);
    const res = await app.inject({ method: 'POST', url: '/payroll/calculate/4', payload });
    expect(res.json().data.rates).toEqual({ hourlyRate: 25, courseBonus: 50, tierName: 'Default', isDefaultRate: true });
  });
});
