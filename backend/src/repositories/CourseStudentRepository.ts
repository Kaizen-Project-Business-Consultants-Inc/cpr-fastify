import { BaseRepository } from './BaseRepository.js';
import { StudentRepository } from './StudentRepository.js';

export interface CourseStudent {
  id: number;
  course_request_id: number;
  student_id: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  attended: boolean;
  attendance_marked: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export class CourseStudentRepository extends BaseRepository<CourseStudent> {
  private studentRepo = new StudentRepository();

  constructor() {
    super('course_students', null, false); // No org column — scoped via course_request
  }

  async findByCourse(courseRequestId: number): Promise<CourseStudent[]> {
    return this.query<CourseStudent>(
      `SELECT id, course_request_id, student_id, first_name, last_name, email,
              attended, attendance_marked, created_at
       FROM course_students
       WHERE course_request_id = ? AND deleted_at IS NULL
       ORDER BY last_name, first_name`,
      [courseRequestId]
    );
  }

  /**
   * Adds students to a course roster, skipping anyone already on it (matched
   * by email when given, otherwise by first+last name, case-insensitive).
   * Without this, re-submitting the same CSV — e.g. because an earlier
   * attempt gave no confirmation and looked like it failed — silently
   * duplicated every row on the roster. Returns how many were actually
   * added versus skipped as already present, so the caller can tell the
   * difference between "added 4" and "added 0, all 4 already there".
   */
  async addStudents(
    courseRequestId: number,
    students: Array<{ firstName: string; lastName: string; email?: string }>,
    organizationId?: number | null,
  ): Promise<{ added: number; skipped: number }> {
    if (students.length === 0) return { added: 0, skipped: 0 };

    const existing = await this.query<CourseStudent>(
      `SELECT first_name, last_name, email FROM course_students
       WHERE course_request_id = ? AND deleted_at IS NULL`,
      [courseRequestId]
    );
    const existingEmails = new Set(
      existing.filter(s => s.email?.trim()).map(s => s.email!.trim().toLowerCase())
    );
    const existingNames = new Set(
      existing.map(s => `${s.first_name.trim().toLowerCase()}|${s.last_name.trim().toLowerCase()}`)
    );

    const seenInThisBatch = new Set<string>();
    const toInsert = students.filter(s => {
      const email = s.email?.trim().toLowerCase();
      const nameKey = `${s.firstName.trim().toLowerCase()}|${s.lastName.trim().toLowerCase()}`;
      const dupKey = email || nameKey;
      if (seenInThisBatch.has(dupKey)) return false;
      if (email && existingEmails.has(email)) return false;
      if (!email && existingNames.has(nameKey)) return false;
      seenInThisBatch.add(dupKey);
      return true;
    });

    const skipped = students.length - toInsert.length;
    if (toInsert.length === 0) return { added: 0, skipped };

    // Write-through: create/find master student records for those with email
    const emailMap = await this.studentRepo.findOrCreateBulk(
      toInsert.filter(s => s.email?.trim()).map(s => ({
        email: s.email!,
        firstName: s.firstName,
        lastName: s.lastName,
      })),
      organizationId,
    );

    // Multi-row INSERT with student_id link
    const placeholders = toInsert.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const values = toInsert.flatMap(s => {
      const email = s.email?.trim().toLowerCase() ?? null;
      const studentId = email ? (emailMap.get(email) ?? null) : null;
      return [courseRequestId, s.firstName, s.lastName, s.email ?? null, studentId];
    });

    await this.execute(
      `INSERT INTO course_students (course_request_id, first_name, last_name, email, student_id) VALUES ${placeholders}`,
      values
    );
    return { added: toInsert.length, skipped };
  }

  /** Soft-deletes one roster row — scoped to the given course so a caller
   *  can't remove a student from a course they don't own. */
  async removeFromCourse(courseRequestId: number, courseStudentId: number): Promise<boolean> {
    const result = await this.execute(
      `UPDATE course_students SET deleted_at = NOW()
       WHERE id = ? AND course_request_id = ? AND deleted_at IS NULL`,
      [courseStudentId, courseRequestId]
    );
    return result.affectedRows > 0;
  }
}
