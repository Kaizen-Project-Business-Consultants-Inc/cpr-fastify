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
  Tooltip,
} from '@mui/material';
import { api } from '../../../../services/api';
import { formatDisplayDate } from '../../../../utils/dateUtils';
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
  instructor: string;
  notes?: string;
  confirmedDate?: string;
  requestSubmittedDate: string;
  scheduledDate?: string;
  studentsAttended?: number;
}

interface Student {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  attended?: boolean;
  attendanceMarked?: boolean;
}

interface OrganizationCoursesProps {
  courses: Course[];
  onViewStudentsClick?: (courseId: string | number) => void;
  onUploadStudentsClick?: (courseId: string | number) => void;
}

const columns = [
  { key: 'submitted', label: 'SUBMITTED', width: '0.8fr' },
  { key: 'scheduled', label: 'SCHEDULED', width: '0.8fr' },
  { key: 'course', label: 'COURSE', width: '1fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'registered', label: 'REG.', width: '0.4fr', align: 'right' as const },
  { key: 'attended', label: 'ATT.', width: '0.4fr', align: 'right' as const },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
  { key: 'instructor', label: 'INSTRUCTOR', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.8fr', align: 'right' as const },
];

const studentColumns = [
  { key: 'name', label: 'NAME', width: '1.2fr' },
  { key: 'email', label: 'EMAIL', width: '1.2fr' },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
];

const getStatusKind = (status: string): 'success' | 'active' | 'danger' | 'warning' | 'pending' => {
  switch (status?.toLowerCase()) {
    case 'confirmed': case 'completed': return 'success';
    case 'cancelled': case 'past_due': return 'danger';
    default: return 'pending';
  }
};

const OrganizationCourses: React.FC<OrganizationCoursesProps> = ({
  courses,
  onUploadStudentsClick,
}) => {
  const [studentDialogOpen, setStudentDialogOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [courseTypeFilter, setCourseTypeFilter] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportCSV = async () => {
    try {
      setExportError(null);
      const response = await api.get('/organization/courses/export/csv', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `courses-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setExportError('Failed to export courses'); }
  };

  const filteredCourses = courses.filter(course => {
    const matchesSearch = searchTerm === '' ||
      course.courseTypeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      course.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      course.instructor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      course.notes?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === '' || course.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesCourseType = courseTypeFilter === '' || course.courseTypeName.toLowerCase() === courseTypeFilter.toLowerCase();
    return matchesSearch && matchesStatus && matchesCourseType;
  });

  const courseTypes = Array.from(
    new Set(courses.map(course => course.courseTypeName).filter((type): type is string => typeof type === 'string' && !!type))
  ).sort();

  const isUploadDisabled = (course: Course) => {
    if (['completed', 'cancelled'].includes(course.status?.toLowerCase())) return true;
    if (course.confirmedDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const classDate = new Date(course.confirmedDate); classDate.setHours(0, 0, 0, 0);
      return classDate <= today;
    }
    return false;
  };

  const getUploadTooltip = (course: Course) => {
    if (['completed', 'cancelled'].includes(course.status?.toLowerCase())) return `Cannot upload — course is ${course.status?.toLowerCase()}`;
    if (course.confirmedDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const classDate = new Date(course.confirmedDate); classDate.setHours(0, 0, 0, 0);
      if (classDate < today) return 'Cannot upload — class has already occurred';
      if (classDate.getTime() === today.getTime()) return "Cannot upload — it's the day of the class";
    }
    return 'Upload Student List (CSV)';
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {exportError && <Alert severity="error" onClose={() => setExportError(null)}>{exportError}</Alert>}

      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Filters ({filteredCourses.length} of {courses.length})
          </Typography>
          <GhostButton onClick={handleExportCSV}>Export CSV</GhostButton>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          <TextField fullWidth label="Search courses..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} size="small" />
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="confirmed">Confirmed</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Course Type</InputLabel>
            <Select label="Course Type" value={courseTypeFilter} onChange={(e) => setCourseTypeFilter(e.target.value)}>
              <MenuItem value="">All Types</MenuItem>
              {courseTypes.map(type => <MenuItem key={type} value={type.toLowerCase ? type.toLowerCase() : type}>{type}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Table */}
      {filteredCourses.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>
            {courses.length === 0 ? 'No courses found' : 'No courses match your filters'}
          </Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={filteredCourses.length} totalCount={courses.length}>
          {filteredCourses.map((course) => {
            const uploadDisabled = isUploadDisabled(course);
            const uploadTooltip = getUploadTooltip(course);
            return (
              <DataTableRow key={course.id} columns={columns}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.requestSubmittedDate && !isNaN(new Date(course.requestSubmittedDate).getTime()) ? formatDisplayDate(course.requestSubmittedDate) : 'N/A'}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.scheduledDate ? formatDisplayDate(course.scheduledDate) : '—'}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.courseTypeName}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{course.registeredStudents || 0}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right' }}>{course.studentsAttended || 0}</Typography>
                <StatusChip kind={getStatusKind(course.status)} label={course.status.charAt(0).toUpperCase() + course.status.slice(1).replace('_', ' ')} />
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.instructor || 'TBD'}</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
                  <Tooltip title={uploadTooltip}>
                    <Box
                      onClick={() => !uploadDisabled && onUploadStudentsClick && onUploadStudentsClick(course.id)}
                      sx={{ fontSize: 12, fontWeight: 600, color: uploadDisabled ? (theme) => theme.palette.text.secondary : '#CC1F1F', cursor: uploadDisabled ? 'default' : 'pointer', '&:hover': uploadDisabled ? {} : { textDecoration: 'underline' } }}
                    >Upload</Box>
                  </Tooltip>
                  <LinkButton onClick={() => handleViewStudentsClick(course)} aria-label={`View students for ${course.courseTypeName}`}>Students</LinkButton>
                </Box>
              </DataTableRow>
            );
          })}
        </DataTable>
      )}

      {/* Student Dialog */}
      <Dialog open={studentDialogOpen} onClose={handleCloseStudentDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Students — {selectedCourse?.courseTypeName}
        </DialogTitle>
        <DialogContent>
          {loadingStudents ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
          ) : studentError ? (
            <Alert severity="error">{studentError}</Alert>
          ) : students.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, p: 2 }}>No students have been uploaded for this course yet.</Typography>
          ) : (
            <DataTable columns={studentColumns} shownCount={students.length} totalCount={students.length}>
              {students.map((student) => (
                <DataTableRow key={student.id} columns={studentColumns}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{student.firstName} {student.lastName}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{student.email}</Typography>
                  {student.attendanceMarked ? (
                    <StatusChip kind={student.attended ? 'success' : 'danger'} label={student.attended ? 'Attended' : 'No Show'} />
                  ) : (
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>—</Typography>
                  )}
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

export default OrganizationCourses;
