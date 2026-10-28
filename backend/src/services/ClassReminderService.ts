import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { torontoToday, torontoWallTimeToMs } from '../utils/torontoDate.js';
import { distanceMeters } from '../utils/geo.js';
import { geocodeVenue, type VenuePoint } from './GeocodeService.js';
import { emailService } from './EmailService.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

/** The day-before reminder goes out from this Toronto hour on the evening before. */
export const DAY_BEFORE_HOUR = 16;
/** The "starting soon" email, with the I'm-ready link, goes out this long before the start. */
export const SOON_MINUTES = 15;
/** The course admin is alerted this long before the start if the instructor has not confirmed. */
export const ALERT_MINUTES_BEFORE_START = 5;

const RUN_LOCK = 'cpr_class_reminders';
const MINUTE = 60_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** How close an instructor must be to check in, if the system setting is missing. */
export const DEFAULT_CHECKIN_RADIUS_METERS = 300;
/** Check-in opens this long before the start, so someone at the venue the day before cannot silence the alert. */
export const CHECKIN_OPENS_MINUTES = 60;
const NOT_FOUND_HOLD = 5 * MINUTE;
const venueCache = new Map<string, { point: VenuePoint | null; until: number }>();

/** For tests: forget every remembered venue. */
export function resetVenueCache(): void {
  venueCache.clear();
}

export type ReadyOutcome =
  | { ok: true; courseName: string; date: string; startTime: string; readyAt: string; distance: number | null }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'location_required' }
  | { ok: false; reason: 'venue_unknown' }
  | { ok: false; reason: 'too_early'; opensMinutes: number }
  | { ok: false; reason: 'imprecise'; radius: number }
  | { ok: false; reason: 'too_far'; distance: number; radius: number };

/** The check-in radius in metres: the sysadmin's setting (System Configuration), else 300. */
export async function checkInRadius(): Promise<number> {
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT config_value FROM system_configurations WHERE config_key = 'checkin_radius_meters'`);
    const n = Number(rows[0]?.config_value);
    if (Number.isFinite(n) && n >= 25 && n <= 50_000) return Math.round(n);
  } catch { /* table or row missing: use the default */ }
  return DEFAULT_CHECKIN_RADIUS_METERS;
}

type ReminderColumn = 'reminder_day_before_at' | 'reminder_soon_at' | 'ready_alert_at';

/** Signs a class id so the link in the email proves who it was meant for, without a sign-in. */
export function readyToken(classId: number | string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`class-ready:${classId}`).digest('hex').slice(0, 32);
}

function tokenMatches(classId: number | string, token: string): boolean {
  const a = Buffer.from(readyToken(classId));
  const b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
}

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const CLASS_SQL = `
  SELECT cr.id, DATE_FORMAT(cr.confirmed_date, '%Y-%m-%d') AS day,
         TIME_FORMAT(cr.confirmed_start_time, '%H:%i') AS start_time,
         cr.location, cr.reminder_day_before_at, cr.reminder_soon_at, cr.instructor_ready_at, cr.ready_alert_at,
         ct.name AS course_name, COALESCE(o.name, 'Unassigned') AS organization_name,
         u.email AS instructor_email, COALESCE(u.mobile, u.phone) AS instructor_phone,
         COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username) AS instructor_name
  FROM course_requests cr
  JOIN class_types ct ON ct.id = cr.course_type_id
  JOIN users u ON u.id = cr.instructor_id
  LEFT JOIN organizations o ON o.id = cr.organization_id
  WHERE cr.status = 'confirmed' AND cr.instructor_id IS NOT NULL
    AND cr.confirmed_start_time IS NOT NULL AND cr.deleted_at IS NULL AND u.status = 'active'
    AND DATE(cr.confirmed_date) BETWEEN ? AND ?`;

export class ClassReminderService {
  /**
   * Sends whichever reminders are due. Run every few minutes; safe from several workers
   * at once (a named lock, and each reminder is claimed in the database before it is sent).
   */
  async run(now: Date = new Date()): Promise<{ sent: number }> {
    const pool = getPool();
    const lockConn = await pool.getConnection();
    let sent = 0;
    try {
      const [lock] = await lockConn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [RUN_LOCK]);
      if (Number(lock[0]?.got) !== 1) return { sent };

      const today = torontoToday(now);
      const [classes] = await pool.query<RowDataPacket[]>(CLASS_SQL, [today, addDays(today, 2)]);

      for (const c of classes) {
        // One bad row (free-text start time) must not stop everyone else's reminders
        try {
          sent += await this.remindAbout(c, now);
        } catch (err) {
          logger.error({ err, classId: c.id }, 'Class reminder check failed');
        }
      }
    } finally {
      try { await lockConn.query('SELECT RELEASE_LOCK(?)', [RUN_LOCK]); } catch { /* ignore */ }
      lockConn.release();
    }
    return { sent };
  }

  private async remindAbout(c: RowDataPacket, now: Date): Promise<number> {
    if (!c.start_time) return 0;
    let sent = 0;
    const startMs = torontoWallTimeToMs(c.day, c.start_time);
    const minutes = Math.round((startMs - now.getTime()) / MINUTE);
    if (minutes < -30) return 0; // too late to be useful

    const eveningMs = torontoWallTimeToMs(addDays(c.day, -1), `${String(DAY_BEFORE_HOUR).padStart(2, '0')}:00`);
    // Only on an earlier Toronto day: a class booked this morning gets no "tomorrow" email
    if (now.getTime() >= eveningMs && torontoToday(now) < c.day && minutes > SOON_MINUTES && !c.reminder_day_before_at) {
      if (await this.claimAndSend(c.id, 'reminder_day_before_at', () => this.sendInstructor(c, 'day_before'))) sent++;
    }
    if (minutes <= SOON_MINUTES && minutes > 0 && !c.reminder_soon_at) {
      if (await this.claimAndSend(c.id, 'reminder_soon_at', () => this.sendInstructor(c, 'soon'))) sent++;
    }
    if (minutes <= ALERT_MINUTES_BEFORE_START && !c.instructor_ready_at && !c.ready_alert_at) {
      if (await this.claimAndSend(c.id, 'ready_alert_at', () => this.alertAdmins(c, minutes))) sent++;
    }
    return sent;
  }

  /** Marks the reminder as sent first, so no second worker repeats it; puts the mark back if it did not go out. */
  private async claimAndSend(classId: number, column: ReminderColumn, send: () => Promise<boolean>): Promise<boolean> {
    const pool = getPool();
    const [claim] = await pool.query<ResultSetHeader>(
      `UPDATE course_requests SET ${column} = NOW() WHERE id = ? AND ${column} IS NULL
       ${column === 'ready_alert_at' ? 'AND instructor_ready_at IS NULL' : ''}`, [classId]);
    if (!claim.affectedRows) return false;
    let ok = false;
    try {
      ok = await send();
    } catch (err) {
      logger.error({ err, classId, column }, 'Class reminder failed');
    }
    if (!ok) await pool.query(`UPDATE course_requests SET ${column} = NULL WHERE id = ?`, [classId]);
    return ok;
  }

  private sendInstructor(c: RowDataPacket, kind: 'day_before' | 'soon'): Promise<boolean> {
    if (!c.instructor_email) return Promise.resolve(false);
    return emailService.sendClassReminderEmail(c.instructor_email, {
      kind, instructorName: c.instructor_name, courseName: c.course_name, organizationName: c.organization_name,
      date: c.day, startTime: c.start_time, location: c.location ?? '',
      readyUrl: kind === 'soon' ? `${env.FRONTEND_URL}/ready/${c.id}/${readyToken(c.id)}` : undefined,
    });
  }

  private async alertAdmins(c: RowDataPacket, minutesToStart: number): Promise<boolean> {
    const pool = getPool();
    const find = async (role: string) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT DISTINCT email FROM users WHERE role = ? AND status = 'active' AND email IS NOT NULL AND email != ''`, [role]);
      return rows;
    };
    let admins = await find('courseadmin');
    if (!admins.length) admins = await find('admin');
    if (!admins.length) {
      logger.warn({ classId: c.id }, 'Instructor not confirmed, but there is no course admin to alert');
      return false;
    }
    const results = await Promise.all(admins.map((a) => emailService.sendInstructorNotReadyAlert(a.email, {
      instructorName: c.instructor_name, instructorPhone: c.instructor_phone, courseName: c.course_name,
      organizationName: c.organization_name, date: c.day, startTime: c.start_time, location: c.location ?? '', minutesToStart,
    })));
    return results.some(Boolean);
  }

  /** The instructor taps "I'm ready" in the email link: the signed link proves which class it is for. */
  async confirmReady(
    classId: string, token: string, where?: { lat: number; lng: number; accuracy?: number },
  ): Promise<ReadyOutcome> {
    if (!/^\d+$/.test(classId) || !tokenMatches(classId, token)) return { ok: false, reason: 'invalid' };
    return this.checkIn(classId, where);
  }

  /** A signed-in instructor checks in to one of their own classes. Anyone else's class answers "invalid". */
  async checkInOwn(
    classId: string, instructorId: number, where?: { lat: number; lng: number; accuracy?: number },
  ): Promise<ReadyOutcome> {
    return this.checkIn(classId, where, instructorId);
  }

  /**
   * Checks an instructor in as ready. It is accepted only when their phone shares a precise
   * location within the check-in radius of the class address. An unknown class (or, when
   * `instructorId` is given, one that is not theirs) gets the same answer as a bad link. The
   * distance and accuracy are kept, not the coordinates. Callers go through `confirmReady`
   * (signed link) or `checkInOwn` (signed in), so who is allowed is always decided first.
   */
  private async checkIn(
    classId: string, where?: { lat: number; lng: number; accuracy?: number }, instructorId?: number,
  ): Promise<ReadyOutcome> {
    const pool = getPool();
    const [classRows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.location, cr.instructor_ready_at, cr.instructor_ready_distance_m, ct.name AS course_name, DATE_FORMAT(cr.confirmed_date, '%Y-%m-%d') AS day,
              TIME_FORMAT(cr.confirmed_start_time, '%H:%i') AS start_time
       FROM course_requests cr JOIN class_types ct ON ct.id = cr.course_type_id
       WHERE cr.id = ? AND cr.status = 'confirmed'${instructorId === undefined ? '' : ' AND cr.instructor_id = ?'}`,
      instructorId === undefined ? [classId] : [classId, instructorId]);
    const c = classRows[0];
    if (!c) return { ok: false, reason: 'invalid' };
    const base = { ok: true, courseName: c.course_name, date: c.day, startTime: c.start_time } as const;

    // Already checked in: reopening the link or screen from somewhere else must not turn that into a
    // refusal, and shows the original time and distance
    if (c.instructor_ready_at) {
      return {
        ...base, readyAt: new Date(c.instructor_ready_at).toISOString(),
        distance: c.instructor_ready_distance_m == null ? null : Number(c.instructor_ready_distance_m),
      };
    }
    if (c.start_time && torontoWallTimeToMs(c.day, c.start_time) - Date.now() > CHECKIN_OPENS_MINUTES * MINUTE) {
      return { ok: false, reason: 'too_early', opensMinutes: CHECKIN_OPENS_MINUTES };
    }

    if (!where) return { ok: false, reason: 'location_required' };
    const radius = await checkInRadius();
    // A reading that could be off by more than the radius says nothing about where the phone is
    if (where.accuracy == null || where.accuracy > radius) return { ok: false, reason: 'imprecise', radius };

    const point = await this.venuePoint(String(c.location ?? ''));
    if (!point) return { ok: false, reason: 'venue_unknown' };
    const distance = distanceMeters(where.lat, where.lng, point.lat, point.lng);
    if (distance > radius) return { ok: false, reason: 'too_far', distance, radius };

    await pool.query(
      `UPDATE course_requests SET instructor_ready_at = COALESCE(instructor_ready_at, NOW()),
         instructor_ready_accuracy_m = COALESCE(instructor_ready_accuracy_m, ?),
         instructor_ready_distance_m = COALESCE(instructor_ready_distance_m, ?)
       WHERE id = ?`, [Math.round(where.accuracy), distance, classId]);
    return { ...base, readyAt: new Date().toISOString(), distance };
  }

  /** The class address as a map point. Remembered (an hour; 5 minutes if not found) so repeated taps do not repeat the lookup. */
  private async venuePoint(address: string): Promise<VenuePoint | null> {
    const key = address.trim().toLowerCase();
    const hit = venueCache.get(key);
    if (hit && hit.until > Date.now()) return hit.point;
    const point = await geocodeVenue(address);
    if (venueCache.size >= 500) venueCache.clear();
    // A failed lookup is remembered briefly too, so taps do not keep hitting the address service
    venueCache.set(key, { point, until: Date.now() + (point ? HOUR : NOT_FOUND_HOLD) });
    return point;
  }
}

const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** What an instructor is told when the check-in is not accepted. */
export function readyRefusalMessage(r: Exclude<ReadyOutcome, { ok: true } | { reason: 'invalid' }>): string {
  switch (r.reason) {
    case 'location_required':
      return 'Location is needed to check in. Allow location access for this page, then tap the button again.';
    case 'imprecise':
      return "Your phone's location is not precise enough to check you in. Turn on GPS (precise location), move outside if you can, and try again.";
    case 'venue_unknown':
      return 'We could not find the class address on the map, so we cannot check you in automatically. Please call the course admin.';
    case 'too_early':
      return `Check-in opens ${r.opensMinutes} minutes before the class starts. Please tap the button again closer to the start time.`;
    case 'too_far':
      return `You are about ${metres(r.distance)} from the venue. You can check in once you are within ${metres(r.radius)}.`;
  }
}
