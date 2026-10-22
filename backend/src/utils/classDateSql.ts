/**
 * The day a completed class was held, for "Date Completed" and "last course"
 * columns. completed_at is stored in UTC and the database has no time zone
 * tables, so DATE(completed_at) put a class finished after about 8 pm Toronto
 * time on the next day (UAT 2026-10-21). The class's own date has no time zone.
 * NULL until the class is completed.
 */
export const completedClassDate = (alias: string) =>
  `CASE WHEN ${alias}.completed_at IS NOT NULL THEN COALESCE(${alias}.confirmed_date, ${alias}.scheduled_date, DATE(${alias}.completed_at)) END`;
