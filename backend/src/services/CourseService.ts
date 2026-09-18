import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { CourseRequestRepository, CourseRequest, CourseWithDetails } from '../repositories/CourseRequestRepository.js';
import { CourseStudentRepository, CourseStudent } from '../repositories/CourseStudentRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { emailService } from './EmailService.js';
import type { RowDataPacket } from 'mysql2/promise';

// --- Error types ---

export class CourseError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'CourseError';
  }
}

// --- Types ---

export interface CreateCourseRequestInput {
  organizationId: number;
  courseTypeId: number;
  scheduledDate: string;
  location: string;
  locationId?: number;
  registeredStudents: number;
  notes?: string;
}

export interface AssignInstructorInput {
  courseId: number;
  instructorId: number;
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
}

export interface RescheduleInput {
  courseId: number;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  instructorId?: number;
}

export interface BillingValidation {
  isValid: boolean;
  courseId: number;
  organizationName: string;
  courseTypeName: string;
  studentsAttended: number;
  pricePerStudent: number | null;
  estimatedAmount: number;
  errors: string[];
  warnings: string[];
}

// --- Service ---

export class CourseService {
  constructor(
    private courseRepo: CourseRequestRepository,
    private studentRepo: CourseStudentRepository,
    private userRepo: UserRepository,
  ) {}

  // --- Helpers ---

  private async getOrgAdminEmails(organizationId: number): Promise<string[]> {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT email FROM users
       WHERE organization_id = ? AND role IN ('org_admin', 'organization') AND status = 'active' AND email IS NOT NULL`,
      [organizationId]
    );
    return rows.map((r) => r.email).filter(Boolean);
  }

  private async shouldSendEmail(userId: number, notificationType: string): Promise<boolean> {
    try {
      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT email_enabled FROM notification_preferences WHERE user_id = ? AND notification_type = ?',
        [userId, notificationType]
      );
      // If no preference row exists, send by default
      if (rows.length === 0) return true;
      return rows[0].email_enabled !== false;
    } catch {
      // If table doesn't exist or query fails, send by default
      return true;
    }
  }

  private async getOrgAdminEmailsWithPreference(organizationId: number, notificationType: string): Promise<string[]> {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM users
       WHERE organization_id = ? AND role IN ('org_admin', 'organization') AND status = 'active' AND email IS NOT NULL`,
      [organizationId]
    );

    const emails: string[] = [];
    for (const row of rows) {
      const shouldSend = await this.shouldSendEmail(row.id, notificationType);
      if (shouldSend) emails.push(row.email);
    }
    return emails;
  }

  private async getCourseDetails(courseId: number): Promise<{ courseName: string; date: string; location: string; organizationId: number }> {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.organization_id, cr.location,
              COALESCE(cr.confirmed_date, cr.scheduled_date) as course_date,
              ct.name as course_name
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       WHERE cr.id = ?`,
      [courseId]
    );
    const row = rows[0];
    return {
      courseName: row?.course_name ?? 'Unknown Course',
      date: row?.course_date ? new Date(row.course_date).toISOString().split('T')[0] : '',
      location: row?.location ?? '',
      organizationId: row?.organization_id,
    };
  }

  // --- Course request creation (org users) ---

  async createRequest(input: CreateCourseRequestInput): Promise<CourseRequest> {
    // Check for duplicates
    const existing = await this.courseRepo.forOrg(input.organizationId)
      .findDuplicate(input.organizationId, input.location, input.scheduledDate);

    if (existing) {
      throw new CourseError(
        `You already have a course request for this location on this date (Status: ${existing.status}). Please choose a different date or location.`
      );
    }

    const id = await this.courseRepo.forOrg(input.organizationId).create({
      organization_id: input.organizationId,
      course_type_id: input.courseTypeId,
      scheduled_date: new Date(input.scheduledDate),
      location: input.location,
      location_id: input.locationId ?? null,
      registered_students: input.registeredStudents,
      notes: input.notes ?? null,
      status: 'pending',
    } as Partial<CourseRequest>);

    const course = await this.courseRepo.findById(id);
    if (!course) throw new CourseError('Failed to create course request', 500);

    logger.info({ courseId: id, orgId: input.organizationId }, 'Course request created');
    return course;
  }

  // --- Course listing (admin) ---

  async getPending(): Promise<CourseWithDetails[]> {
    return this.courseRepo.findPending();
  }

  async getConfirmed(): Promise<CourseWithDetails[]> {
    return this.courseRepo.findConfirmed();
  }

  async getCompleted(): Promise<CourseWithDetails[]> {
    return this.courseRepo.findCompleted();
  }

  async getCancelled(): Promise<CourseWithDetails[]> {
    return this.courseRepo.findCancelled();
  }

  // --- Assign instructor (admin) ---

  async assignInstructor(input: AssignInstructorInput): Promise<CourseRequest> {
    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Verify course exists and get scheduled date
      const [courseRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM course_requests WHERE id = ? AND deleted_at IS NULL',
        [input.courseId]
      );
      if (courseRows.length === 0) throw new CourseError('Course request not found', 404);

      const course = courseRows[0];
      if (!course.scheduled_date) {
        throw new CourseError('Course must have a scheduled date before assigning instructor');
      }

      const dateStr = new Date(course.scheduled_date).toISOString().split('T')[0];
      const startTimeFormatted = `${input.startTime}:00`;
      const endTimeFormatted = `${input.endTime}:00`;

      // Check instructor availability (no overlapping assignments)
      const [conflicts] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM course_requests
         WHERE instructor_id = ? AND confirmed_date = ? AND status = 'confirmed'
         AND id != ?
         AND (
           (confirmed_start_time <= ? AND confirmed_end_time > ?)
           OR (confirmed_start_time < ? AND confirmed_end_time >= ?)
           OR (confirmed_start_time >= ? AND confirmed_end_time <= ?)
         )`,
        [input.instructorId, course.scheduled_date, input.courseId,
         startTimeFormatted, startTimeFormatted,
         endTimeFormatted, endTimeFormatted,
         startTimeFormatted, endTimeFormatted]
      );

      if (conflicts.length > 0) {
        throw new CourseError('Instructor is already assigned to another course during this time slot');
      }

      // Verify instructor exists
      const instructor = await this.userRepo.findById(input.instructorId);
      if (!instructor) throw new CourseError('Instructor not found', 404);

      // Update course request → confirmed
      await conn.query(
        `UPDATE course_requests
         SET instructor_id = ?, status = 'confirmed',
             confirmed_date = ?, confirmed_start_time = ?, confirmed_end_time = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [input.instructorId, course.scheduled_date, startTimeFormatted, endTimeFormatted, input.courseId]
      );

      // Remove instructor availability for that date
      await conn.query(
        'DELETE FROM instructor_availability WHERE instructor_id = ? AND date = ?',
        [input.instructorId, dateStr]
      );

      // Create class entry
      await conn.query(
        `INSERT INTO classes (instructor_id, class_type_id, organization_id,
         start_time, end_time, location, max_students, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [input.instructorId, course.course_type_id, course.organization_id,
         `${dateStr}T${input.startTime}:00`, `${dateStr}T${input.endTime}:00`,
         course.location, course.registered_students]
      );

      await conn.commit();

      const updated = await this.courseRepo.findById(input.courseId);
      logger.info({ courseId: input.courseId, instructorId: input.instructorId }, 'Instructor assigned');

      // Fire-and-forget: send course confirmed email to org admins
      this.getCourseDetails(input.courseId).then(async (details) => {
        const emails = await this.getOrgAdminEmailsWithPreference(course.organization_id, 'course_status_change');
        for (const email of emails) {
          emailService.sendCourseConfirmedEmail(email, {
            courseName: details.courseName,
            date: details.date,
            location: details.location,
            instructorName: instructor.username ?? instructor.full_name ?? 'TBD',
            startTime: input.startTime,
            endTime: input.endTime,
          }).catch(err => logger.error({ err, courseId: input.courseId }, 'Failed to send course confirmed email'));
        }
      }).catch(err => logger.error({ err, courseId: input.courseId }, 'Failed to send course confirmed notifications'));

      return updated!;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // --- Cancel course (admin) ---

  async cancel(courseId: number, reason: string): Promise<CourseRequest> {
    if (!reason?.trim()) throw new CourseError('Cancellation reason is required');

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [courseRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM course_requests WHERE id = ? AND deleted_at IS NULL',
        [courseId]
      );
      if (courseRows.length === 0) throw new CourseError('Course request not found', 404);

      const course = courseRows[0];

      // Cancel the course
      await conn.query(
        `UPDATE course_requests
         SET status = 'cancelled', is_cancelled = 1, cancelled_at = CURRENT_TIMESTAMP,
             cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reason, courseId]
      );

      // Restore instructor availability if assigned
      if (course.instructor_id && course.confirmed_date) {
        const dateStr = new Date(course.confirmed_date).toISOString().split('T')[0];

        await conn.query(
          'DELETE FROM classes WHERE instructor_id = ? AND DATE(start_time) = ?',
          [course.instructor_id, dateStr]
        );

        await conn.query(
          `INSERT INTO instructor_availability (instructor_id, date, status)
           VALUES (?, ?, 'available')
           ON DUPLICATE KEY UPDATE status = 'available'`,
          [course.instructor_id, dateStr]
        );
      }

      // Void outstanding invoices
      await conn.query(
        `UPDATE invoices SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE course_request_id = ? AND status IN ('pending', 'overdue') AND deleted_at IS NULL`,
        [courseId]
      );

      await conn.commit();

      const updated = await this.courseRepo.findById(courseId);
      logger.info({ courseId, reason }, 'Course cancelled');

      // Fire-and-forget: send course cancelled email to org admins
      this.getCourseDetails(courseId).then(async (details) => {
        const emails = await this.getOrgAdminEmailsWithPreference(course.organization_id, 'course_status_change');
        for (const email of emails) {
          emailService.sendCourseCancelledEmail(email, {
            courseName: details.courseName,
            date: details.date,
            reason,
          }).catch(err => logger.error({ err, courseId }, 'Failed to send course cancelled email'));
        }
      }).catch(err => logger.error({ err, courseId }, 'Failed to send course cancelled notifications'));

      return updated!;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // --- Reschedule course (admin) ---

  async reschedule(input: RescheduleInput): Promise<CourseRequest> {
    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [courseRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM course_requests WHERE id = ? AND deleted_at IS NULL',
        [input.courseId]
      );
      if (courseRows.length === 0) throw new CourseError('Course request not found', 404);

      const course = courseRows[0];

      // Build dynamic update
      const sets: string[] = ['confirmed_date = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const params: unknown[] = [input.scheduledDate];

      if (input.startTime) { sets.push('confirmed_start_time = ?'); params.push(`${input.startTime}:00`); }
      if (input.endTime) { sets.push('confirmed_end_time = ?'); params.push(`${input.endTime}:00`); }
      if (input.instructorId && input.instructorId !== course.instructor_id) {
        sets.push('instructor_id = ?'); params.push(input.instructorId);
      }
      params.push(input.courseId);

      await conn.query(
        `UPDATE course_requests SET ${sets.join(', ')} WHERE id = ?`,
        params
      );

      // Clean up old class if instructor/date changed
      if (course.instructor_id && course.confirmed_date) {
        const oldDateStr = new Date(course.confirmed_date).toISOString().split('T')[0];
        await conn.query(
          'DELETE FROM classes WHERE instructor_id = ? AND DATE(start_time) = ?',
          [course.instructor_id, oldDateStr]
        );
        await conn.query(
          `INSERT INTO instructor_availability (instructor_id, date, status)
           VALUES (?, ?, 'available') ON DUPLICATE KEY UPDATE status = 'available'`,
          [course.instructor_id, oldDateStr]
        );
      }

      // Create new class entry
      const effectiveInstructorId = input.instructorId ?? course.instructor_id;
      if (effectiveInstructorId) {
        const newDateStr = new Date(input.scheduledDate).toISOString().split('T')[0];
        const startTime = input.startTime ?? course.confirmed_start_time;
        const endTime = input.endTime ?? course.confirmed_end_time;

        if (startTime && endTime) {
          await conn.query(
            `INSERT INTO classes (instructor_id, class_type_id, organization_id,
             start_time, end_time, location, max_students, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [effectiveInstructorId, course.course_type_id, course.organization_id,
             `${newDateStr}T${startTime}`, `${newDateStr}T${endTime}`,
             course.location, course.registered_students]
          );

          await conn.query(
            'DELETE FROM instructor_availability WHERE instructor_id = ? AND date = ?',
            [effectiveInstructorId, newDateStr]
          );
        }
      }

      await conn.commit();

      const updated = await this.courseRepo.findById(input.courseId);
      logger.info({ courseId: input.courseId }, 'Course rescheduled');
      return updated!;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // --- Billing readiness ---

  async validateBillingReadiness(courseId: number): Promise<BillingValidation> {
    const course = await this.courseRepo.findWithBillingDetails(courseId);
    if (!course) throw new CourseError('Course not found', 404);

    const errors: string[] = [];
    const warnings: string[] = [];

    if (course.status !== 'completed') {
      errors.push(`Course must be completed before sending to billing. Current status: ${course.status}`);
    }
    if (course.invoiced) {
      errors.push('Course has already been invoiced');
    }
    if (course.ready_for_billing) {
      errors.push('Course is already marked as ready for billing');
    }
    if (!course.price_per_student || !course.pricing_active) {
      errors.push(`Pricing not configured for ${course.organization_name} - ${course.course_type_name}`);
    }
    if (course.students_attended === 0) {
      errors.push('No students marked as attended');
    }
    if (!course.contact_email) {
      errors.push(`Organization ${course.organization_name} has no contact email`);
    }

    return {
      isValid: errors.length === 0,
      courseId: course.id,
      organizationName: course.organization_name,
      courseTypeName: course.course_type_name,
      studentsAttended: course.students_attended,
      pricePerStudent: course.price_per_student,
      estimatedAmount: course.students_attended * (course.price_per_student ?? 0),
      errors,
      warnings,
    };
  }

  async markReadyForBilling(courseId: number): Promise<CourseRequest> {
    const validation = await this.validateBillingReadiness(courseId);
    if (!validation.isValid) {
      throw new CourseError(`Cannot send to billing: ${validation.errors.join('; ')}`);
    }

    const updated = await this.courseRepo.markReadyForBilling(courseId);
    if (!updated) throw new CourseError('Failed to update course', 500);

    logger.info({ courseId }, 'Course marked ready for billing');
    return updated;
  }

  // --- Students ---

  async getStudents(courseId: number, orgId?: number): Promise<CourseStudent[]> {
    // If orgId provided, verify course belongs to that org
    if (orgId) {
      const course = await this.courseRepo.forOrg(orgId).findById(courseId);
      if (!course) throw new CourseError('Course not found or not authorized', 404);
    }

    return this.studentRepo.findByCourse(courseId);
  }

  async addStudents(
    courseId: number,
    orgId: number,
    students: Array<{ firstName: string; lastName: string; email?: string }>
  ): Promise<number> {
    // Verify course belongs to org
    const course = await this.courseRepo.forOrg(orgId).findById(courseId);
    if (!course) throw new CourseError('Course not found or not authorized', 404);

    return this.studentRepo.addStudents(courseId, students, orgId);
  }

  // --- Reminder ---

  async updateReminder(courseId: number): Promise<CourseRequest> {
    const updated = await this.courseRepo.updateReminder(courseId);
    if (!updated) throw new CourseError('Course request not found', 404);
    return updated;
  }
}
