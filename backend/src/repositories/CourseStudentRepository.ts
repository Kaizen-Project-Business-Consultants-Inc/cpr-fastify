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
       WHERE course_request_id = ?
       ORDER BY last_name, first_name`,
      [courseRequestId]
    );
  }

  async addStudents(
    courseRequestId: number,
    students: Array<{ firstName: string; lastName: string; email?: string }>,
    organizationId?: number | null,
  ): Promise<number> {
    if (students.length === 0) return 0;

    // Write-through: create/find master student records for those with email
    const emailMap = await this.studentRepo.findOrCreateBulk(
      students.filter(s => s.email?.trim()).map(s => ({
        email: s.email!,
        firstName: s.firstName,
        lastName: s.lastName,
      })),
      organizationId,
    );

    // Multi-row INSERT with student_id link
    const placeholders = students.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const values = students.flatMap(s => {
      const email = s.email?.trim().toLowerCase() ?? null;
      const studentId = email ? (emailMap.get(email) ?? null) : null;
      return [courseRequestId, s.firstName, s.lastName, s.email ?? null, studentId];
    });

    await this.execute(
      `INSERT INTO course_students (course_request_id, first_name, last_name, email, student_id) VALUES ${placeholders}`,
      values
    );
    return students.length;
  }

}
