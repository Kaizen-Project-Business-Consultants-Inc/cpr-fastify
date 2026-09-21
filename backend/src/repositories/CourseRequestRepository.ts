import { BaseRepository } from './BaseRepository.js';
import { paginatedQuery, type PaginationParams, type PaginatedResult } from '../utils/pagination.js';

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
  source: string;
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

  /**
   * Shared FROM/JOIN block for the list queries. Kept in one place so a
   * paginated count query can never drift from its data query.
   */
  private static readonly LIST_FROM = `
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id`;

  // The frontend reads these in camelCase (course.scheduledDate,
  // course.courseTypeName, ...) but course_requests and its joined tables are
  // snake_case, so every derived/base column the UI touches gets a matching
  // camelCase alias here, alongside the original snake_case one left in place
  // for any other consumer. Without this, the admin "assign instructor"
  // screen silently shows every pending course with a blank name/org/date
  // and 0 students, and the assign dialog's `if (course.scheduledDate)`
  // check always fails — no instructor can ever be assigned. Found by an E2E
  // test that actually drove the request-a-course -> assign-instructor
  // workflow, not just navigation. See tests/e2e/workflows.spec.ts.
  private static readonly LIST_COLS = `cr.*,
              cr.date_requested as request_submitted_date,
              cr.date_requested as requestSubmittedDate,
              cr.scheduled_date as scheduledDate,
              cr.registered_students as registeredStudents,
              cr.instructor_id as instructorId,
              cr.confirmed_date as confirmedDate,
              cr.confirmed_start_time as confirmedStartTime,
              cr.confirmed_end_time as confirmedEndTime,
              cr.ready_for_billing as readyForBilling,
              ct.name as course_type_name,
              ct.name as courseTypeName,
              o.name as organization_name,
              o.name as organizationName,
              u.username as instructor_name,
              u.username as instructorName,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) AS students_attended,
              (SELECT COUNT(*) FROM course_students cs
               WHERE cs.course_request_id = cr.id AND cs.attended = true) AS studentsAttended`;

  /**
   * Run a list query either unbounded (no `pagination` — today's behaviour) or
   * paginated. `where`/`params` are shared by the data and count queries.
   */
  private async listCourses(
    where: string,
    orderBy: string,
    params: unknown[],
    pagination?: PaginationParams,
  ): Promise<CourseWithDetails[] | PaginatedResult<CourseWithDetails>> {
    const dataSQL = `SELECT ${CourseRequestRepository.LIST_COLS}
       ${CourseRequestRepository.LIST_FROM}
       ${where}
       ORDER BY ${orderBy}`;

    if (pagination) {
      return paginatedQuery<CourseWithDetails>(
        dataSQL,
        `SELECT COUNT(*) as count ${CourseRequestRepository.LIST_FROM} ${where}`,
        params,
        pagination,
      );
    }
    return this.query<CourseWithDetails>(dataSQL, params);
  }

  async findByStatus(status: string | string[]): Promise<CourseWithDetails[]>;
  async findByStatus(status: string | string[], pagination: PaginationParams): Promise<PaginatedResult<CourseWithDetails>>;
  async findByStatus(
    status: string | string[],
    pagination?: PaginationParams,
  ): Promise<CourseWithDetails[] | PaginatedResult<CourseWithDetails>> {
    const statuses = Array.isArray(status) ? status : [status];
    const placeholders = statuses.map(() => '?').join(', ');

    return this.listCourses(
      `WHERE cr.status IN (${placeholders}) AND cr.deleted_at IS NULL`,
      'cr.scheduled_date ASC',
      statuses,
      pagination,
    );
  }

  async findPending(): Promise<CourseWithDetails[]>;
  async findPending(pagination: PaginationParams): Promise<PaginatedResult<CourseWithDetails>>;
  async findPending(pagination?: PaginationParams) {
    return this.listCourses(
      `WHERE cr.status IN ('pending', 'past_due') AND cr.deleted_at IS NULL`,
      `CASE WHEN cr.status = 'past_due' THEN 0 ELSE 1 END, cr.scheduled_date ASC`,
      [],
      pagination,
    );
  }

  async findConfirmed(): Promise<CourseWithDetails[]>;
  async findConfirmed(pagination: PaginationParams): Promise<PaginatedResult<CourseWithDetails>>;
  async findConfirmed(pagination?: PaginationParams) {
    return pagination ? this.findByStatus('confirmed', pagination) : this.findByStatus('confirmed');
  }

  async findCompleted(): Promise<CourseWithDetails[]>;
  async findCompleted(pagination: PaginationParams): Promise<PaginatedResult<CourseWithDetails>>;
  async findCompleted(pagination?: PaginationParams) {
    return this.listCourses(
      `WHERE cr.status IN ('completed', 'invoiced') AND cr.deleted_at IS NULL`,
      'cr.completed_at DESC',
      [],
      pagination,
    );
  }

  async findCancelled(): Promise<CourseWithDetails[]>;
  async findCancelled(pagination: PaginationParams): Promise<PaginatedResult<CourseWithDetails>>;
  async findCancelled(pagination?: PaginationParams) {
    return this.listCourses(
      `WHERE cr.status = 'cancelled' AND cr.deleted_at IS NULL`,
      'cr.updated_at DESC',
      [],
      pagination,
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
