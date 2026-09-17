import { BaseRepository } from './BaseRepository.js';

export interface CourseRequest {
  id: number;
  organization_id: number;
  course_type_id: number;
  date_requested: Date;
  scheduled_date: Date | null;
  location: string;
  location_id: number | null;
  registered_students: number;
  notes: string | null;
  status: string;
  instructor_id: number | null;
  confirmed_date: Date | null;
  confirmed_start_time: string | null;
  confirmed_end_time: string | null;
  completed_at: Date | null;
  is_cancelled: boolean;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  ready_for_billing: boolean;
  ready_for_billing_at: Date | null;
  invoiced: boolean;
  last_reminder_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CourseWithDetails extends CourseRequest {
  course_type_name: string;
  organization_name: string;
  instructor_name: string | null;
  students_attended: number;
  contact_email: string | null;
  price_per_student: number | null;
  pricing_active: boolean | null;
}

export class CourseRequestRepository extends BaseRepository<CourseRequest> {
  constructor() {
    super('course_requests');
  }

  async findByStatus(status: string | string[]): Promise<CourseWithDetails[]> {
    const statuses = Array.isArray(status) ? status : [status];
    const placeholders = statuses.map(() => '?').join(', ');

    return this.query<CourseWithDetails>(
      `SELECT cr.*, cr.date_requested as request_submitted_date,
              ct.name as course_type_name,
              o.name as organization_name,
              u.username as instructor_name,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) AS students_attended
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cr.status IN (${placeholders})
       AND cr.deleted_at IS NULL
       ORDER BY cr.scheduled_date ASC`,
      statuses
    );
  }

  async findPending(): Promise<CourseWithDetails[]> {
    return this.query<CourseWithDetails>(
      `SELECT cr.*, cr.date_requested as request_submitted_date,
              ct.name as course_type_name,
              o.name as organization_name,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) AS students_attended
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       WHERE cr.status IN ('pending', 'past_due')
       AND cr.deleted_at IS NULL
       ORDER BY
         CASE WHEN cr.status = 'past_due' THEN 0 ELSE 1 END,
         cr.scheduled_date ASC`
    );
  }

  async findConfirmed(): Promise<CourseWithDetails[]> {
    return this.findByStatus('confirmed');
  }

  async findCompleted(): Promise<CourseWithDetails[]> {
    return this.query<CourseWithDetails>(
      `SELECT cr.*, cr.date_requested as request_submitted_date,
              ct.name as course_type_name,
              o.name as organization_name,
              u.username as instructor_name,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) AS students_attended
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cr.status IN ('completed', 'invoiced')
       AND cr.deleted_at IS NULL
       ORDER BY cr.completed_at DESC`
    );
  }

  async findCancelled(): Promise<CourseWithDetails[]> {
    return this.query<CourseWithDetails>(
      `SELECT cr.*, cr.date_requested as request_submitted_date,
              ct.name as course_type_name,
              o.name as organization_name,
              u.username as instructor_name,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) AS students_attended
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cr.status = 'cancelled'
       AND cr.deleted_at IS NULL
       ORDER BY cr.updated_at DESC`
    );
  }

  async findWithBillingDetails(id: number): Promise<CourseWithDetails | null> {
    const rows = await this.query<CourseWithDetails>(
      `SELECT cr.*,
              o.name as organization_name,
              o.contact_email,
              ct.name as course_type_name,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) as students_attended,
              cp.price_per_student,
              cp.is_active as pricing_active
       FROM course_requests cr
       JOIN organizations o ON cr.organization_id = o.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN course_pricing cp ON cr.organization_id = cp.organization_id
         AND cr.course_type_id = cp.course_type_id AND cp.is_active = true
       WHERE cr.id = ?`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findDuplicate(orgId: number, location: string, date: string): Promise<CourseRequest | null> {
    const rows = await this.query<CourseRequest>(
      `SELECT id, status FROM course_requests
       WHERE organization_id = ?
       AND location = ?
       AND scheduled_date = ?
       AND status NOT IN ('cancelled', 'completed')
       AND COALESCE(is_cancelled, false) = false`,
      [orgId, location, date]
    );
    return rows[0] ?? null;
  }

  async markReadyForBilling(id: number): Promise<CourseRequest | null> {
    await this.execute(
      `UPDATE course_requests
       SET ready_for_billing = true,
           ready_for_billing_at = CURRENT_TIMESTAMP,
           status = 'invoiced',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );
    return this.findById(id);
  }

  async updateReminder(id: number): Promise<CourseRequest | null> {
    await this.execute(
      `UPDATE course_requests SET last_reminder_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
    return this.findById(id);
  }
}
