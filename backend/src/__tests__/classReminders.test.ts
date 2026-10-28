import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const { mockQuery, mockConn, mockEmail } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConn: { query: vi.fn(), release: vi.fn() },
  mockEmail: { sendClassReminderEmail: vi.fn(), sendInstructorNotReadyAlert: vi.fn() },
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve(mockConn) }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://example.test', JWT_ACCESS_SECRET: 'x'.repeat(40) } }));
vi.mock('../services/EmailService.js', () => ({ emailService: mockEmail }));
const { mockGeocode } = vi.hoisted(() => ({ mockGeocode: vi.fn() }));
vi.mock('../services/GeocodeService.js', () => ({ geocodeVenue: mockGeocode }));

import { ClassReminderService, readyToken } from '../services/ClassReminderService.js';
import { classReminderRoutes } from '../routes/classReminders.js';
import { torontoWallTimeToMs } from '../utils/torontoDate.js';
import { distanceMeters } from '../utils/geo.js';

const flat = (sql: unknown) => String(sql).replace(/\s+/g, ' ');

describe('torontoWallTimeToMs', () => {
  it('uses UTC-4 in summer and UTC-5 in winter', () => {
    expect(new Date(torontoWallTimeToMs('2026-10-28', '09:00')).toISOString()).toBe('2026-10-28T13:00:00.000Z');
    expect(new Date(torontoWallTimeToMs('2026-12-01', '09:00')).toISOString()).toBe('2026-12-01T14:00:00.000Z');
  });
  it('handles the day clocks go back (Nov 1, 2026)', () => {
    expect(new Date(torontoWallTimeToMs('2026-11-01', '09:00')).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(new Date(torontoWallTimeToMs('2026-10-31', '23:00')).toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });
});

const baseClass = {
  id: 8, day: '2026-10-28', start_time: '09:00', location: 'markham',
  reminder_day_before_at: null, reminder_soon_at: null, instructor_ready_at: null, ready_alert_at: null,
  course_name: 'CPR Advanced', organization_name: 'Test Organization',
  instructor_email: 'inst@example.test', instructor_phone: '416-555-0100', instructor_name: 'Coujoe',
};

/** Class starts 9:00 Toronto = 13:00 UTC on Oct 28. */
const at = (iso: string) => new Date(`2026-10-${iso}Z`);

describe('ClassReminderService.run', () => {
  const sentColumns = () => mockQuery.mock.calls
    .map(([sql]) => /SET (\w+) = NOW\(\)/.exec(flat(sql))?.[1]).filter(Boolean);

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockConn.query.mockReset().mockResolvedValue([[{ got: 1 }]]);
    mockEmail.sendClassReminderEmail.mockReset().mockResolvedValue(true);
    mockEmail.sendInstructorNotReadyAlert.mockReset().mockResolvedValue(true);
  });

  const setup = (cls: Record<string, unknown>, admins: Array<{ email: string }> = [{ email: 'ca@example.test' }]) => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('FROM course_requests cr')) return [[{ ...baseClass, ...cls }]];
      if (s.includes('FROM users WHERE role')) return [admins];
      return [{ affectedRows: 1 }];
    });
  };

  it('sends nothing before the evening before', async () => {
    setup({});
    await new ClassReminderService().run(at('27T19:59:00')); // 3:59 pm Toronto
    expect(mockEmail.sendClassReminderEmail).not.toHaveBeenCalled();
  });

  it('sends the day-before reminder from 4 pm, once claimed', async () => {
    setup({});
    const r = await new ClassReminderService().run(at('27T20:05:00'));
    expect(r.sent).toBe(1);
    expect(mockEmail.sendClassReminderEmail).toHaveBeenCalledWith('inst@example.test', expect.objectContaining({ kind: 'day_before' }));
    expect(sentColumns()).toEqual(['reminder_day_before_at']);
  });

  it('does not repeat a reminder another worker already claimed', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('FROM course_requests cr')) return [[baseClass]];
      return [{ affectedRows: 0 }];
    });
    const r = await new ClassReminderService().run(at('27T20:05:00'));
    expect(r.sent).toBe(0);
    expect(mockEmail.sendClassReminderEmail).not.toHaveBeenCalled();
  });

  it('puts the mark back when the email fails, so the next run retries', async () => {
    setup({});
    mockEmail.sendClassReminderEmail.mockResolvedValue(false);
    const r = await new ClassReminderService().run(at('27T20:05:00'));
    expect(r.sent).toBe(0);
    expect(mockQuery.mock.calls.some(([sql]) => flat(sql).includes('SET reminder_day_before_at = NULL'))).toBe(true);
  });

  it('sends the 15-minute email with a signed ready link', async () => {
    setup({ reminder_day_before_at: new Date() });
    await new ClassReminderService().run(at('28T12:46:00')); // 14 min before
    const [, data] = mockEmail.sendClassReminderEmail.mock.calls[0];
    expect(data.kind).toBe('soon');
    expect(data.readyUrl).toBe(`https://example.test/ready/8/${readyToken(8)}`);
    expect(mockEmail.sendInstructorNotReadyAlert).not.toHaveBeenCalled();
  });

  it('alerts the course admin at 5 minutes if the instructor has not confirmed', async () => {
    setup({ reminder_day_before_at: new Date(), reminder_soon_at: new Date() });
    await new ClassReminderService().run(at('28T12:55:00'));
    expect(mockEmail.sendInstructorNotReadyAlert).toHaveBeenCalledWith('ca@example.test',
      expect.objectContaining({ instructorName: 'Coujoe', instructorPhone: '416-555-0100', minutesToStart: 5 }));
  });

  it('does not alert when the instructor has confirmed, or the alert already went', async () => {
    setup({ reminder_day_before_at: new Date(), reminder_soon_at: new Date(), instructor_ready_at: new Date() });
    await new ClassReminderService().run(at('28T12:55:00'));
    setup({ reminder_day_before_at: new Date(), reminder_soon_at: new Date(), ready_alert_at: new Date() });
    await new ClassReminderService().run(at('28T12:57:00'));
    expect(mockEmail.sendInstructorNotReadyAlert).not.toHaveBeenCalled();
  });

  it('sends no "tomorrow" email for a class that is today', async () => {
    setup({});
    await new ClassReminderService().run(at('28T12:00:00')); // 8 am, class at 9
    expect(mockEmail.sendClassReminderEmail).not.toHaveBeenCalled();
  });

  it('one row with an unreadable start time does not stop the others', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('FROM course_requests cr')) return [[{ ...baseClass, id: 7, start_time: 'noon' }, { ...baseClass, id: 8 }]];
      return [{ affectedRows: 1 }];
    });
    const r = await new ClassReminderService().run(at('27T20:05:00'));
    expect(r.sent).toBe(1);
  });

  it('only alerts while the instructor is still unconfirmed when the alert is claimed', async () => {
    setup({ reminder_day_before_at: new Date(), reminder_soon_at: new Date() });
    await new ClassReminderService().run(at('28T12:55:00'));
    const claim = mockQuery.mock.calls.map(([sql]) => flat(sql)).find((s) => s.includes('SET ready_alert_at = NOW()'));
    expect(claim).toContain('AND instructor_ready_at IS NULL');
  });

  it('falls back to admins when there is no course admin', async () => {
    let roles: string[] = [];
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = flat(sql);
      if (s.includes('FROM course_requests cr')) return [[{ ...baseClass, reminder_day_before_at: new Date(), reminder_soon_at: new Date() }]];
      if (s.includes('FROM users WHERE role')) { roles.push(String(params?.[0])); return [params?.[0] === 'admin' ? [{ email: 'a@example.test' }] : []]; }
      return [{ affectedRows: 1 }];
    });
    await new ClassReminderService().run(at('28T12:55:00'));
    expect(roles).toEqual(['courseadmin', 'admin']);
    expect(mockEmail.sendInstructorNotReadyAlert).toHaveBeenCalledWith('a@example.test', expect.anything());
    roles = [];
  });

  it('skips the run when another worker holds the lock', async () => {
    mockConn.query.mockResolvedValueOnce([[{ got: 0 }]]);
    setup({});
    const r = await new ClassReminderService().run(at('27T20:05:00'));
    expect(r.sent).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignores classes that started more than 30 minutes ago', async () => {
    setup({});
    await new ClassReminderService().run(at('28T13:40:00'));
    expect(mockEmail.sendInstructorNotReadyAlert).not.toHaveBeenCalled();
  });
});

describe('POST /class-reminders/ready', () => {
  beforeEach(() => {
    mockQuery.mockReset().mockImplementation(async (sql: string) =>
      flat(sql).startsWith('UPDATE') ? [{ affectedRows: 1 }] : [[{ course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }]]);
  });

  const post = async (payload: unknown) => {
    const app = Fastify();
    await app.register(classReminderRoutes);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/ready', payload: payload as object });
    await app.close();
    return res;
  };

  it('marks the instructor ready for a valid link', async () => {
    const res = await post({ classId: 8, token: readyToken(8) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ courseName: 'CPR Advanced', date: '2026-10-28', startTime: '09:00' });
    expect(mockQuery.mock.calls.some(([sql]) => flat(sql).includes('instructor_ready_at = COALESCE'))).toBe(true);
  });

  it('refuses a link signed for another class, or a bad body, without touching the database', async () => {
    expect((await post({ classId: 9, token: readyToken(8) })).statusCode).toBe(404);
    expect((await post({ classId: 8, token: 'nope' })).statusCode).toBe(404);
    expect((await post({})).statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('the check-in location record', () => {
  let located: number | null;
  beforeEach(() => {
    located = null;
    mockGeocode.mockReset();
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.startsWith('UPDATE')) return [{ affectedRows: 1 }];
      if (s.includes('SELECT location')) return [[{ location: '100 Main St, Markham', instructor_ready_located: located }]];
      return [[{ course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }]];
    });
  });
  const savedLocation = () => mockQuery.mock.calls.find(([sql]) => flat(sql).includes('instructor_ready_located = 1'));

  it('measures the distance in metres', () => {
    expect(distanceMeters(43.8561, -79.337, 43.8561, -79.337)).toBe(0);
    const d = distanceMeters(43.8561, -79.337, 43.8651, -79.337); // 0.009 degrees of latitude
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it('saves the distance and accuracy, never the coordinates', async () => {
    mockGeocode.mockResolvedValue({ lat: 43.8561, lng: -79.337 });
    await new ClassReminderService().confirmReady('8', readyToken(8), { lat: 43.8561, lng: -79.3375, accuracy: 18.4 });
    const [sql, params] = savedLocation()!;
    expect(flat(sql)).not.toMatch(/lat|lng/);
    expect(params[0]).toBe(18);
    expect(params[1]).toBeGreaterThan(30);
    expect(params[1]).toBeLessThan(60);
    expect(params).not.toContain(43.8561);
    expect(flat(sql)).toContain('AND instructor_ready_located IS NULL');
  });

  it('keeps the first tap location: a second tap from elsewhere changes nothing and looks nothing up', async () => {
    located = 1;
    const r = await new ClassReminderService().confirmReady('8', readyToken(8), { lat: 10, lng: 10 });
    expect(r).not.toBeNull();
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(savedLocation()).toBeUndefined();
  });

  it('still confirms, with no distance, when the venue address cannot be placed', async () => {
    mockGeocode.mockResolvedValue(null);
    const r = await new ClassReminderService().confirmReady('8', readyToken(8), { lat: 43.8, lng: -79.3 });
    expect(r).not.toBeNull();
    expect(savedLocation()![1][1]).toBeNull();
  });

  it('confirms without any lookup when no location was shared', async () => {
    const r = await new ClassReminderService().confirmReady('8', readyToken(8));
    expect(r).not.toBeNull();
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(savedLocation()).toBeUndefined();
  });

  it('a failure saving the location does not undo the confirmation', async () => {
    mockGeocode.mockResolvedValue({ lat: 43.8, lng: -79.3 });
    mockQuery.mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('instructor_ready_located = 1')) throw new Error('db down');
      if (s.startsWith('UPDATE')) return [{ affectedRows: 1 }];
      if (s.includes('SELECT location')) return [[{ location: '100 Main St', instructor_ready_located: null }]];
      return [[{ course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }]];
    });
    const r = await new ClassReminderService().confirmReady('8', readyToken(8), { lat: 43.8, lng: -79.3 });
    expect(r).not.toBeNull();
  });

  it('answers not-valid when the class is not confirmed (cancelled or completed)', async () => {
    mockQuery.mockImplementation(async () => [{ affectedRows: 0 }]);
    expect(await new ClassReminderService().confirmReady('8', readyToken(8))).toBeNull();
  });

  it('refuses an out-of-range position in the request body, touching nothing', async () => {
    const app = Fastify();
    await app.register(classReminderRoutes);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/ready', payload: { classId: 8, token: readyToken(8), location: { lat: 123, lng: 0 } } });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGeocode).not.toHaveBeenCalled();
  });
});
