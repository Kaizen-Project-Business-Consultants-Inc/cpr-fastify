/**
 * The day a completed class was held, for "Date Completed" and "last course"
 * columns. completed_at is stored in UTC and the database has no time zone
 * tables, so DATE(completed_at) put a class finished after about 8 pm Toronto
 * time on the next day (UAT 2026-10-21). The class's own date has no time zone.
 * NULL until the class is completed.
 */
export const completedClassDate = (alias: string) =>
  `CASE WHEN ${alias}.completed_at IS NOT NULL THEN COALESCE(${alias}.confirmed_date, ${alias}.scheduled_date, DATE(${alias}.completed_at)) END`;

/**
 * Certificate dates for students who attended a completed class whose course
 * type has a validity period: issued on the class day, expiring that many
 * months later. Append a WHERE filter (e.g. one class) after it.
 */
export const ISSUE_CERTIFICATES_SQL = `
  UPDATE course_students cs
  JOIN course_requests cr ON cs.course_request_id = cr.id
  JOIN class_types ct ON cr.course_type_id = ct.id
  SET cs.certificate_issued_at = ${completedClassDate('cr')},
      cs.certificate_expires_at = DATE_ADD(${completedClassDate('cr')}, INTERVAL ct.certification_validity_months MONTH)
  WHERE cs.attended = true AND cs.deleted_at IS NULL
    AND cr.completed_at IS NOT NULL AND ct.certification_validity_months IS NOT NULL`;
