import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
} from '@mui/material';
import { api } from '../../../../services/api';
import { formatDisplayDate, getTodayDate } from '../../../../utils/formatters';
import DataTable, { DataTableRow } from '../../../gtacpr/DataTable';
import StatusChip from '../../../gtacpr/StatusChip';
import LinkButton from '../../../gtacpr/LinkButton';
import { GhostButton } from '../../../gtacpr/Buttons';

interface Course {
  id: string | number;
  dateRequested: string;
  courseTypeName: string;
  location: string;
  registeredStudents: number;
  status: string;
  instructor: string | null;
  notes?: string;
  confirmedDate?: string;
  requestSubmittedDate: string;
  scheduledDate?: string;
  studentsAttended?: number;
  archivedAt?: string;
}

interface Student {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  attended?: boolean;
  attendanceMarked?: boolean;
}

interface OrganizationArchiveProps {
  courses: Course[];
  onViewStudentsClick?: (courseId: string | number) => void;
}

const columns = [
  { key: 'courseType', label: 'COURSE TYPE', width: '1.2fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'instructor', label: 'INSTRUCTOR', width: '0.8fr' },
  { key: 'students', label: 'STUDENTS', width: '0.6fr' },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
  { key: 'completed', label: 'COMPLETED', width: '0.8fr' },
  { key: 'archived', label: 'ARCHIVED', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

const studentColumns = [
  { key: 'name', label: 'NAME', width: '1.2fr' },
  { key: 'email', label: 'EMAIL', width: '1.2fr' },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
];

const getStatusKind = (status: string): 'success' | 'danger' | 'warning' => {
  switch (status?.toLowerCase()) {
    case 'completed': return 'success';
    case 'cancelled': return 'danger';
    default: return 'warning';
  }
};

const OrganizationArchive: React.FC<OrganizationArchiveProps> = ({ courses }) => {
  const [studentDialogOpen, setStudentDialogOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courseTypeFilter, setCourseTypeFilter] = useState('all');
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportCSV = async () => {
    try {
      setExportError(null);
      const response = await api.get('/organization/roster/export/csv', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `roster-${getTodayDate()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setExportError('Failed to export roster'); }
  };

  const handleViewStudentsClick = async (course: Course) => {
    setSelectedCourse(course);
    setStudentDialogOpen(true);
    setLoadingStudents(true);
    setStudentError(null);
    try {
      const response = await api.get(`/courses/org/students/${course.id}`);
      if (response.data.success) {
        setStudents(response.data.data || []);
      } else {
        setStudentError('Failed to load students');
      }
    } catch (error: unknown) {
      const errObj = error as { response?: { data?: { error?: { message?: string } } } };
      setStudentError(errObj.response?.data?.error?.message || 'Failed to load students');
    } finally {
      setLoadingStudents(false);
    }
  };

  const handleCloseStudentDialog = () => {
    setStudentDialogOpen(false);
    setSelectedCourse(null);
    setStudents([]);
    setStudentError(null);
  };

  const safeCourses = Array.isArray(courses) ? courses : [];
  const term = searchTerm.trim().toLowerCase();

  const filteredCourses = safeCourses.filter(course => {
    // Instructor (and other fields) can be null for archived/cancelled courses
    const matchesSearch =
      !term ||
      [course.courseTypeName, course.location, course.instructor]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    const matchesStatus = statusFilter === 'all' || (course.status || '').toLowerCase() === statusFilter.toLowerCase();
    const matchesCourseType = courseTypeFilter === 'all' || course.courseTypeName === courseTypeFilter;
    return matchesSearch && matchesStatus && matchesCourseType;
  });

  const courseTypes = Array.from(new Set(safeCourses.map(course => course.courseTypeName).filter(Boolean))).sort();

  const formatStatus = (status: string | null | undefined) => {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {exportError && <Alert severity="error" onClose={() => setExportError(null)}>{exportError}</Alert>}

      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Filters
          </Typography>
          <GhostButton onClick={handleExportCSV}>Export CSV</GhostButton>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          <TextField fullWidth label="Search courses" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} size="small" inputProps={{ 'aria-label': 'Search archived courses' }} />
          <FormControl fullWidth size="small">
            <InputLabel id="archive-status-label">Status</InputLabel>
            <Select labelId="archive-status-label" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} label="Status">
              <MenuItem value="all">All Statuses</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="archive-course-type-label">Course Type</InputLabel>
            <Select labelId="archive-course-type-label" value={courseTypeFilter} onChange={(e) => setCourseTypeFilter(e.target.value)} label="Course Type">
              <MenuItem value="all">All Course Types</MenuItem>
              {courseTypes.map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Table */}
      {filteredCourses.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No archived courses found</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={filteredCourses.length} totalCount={safeCourses.length}>
          {filteredCourses.map((course) => (
            <DataTableRow key={course.id} columns={columns}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.courseTypeName}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.instructor || '—'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{course.studentsAttended || 0} / {course.registeredStudents}</Typography>
              <StatusChip kind={getStatusKind(course.status)} label={formatStatus(course.status)} />
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(course.confirmedDate)}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(course.archivedAt)}</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleViewStudentsClick(course)} aria-label={`View students for ${course.courseTypeName}`}>Students</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      {/* Student Dialog */}
      <Dialog open={studentDialogOpen} onClose={handleCloseStudentDialog} maxWidth="md" fullWidth aria-labelledby="archive-students-dialog-title">
        <DialogTitle id="archive-students-dialog-title" sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Students — {selectedCourse?.courseTypeName}
        </DialogTitle>
        <DialogContent>
          {loadingStudents ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
          ) : studentError ? (
            <Alert severity="error">{studentError}</Alert>
          ) : students.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No students found for this course.</Typography>
          ) : (
            <DataTable columns={studentColumns} shownCount={students.length} totalCount={students.length}>
              {students.map((student) => (
                <DataTableRow key={student.id} columns={studentColumns}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{student.firstName} {student.lastName}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{student.email}</Typography>
                  <StatusChip
                    kind={student.attended ? 'success' : student.attendanceMarked ? 'danger' : 'neutral'}
                    label={student.attended ? 'Attended' : student.attendanceMarked ? 'No Show' : 'Not marked'}
                  />
                </DataTableRow>
              ))}
            </DataTable>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleCloseStudentDialog}>Close</GhostButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OrganizationArchive;
