import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// A signed-in instructor checks in for their own class from the app, with the same rules as the
// email link: a precise location within the radius of the class address.
const { mockQuery, mockGeocode } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockGeocode: vi.fn() }));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve({}) }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://example.test', JWT_ACCESS_SECRET: 'x'.repeat(40) } }));
vi.mock('../services/CertReminderService.js', () => ({ CertReminderService: class {} }));
vi.mock('../services/EmailService.js', () => ({ emailService: {} }));
vi.mock('../services/GeocodeService.js', () => ({ geocodeVenue: mockGeocode }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId?: number; userRole?: string }) => {
    request.userId = 4;
    request.userRole = 'instructor';
  },
}));

import { instructorRoutes } from '../routes/instructors.js';
import { resetVenueCache } from '../services/ClassReminderService.js';

const flat = (sql: unknown) => String(sql).replace(/\s+/g, ' ');
const AT_VENUE = { lat: 43.8677, lng: -79.2171, accuracy: 12 };

describe('POST /classes/:classId/ready (signed-in check-in)', () => {
  let app: FastifyInstance;
  let classRows: unknown[];

  beforeEach(async () => {
    resetVenueCache();
    classRows = [{ location: 'App Venue 1', course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00' }];
    mockGeocode.mockReset().mockResolvedValue({ lat: 43.8677, lng: -79.2171 });
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      const s = flat(sql);
      if (s.includes('FROM system_configurations')) return [[]];
      if (s.includes('FROM course_requests cr JOIN class_types')) return [classRows];
      return [{ affectedRows: 1 }];
    });
    app = Fastify();
    await app.register(instructorRoutes);
    await app.ready();
  });
  afterEach(() => app.close());

  const post = (payload: unknown, classId = '12') =>
    app.inject({ method: 'POST', url: `/classes/${classId}/ready`, payload: payload as object });
  const classLookup = () => mockQuery.mock.calls.find(([sql]) => flat(sql).includes('FROM course_requests cr JOIN class_types'))!;

  it('checks the instructor in at the venue, and only looks for their own class', async () => {
    const res = await post({ location: AT_VENUE });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ courseName: 'CPR Advanced', startTime: '09:00', distanceMeters: 0 });
    const [sql, params] = classLookup();
    expect(flat(sql)).toContain('AND cr.instructor_id = ?');
    expect(params).toEqual(['12', 4]);
  });

  it('says not found for a class that is not theirs, without looking anything up', async () => {
    classRows = []; // the instructor_id condition matched nothing
    const res = await post({ location: AT_VENUE });
    expect(res.statusCode).toBe(404);
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it('asks for the location when none is sent', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('location_required');
  });

  it('refuses when the instructor is too far away, saying how far', async () => {
    const res = await post({ location: { lat: 43.8677 + 0.01, lng: -79.2171, accuracy: 10 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('too_far');
    expect(res.json().error).toMatch(/about 1\.1 km from the venue.*within 300 m/);
  });

  it('refuses an imprecise reading', async () => {
    const res = await post({ location: { ...AT_VENUE, accuracy: 4000 } });
    expect(res.json().code).toBe('imprecise');
  });

  it('refuses an out-of-range position or a non-numeric class id, touching nothing', async () => {
    expect((await post({ location: { lat: 123, lng: 0 } })).statusCode).toBe(400);
    expect((await post({ location: AT_VENUE }, 'abc')).statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('records the distance and accuracy at the check-in, never the coordinates', async () => {
    await post({ location: AT_VENUE });
    const save = mockQuery.mock.calls.find(([sql]) => flat(sql).includes('SET instructor_ready_at'))!;
    expect(flat(save[0])).not.toMatch(/lat|lng/);
    expect(save[1]).toEqual([12, 0, '12']);
  });

  it('refuses before check-in opens, saying so', async () => {
    classRows = [{ location: 'App Venue 1', course_name: 'CPR Advanced', day: '2099-01-01', start_time: '09:00' }];
    const res = await post({ location: AT_VENUE });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('too_early');
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it('returns when and how far they originally checked in if they are already checked in', async () => {
    classRows = [{
      location: 'App Venue 1', course_name: 'CPR Advanced', day: '2026-10-28', start_time: '09:00',
      instructor_ready_at: new Date('2026-10-28T12:45:00Z'), instructor_ready_distance_m: 9,
    }];
    const res = await post({}); // no location needed
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ readyAt: '2026-10-28T12:45:00.000Z', distanceMeters: 9 });
    expect(mockQuery.mock.calls.some(([sql]) => flat(sql).includes('SET instructor_ready_at'))).toBe(false);
  });

  it('returns the time the server recorded on a new check-in', async () => {
    const res = await post({ location: AT_VENUE });
    expect(new Date(res.json().data.readyAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
