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

import { ClassReminderService, checkInRadius, readyToken, resetVenueCache } from '../services/ClassReminderService.js';
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

describe('check-in: only accepted at the venue, with the location shared', () => {
  const VENUE = { lat: 43.8561, lng: -79.337 };
  /** About 45 m west of the venue. */
  const NEAR = { lat: 43.8561, lng: -79.3375, accuracy: 18.4 };
  let radiusSetting: string | undefined;
  let classRows: unknown[];

  beforeEach(() => {
    resetVenueCache();
    radiusSetting = undefined;
    classRows = [{ location: '100 Main St, Markham', course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }];
    mockGeocode.mockReset().mockResolvedValue(VENUE);
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('FROM system_configurations')) return [radiusSetting === undefined ? [] : [{ config_value: radiusSetting }]];
      if (s.includes('FROM course_requests cr JOIN class_types')) return [classRows];
      return [{ affectedRows: 1 }];
    });
  });
  const saved = () => mockQuery.mock.calls.find(([sql]) => flat(sql).includes('SET instructor_ready_at'));
  const confirm = (where?: { lat: number; lng: number; accuracy?: number }, id = 8, token = readyToken(8)) =>
    new ClassReminderService().confirmReady(String(id), token, where);

  it('measures the distance in metres', () => {
    expect(distanceMeters(43.8561, -79.337, 43.8561, -79.337)).toBe(0);
    const d = distanceMeters(43.8561, -79.337, 43.8651, -79.337); // 0.009 degrees of latitude
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it('accepts a phone at the venue and keeps the distance and accuracy, never the coordinates', async () => {
    const r = await confirm(NEAR);
    expect(r).toEqual({ ok: true, courseName: 'CPR Advanced', date: '2026-10-28', startTime: '09:00' });
    const [sql, params] = saved()!;
    expect(flat(sql)).not.toMatch(/lat|lng/);
    expect(params[0]).toBe(18);
    expect(params[1]).toBeGreaterThan(30);
    expect(params[1]).toBeLessThan(70);
    expect(params).not.toContain(NEAR.lat);
  });

  it('refuses without a location, and does not look the venue up', async () => {
    expect(await confirm(undefined)).toEqual({ ok: false, reason: 'location_required' });
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(saved()).toBeUndefined();
  });

  it('refuses a phone that is outside the radius, saying how far', async () => {
    const r = await confirm({ lat: 43.8651, lng: -79.337, accuracy: 20 }); // about 1 km north
    expect(r).toMatchObject({ ok: false, reason: 'too_far', radius: 300 });
    expect((r as { distance: number }).distance).toBeGreaterThan(900);
    expect(saved()).toBeUndefined();
  });

  it('refuses a reading too imprecise to trust (or with no accuracy)', async () => {
    expect(await confirm({ ...NEAR, accuracy: 4000 })).toEqual({ ok: false, reason: 'imprecise', radius: 300 });
    expect(await confirm({ lat: NEAR.lat, lng: NEAR.lng })).toEqual({ ok: false, reason: 'imprecise', radius: 300 });
    expect(saved()).toBeUndefined();
  });

  it('refuses, and says to call, when the class address cannot be placed on the map', async () => {
    mockGeocode.mockResolvedValue(null);
    expect(await confirm(NEAR)).toEqual({ ok: false, reason: 'venue_unknown' });
    expect(saved()).toBeUndefined();
  });

  it('uses the radius set in System Configuration', async () => {
    const lat = 43.8561 + 0.0027; // about 300 m north
    radiusSetting = '500';
    expect((await confirm({ lat, lng: VENUE.lng, accuracy: 20 })).ok).toBe(true);
    radiusSetting = '150';
    expect(await confirm({ lat, lng: VENUE.lng, accuracy: 20 })).toMatchObject({ ok: false, reason: 'too_far', radius: 150 });
  });

  it('falls back to 300 m when the setting is missing or nonsense', async () => {
    for (const bad of [undefined, 'abc', '0', '-5', '999999']) {
      radiusSetting = bad;
      expect(await confirm({ lat: 43.8651, lng: -79.337, accuracy: 20 })).toMatchObject({ reason: 'too_far', radius: 300 });
    }
  });

  it('a wrong link, an unknown class or a class that is not confirmed gets the same answer, with nothing looked up', async () => {
    expect(await confirm(NEAR, 9, readyToken(8))).toEqual({ ok: false, reason: 'invalid' });
    expect(await confirm(NEAR, 8, 'nope')).toEqual({ ok: false, reason: 'invalid' });
    classRows = []; // cancelled, completed, or not there
    expect(await confirm(NEAR)).toEqual({ ok: false, reason: 'invalid' });
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(saved()).toBeUndefined();
  });

  it('remembers the venue for an hour, so repeated taps do not repeat the address lookup', async () => {
    await confirm(NEAR);
    await confirm(NEAR);
    expect(mockGeocode).toHaveBeenCalledTimes(1);
  });

  it('also remembers, briefly, an address that could not be found', async () => {
    mockGeocode.mockResolvedValue(null);
    await confirm(NEAR);
    await confirm(NEAR);
    expect(mockGeocode).toHaveBeenCalledTimes(1);
  });

  it('is not open until an hour before the start, and not looked up before then', async () => {
    classRows = [{ location: 'Far Future 1', course_name: 'CPR Advanced', day: '2099-01-01', start_time: '09:00' }];
    expect(await confirm(NEAR)).toEqual({ ok: false, reason: 'too_early', opensMinutes: 60 });
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(saved()).toBeUndefined();
  });

  it('opens an hour before the start', async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(soon);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    classRows = [{ location: 'Soon Venue 2', course_name: 'CPR Advanced', day: `${get('year')}-${get('month')}-${get('day')}`, start_time: `${get('hour')}:${get('minute')}` }];
    expect((await confirm(NEAR)).ok).toBe(true);
  });

  it('an instructor who already checked in is not refused when reopening the link from elsewhere', async () => {
    classRows = [{ location: 'Anywhere', instructor_ready_at: new Date(), course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }];
    const r = await confirm({ lat: 10, lng: 10, accuracy: 10 });
    expect(r.ok).toBe(true);
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(saved()).toBeUndefined();
  });

  it('the radius still defaults to 300 m when reading the setting fails', async () => {
    mockQuery.mockImplementation(async () => { throw new Error('db down'); });
    expect(await checkInRadius()).toBe(300);
  });
});

describe('POST /class-reminders/ready', () => {
  const VENUE = { lat: 43.8561, lng: -79.337 };
  beforeEach(() => {
    resetVenueCache();
    mockGeocode.mockReset().mockResolvedValue(VENUE);
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('FROM system_configurations')) return [[]];
      if (s.includes('FROM course_requests cr JOIN class_types')) return [[{ location: 'Route Venue 1', course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }]];
      return [{ affectedRows: 1 }];
    });
  });

  const post = async (payload: unknown) => {
    const app = Fastify();
    await app.register(classReminderRoutes);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/ready', payload: payload as object });
    await app.close();
    return res;
  };

  it('checks the instructor in at the venue', async () => {
    const res = await post({ classId: 8, token: readyToken(8), location: { lat: 43.8561, lng: -79.3375, accuracy: 15 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ courseName: 'CPR Advanced', date: '2026-10-28', startTime: '09:00' });
  });

  it('answers 422 with a plain message when the instructor is too far away', async () => {
    const res = await post({ classId: 8, token: readyToken(8), location: { lat: 43.8651, lng: -79.337, accuracy: 15 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('too_far');
    expect(res.json().error).toMatch(/about 1\.\d km from the venue.*within 300 m/);
  });

  it('says what to do when the phone is too imprecise, the venue is unknown, or it is too early', async () => {
    const imprecise = await post({ classId: 8, token: readyToken(8), location: { lat: 43.8561, lng: -79.337, accuracy: 5000 } });
    expect(imprecise.statusCode).toBe(422);
    expect(imprecise.json().code).toBe('imprecise');
    expect(imprecise.json().error).toMatch(/not precise enough/);

    resetVenueCache();
    mockGeocode.mockResolvedValue(null);
    const unknown = await post({ classId: 8, token: readyToken(8), location: { lat: 43.8561, lng: -79.337, accuracy: 15 } });
    expect(unknown.json().code).toBe('venue_unknown');
    expect(unknown.json().error).toMatch(/call the course admin/);

    mockQuery.mockImplementation(async (sql: string) =>
      flat(sql).includes('FROM course_requests cr JOIN class_types')
        ? [[{ location: 'Far Future 3', course_name: 'CPR Advanced', day: '2099-01-01', start_time: '09:00' }]]
        : [[]]);
    const early = await post({ classId: 8, token: readyToken(8), location: { lat: 43.8561, lng: -79.337, accuracy: 15 } });
    expect(early.json().code).toBe('too_early');
    expect(early.json().error).toMatch(/opens 60 minutes before/);
  });

  it('answers 422 asking for the location when none is sent', async () => {
    const res = await post({ classId: 8, token: readyToken(8) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('location_required');
    expect(res.json().error).toMatch(/Location is needed/);
  });

  it('refuses a link signed for another class, or a bad body, with a 404 and no database use', async () => {
    mockQuery.mockClear();
    expect((await post({ classId: 9, token: readyToken(8) })).statusCode).toBe(404);
    expect((await post({ classId: 8, token: 'nope' })).statusCode).toBe(404);
    expect((await post({})).statusCode).toBe(404);
    expect((await post({ classId: 8, token: readyToken(8), location: { lat: 123, lng: 0 } })).statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGeocode).not.toHaveBeenCalled();
  });
});
