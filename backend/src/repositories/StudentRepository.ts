import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../config/database.js';
import { paginatedQuery, type PaginationParams, type PaginatedResult } from '../utils/pagination.js';

export interface Student {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  organization_id: number | null;
  marketing_consent: boolean;
  marketing_consent_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface StudentWithHistory extends Student {
  course_count: number;
  last_course_date: string | null;
  organizations: string | null;
}

export class StudentRepository {
  /**
   * Find or create a master student record by email.
   * Returns the student id. Used during roster upload as a write-through.
   */
  async findOrCreate(
    data: {
      email: string;
      firstName: string;
      lastName: string;
      phone?: string | null;
      organizationId?: number | null;
    },
    /** Pass a connection to enrol this write in the caller's transaction. */
    conn?: PoolConnection,
  ): Promise<number> {
    const db = conn ?? getPool();
    const email = data.email.trim().toLowerCase();

    // Try insert, ignore if email already exists
    await db.query(
      `INSERT IGNORE INTO students (email, first_name, last_name, phone, organization_id)
       VALUES (?, ?, ?, ?, ?)`,
      [email, data.firstName, data.lastName, data.phone ?? null, data.organizationId ?? null]
    );

    // Fetch the id (whether just inserted or already existed)
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT id FROM students WHERE email = ?',
      [email]
    );

    return rows[0].id;
  }

  /**
   * Bulk find-or-create for roster uploads. Returns a map of email → student id.
   */
  async findOrCreateBulk(
    students: Array<{ email: string; firstName: string; lastName: string; phone?: string | null }>,
    organizationId?: number | null,
  ): Promise<Map<string, number>> {
    const pool = getPool();
    const result = new Map<string, number>();
    const withEmail = students.filter(s => s.email?.trim());

    if (withEmail.length === 0) return result;

    // Bulk insert ignore
    const placeholders = withEmail.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const values = withEmail.flatMap(s => [
      s.email.trim().toLowerCase(), s.firstName, s.lastName,
      s.phone ?? null, organizationId ?? null,
    ]);

    await pool.query(
      `INSERT IGNORE INTO students (email, first_name, last_name, phone, organization_id) VALUES ${placeholders}`,
      values
    );

    // Fetch all ids
    const emails = withEmail.map(s => s.email.trim().toLowerCase());
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM students WHERE email IN (${emails.map(() => '?').join(',')})`,
      emails
    );

    for (const row of rows) {
      result.set(row.email, row.id);
    }

    return result;
  }

  async findById(id: number): Promise<Student | null> {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & Student)[]>('SELECT * FROM students WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<Student | null> {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & Student)[]>(
      'SELECT * FROM students WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    return rows[0] ?? null;
  }

  async findByOrg(orgId: number): Promise<StudentWithHistory[]>;
  async findByOrg(orgId: number, pagination: PaginationParams): Promise<PaginatedResult<StudentWithHistory>>;
  async findByOrg(
    orgId: number,
    pagination?: PaginationParams,
  ): Promise<StudentWithHistory[] | PaginatedResult<StudentWithHistory>> {
    const dataSQL = `SELECT s.*,
              COUNT(DISTINCT cs.course_request_id) as course_count,
              MAX(cr.completed_at) as last_course_date
       FROM students s
       LEFT JOIN course_students cs ON cs.student_id = s.id
       LEFT JOIN course_requests cr ON cs.course_request_id = cr.id
       WHERE s.organization_id = ?
       GROUP BY s.id
       ORDER BY s.last_name, s.first_name`;

    if (pagination) {
      // GROUP BY s.id means one row per student, so the total is a plain
      // student count over the same WHERE.
      return paginatedQuery<StudentWithHistory>(
        dataSQL,
        'SELECT COUNT(*) as count FROM students s WHERE s.organization_id = ?',
        [orgId],
        pagination,
      );
    }

    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & StudentWithHistory)[]>(dataSQL, [orgId]);
    return rows;
  }

  async search(query: string, limit = 50): Promise<StudentWithHistory[]> {
    const pool = getPool();
    const pattern = `%${query}%`;
    const [rows] = await pool.query<(RowDataPacket & StudentWithHistory)[]>(
      `SELECT s.*,
              COUNT(DISTINCT cs.course_request_id) as course_count,
              MAX(cr.completed_at) as last_course_date
       FROM students s
       LEFT JOIN course_students cs ON cs.student_id = s.id
       LEFT JOIN course_requests cr ON cs.course_request_id = cr.id
       WHERE s.email LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ?
       GROUP BY s.id
       ORDER BY s.last_name, s.first_name
       LIMIT ?`,
      [pattern, pattern, pattern, limit]
    );
    return rows;
  }

  async getCourseHistory(studentId: number): Promise<RowDataPacket[]> {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cs.id, cs.course_request_id, cs.attended, cs.attendance_marked,
              cs.certificate_number, cs.certificate_issued_at, cs.certificate_expires_at,
              cr.completed_at, cr.location,
              ct.name as course_type_name, ct.certification_validity_months,
              o.name as organization_name,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username) as instructor_name
       FROM course_students cs
       JOIN course_requests cr ON cs.course_request_id = cr.id
       JOIN class_types ct ON cr.course_type_id = ct.id
       JOIN organizations o ON cr.organization_id = o.id
       LEFT JOIN users u ON cr.instructor_id = u.id
       WHERE cs.student_id = ?
       ORDER BY cr.completed_at DESC`,
      [studentId]
    );
    return rows;
  }

  async updateMarketingConsent(studentId: number, consent: boolean): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE students SET marketing_consent = ?, marketing_consent_at = IF(?, CURRENT_TIMESTAMP, NULL)
       WHERE id = ?`,
      [consent, consent, studentId]
    );
  }
}
