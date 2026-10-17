import type { RowDataPacket } from 'mysql2/promise';
import { BaseRepository } from './BaseRepository.js';

export interface Organization {
  id: number;
  name: string;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** One row of HR → Personnel → Organizations, camelCase as that screen reads it. */
export interface OrganizationWithStats {
  id: number;
  name: string;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalCourses: number;
  completedCourses: number;
  activeCourses: number;
  totalUsers: number;
  lastCourseDate: Date | null;
}

export class OrganizationRepository extends BaseRepository<Organization> {
  constructor() {
    super('organizations', null, false);
  }

  async findWithStats(options: { search?: string; limit: number; offset: number }): Promise<{ rows: OrganizationWithStats[]; total: number }> {
    const params: unknown[] = [];
    let searchClause = '';

    if (options.search) {
      searchClause = 'AND (o.name LIKE ? OR o.contact_email LIKE ?)';
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    const rows = await this.query<OrganizationWithStats>(
      `SELECT
         o.id, o.name, o.contact_email as contactEmail, o.contact_phone as contactPhone, o.address,
         o.created_at as createdAt, o.updated_at as updatedAt,
         COALESCE(c.total, 0) as totalCourses,
         COALESCE(c.completed, 0) as completedCourses,
         COALESCE(c.active, 0) as activeCourses,
         COALESCE(us.users, 0) as totalUsers,
         c.last_course as lastCourseDate
       FROM organizations o
       LEFT JOIN (
         SELECT organization_id, COUNT(*) as total,
                COUNT(CASE WHEN status IN ('completed', 'invoiced') THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as active,
                MAX(created_at) as last_course
         FROM course_requests WHERE deleted_at IS NULL GROUP BY organization_id
       ) c ON c.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, COUNT(*) as users FROM users WHERE status = 'active' GROUP BY organization_id
       ) us ON us.organization_id = o.id
       WHERE 1=1 ${searchClause}
       ORDER BY o.name, o.id
       LIMIT ? OFFSET ?`,
      [...params, options.limit, options.offset]
    );

    const countParams: unknown[] = [];
    let countSearch = '';
    if (options.search) {
      countSearch = 'AND (name LIKE ? OR contact_email LIKE ?)';
      countParams.push(`%${options.search}%`, `%${options.search}%`);
    }

    const [{ total }] = await this.query<{ total: number }>(
      `SELECT COUNT(*) as total FROM organizations WHERE 1=1 ${countSearch}`,
      countParams
    );

    return { rows, total };
  }

  async updateProfile(id: number, data: { name: string; address: string; contactPhone: string; contactEmail: string }): Promise<Organization | null> {
    await this.execute(
      `UPDATE organizations SET name = ?, address = ?, contact_phone = ?, contact_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [data.name, data.address, data.contactPhone, data.contactEmail, id]
    );
    return this.findById(id);
  }

  async getOrgCourses(orgId: number, options: { archived: boolean; limit: number; offset: number; from?: string; to?: string }): Promise<{ rows: RowDataPacket[]; total: number }> {
    let dateFilter = '';
    const dateParams: unknown[] = [];
    if (options.from) {
      dateFilter += ' AND cr.scheduled_date >= ?';
      dateParams.push(options.from);
    }
    if (options.to) {
      dateFilter += ' AND cr.scheduled_date <= ?';
      dateParams.push(options.to);
    }

    // The "My Courses" screen reads these in camelCase (course.registeredStudents,
    // course.courseTypeName, ...); cr.* alone left them undefined, so REG.,
    // course name and every date on this exact screen never actually showed —
    // independent of whatever value is in the column, including the count
    // CourseService now keeps in sync with the uploaded roster.
    const rows = await this.query<RowDataPacket>(
      `SELECT cr.*, cr.date_requested as request_submitted_date, cr.date_requested as requestSubmittedDate,
              cr.scheduled_date as scheduledDate, cr.confirmed_date as confirmedDate,
              cr.registered_students as registeredStudents,
              ct.name as course_type_name, ct.name as courseTypeName,
              u.username as instructor,
              (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id AND cs.attended = true) AS students_attended,
              (SELECT COUNT(*) FROM course_students cs WHERE cs.course_request_id = cr.id AND cs.attended = true) AS studentsAttended
       FROM course_requests cr
       LEFT JOIN class_types ct ON cr.course_type_id = ct.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cr.organization_id = ? AND cr.archived = ?${dateFilter}
       ORDER BY ${options.archived ? 'cr.archived_at' : 'cr.created_at'} DESC
       LIMIT ? OFFSET ?`,
      [orgId, options.archived, ...dateParams, options.limit, options.offset]
    );

    const [{ total }] = await this.query<{ total: number }>(
      `SELECT COUNT(*) as total FROM course_requests WHERE organization_id = ? AND archived = ?${dateFilter}`,
      [orgId, options.archived, ...dateParams]
    );

    return { rows, total };
  }
}
