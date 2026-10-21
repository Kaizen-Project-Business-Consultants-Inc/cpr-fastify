import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatDisplayDate } from '../../utils/dateUtils';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';

/** One row of GET /instructor/classes/completed (no camelCase layer, so mostly snake/lower names). */
interface ArchiveCourse {
  id?: number;
  courseId?: number;
  date?: string;
  name?: string;
  organizationname?: string;
  location?: string;
  /** Students on the roster. */
  studentcount?: number;
  /** Students the organization asked for (course_requests.registered_students). */
  max_students?: number;
  studentsattendance?: number;
  /** course_requests.completed_at, a timestamp (ISO datetime). */
  completedAt?: string | null;
}

interface InstructorArchiveTableProps {
  courses: ArchiveCourse[];
}

/** Completed On: the completion timestamp in local time, else the class date. */
const completedOn = (course: ArchiveCourse): string => {
  if (course.completedAt) {
    const d = new Date(course.completedAt);
    if (!isNaN(d.getTime())) return formatDisplayDate(d);
  }
  return course.date ? formatDisplayDate(course.date) : '—';
};

const columns = [
  { key: 'date', label: 'CLASS DATE', width: '1fr' },
  { key: 'course', label: 'COURSE NAME', width: '1.3fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1.2fr' },
  { key: 'location', label: 'LOCATION', width: '1fr' },
  { key: 'registered', label: 'REGISTERED', width: '0.7fr', align: 'right' as const },
  { key: 'attended', label: 'ATTENDED', width: '0.7fr', align: 'right' as const },
  { key: 'completed', label: 'COMPLETED ON', width: '1fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
];

const InstructorArchiveTable: React.FC<InstructorArchiveTableProps> = ({ courses = [] }) => {
  if (courses.length === 0) {
    return (
      <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
        <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No completed classes yet.</Typography>
        <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 12.5, mt: 1 }}>Completed classes will appear here after you mark them as finished.</Typography>
      </Box>
    );
  }

  return (
    <DataTable columns={columns} shownCount={courses.length} totalCount={courses.length}>
      {courses.map((course, index) => (
        <DataTableRow key={course.courseId || index} columns={columns}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
            {course.date ? formatDisplayDate(course.date) : '—'}
          </Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.name || 'CPR Class'}</Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationname || 'Unassigned'}</Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location || 'TBD'}</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>
            {course.studentcount || course.max_students || 0}
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>
            {course.studentsattendance || 0}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>
            {completedOn(course)}
          </Typography>
          <StatusChip kind="success" label="Completed" />
        </DataTableRow>
      ))}
    </DataTable>
  );
};

export default InstructorArchiveTable;
