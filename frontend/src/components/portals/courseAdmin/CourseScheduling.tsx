import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { api } from '../../../services/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { formatDisplayDate, toLocalDateString, parseLocalDate } from '../../../utils/formatters';
import LinkButton from '../../gtacpr/LinkButton';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';

interface Course {
  id: number;
  courseType: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  organization: string;
  status: string;
  instructor?: string;
  registeredStudents?: number;
}

const columns = [
  { key: 'date', label: 'DATE', width: '0.8fr' },
  { key: 'course', label: 'COURSE NAME', width: '1.2fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'instructor', label: 'INSTRUCTOR', width: '1fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

const CourseScheduling = () => {
  const [error, setError] = useState<string | null>(null);
  const { showSuccess, showError } = useSnackbar();
  const queryClient = useQueryClient();
  const [instructorFilter, setInstructorFilter] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<Date | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [courseToCancel, setCourseToCancel] = useState<Course | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => {
      const response = await api.get('/courses/confirmed');
      return response.data.data;
    },
    refetchInterval: 60000,
  });

  const uniqueInstructors = useMemo((): string[] => {
    const instructors = courses.map((c: Record<string, unknown>) => c.instructorName as string).filter((n: string | undefined): n is string => !!n && n !== 'Not Assigned');
    return Array.from(new Set<string>(instructors)).sort();
  }, [courses]);

  const uniqueOrganizations = useMemo((): string[] => {
    const orgs = courses.map((c: Record<string, unknown>) => c.organizationName as string).filter((n: string | undefined): n is string => !!n);
    return Array.from(new Set<string>(orgs)).sort();
  }, [courses]);

  const filteredCourses = useMemo(() => {
    return courses.filter((course: Record<string, unknown>) => {
      if (instructorFilter && course.instructorName !== instructorFilter) return false;
      if (organizationFilter && course.organizationName !== organizationFilter) return false;
      if (dateFilter) {
        const courseDate = new Date(course.scheduledDate as string);
        if (courseDate.toDateString() !== dateFilter.toDateString()) return false;
      }
      return true;
    });
  }, [courses, instructorFilter, organizationFilter, dateFilter]);

  const hasActiveFilters = instructorFilter || organizationFilter || dateFilter;

  const clearFilters = () => { setInstructorFilter(''); setOrganizationFilter(''); setDateFilter(null); };

  const handleCancelClick = (course: Course) => { setCourseToCancel(course); setCancelReason(''); setCancelDialogOpen(true); };
  const handleCancelClose = () => { setCancelDialogOpen(false); setCourseToCancel(null); setCancelReason(''); };

  const handleCancelSubmit = async () => {
    if (!courseToCancel || !cancelReason.trim()) { showError('Please provide a reason for cancellation'); return; }
    if (isCancelling) return; // guard against a second click while the request is in flight
    setIsCancelling(true);
    try {
      await api.put(`/courses/${courseToCancel.id}/cancel`, { reason: cancelReason });
      showSuccess('Course cancelled successfully');
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      handleCancelClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      showError(axiosErr.response?.data?.error?.message || 'Failed to cancel course');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Filters
            {hasActiveFilters ? ` (${filteredCourses.length} of ${courses.length})` : ''}
          </Typography>
          {hasActiveFilters && <GhostButton onClick={clearFilters}>Clear Filters</GhostButton>}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Instructor</InputLabel>
            <Select value={instructorFilter} onChange={(e) => setInstructorFilter(e.target.value)} label="Instructor">
              <MenuItem value="">All Instructors</MenuItem>
              {uniqueInstructors.map((i) => <MenuItem key={i} value={i}>{i}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Organization</InputLabel>
            <Select value={organizationFilter} onChange={(e) => setOrganizationFilter(e.target.value)} label="Organization">
              <MenuItem value="">All Organizations</MenuItem>
              {uniqueOrganizations.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Date" type="date" value={dateFilter ? toLocalDateString(dateFilter) : ''} onChange={(e) => setDateFilter(e.target.value ? parseLocalDate(e.target.value) : null)} InputLabelProps={{ shrink: true }} fullWidth size="small" />
        </Box>
      </Box>

      {/* Courses Table */}
      {filteredCourses.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>
            {hasActiveFilters ? 'No courses match the selected filters' : 'No courses found'}
          </Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={filteredCourses.length} totalCount={courses.length}>
          {filteredCourses.map((course: Record<string, unknown>) => (
            <DataTableRow key={course.id as number} columns={columns}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{formatDisplayDate(course.scheduledDate as string)}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{(course.courseTypeName || course.courseType || '—') as string}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationName as string}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location as string}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{(course.instructorName || 'Not Assigned') as string}</Typography>
              <StatusChip kind="active" label={course.status as string} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <LinkButton tone="danger" onClick={() => handleCancelClick(course as unknown as Course)}>Cancel</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onClose={isCancelling ? undefined : handleCancelClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Cancel Course</DialogTitle>
        <DialogContent>
          <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}`, mb: 2, mt: 1 }}>
            {[
              ['Course', courseToCancel?.courseType],
              ['Organization', courseToCancel?.organization],
              ['Location', courseToCancel?.location],
              ['Students', courseToCancel?.registeredStudents || 0],
            ].map(([l, v]) => (
              <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 100 }}>{l}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 13, color: '#CC1F1F', mb: 2 }}>Are you sure you want to cancel this course? This action cannot be undone.</Typography>
          <TextField label="Reason for Cancellation" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} fullWidth multiline rows={4} required placeholder="Please provide a detailed reason..." />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleCancelClose} disabled={isCancelling}>Keep Course</GhostButton>
          <PrimaryButton onClick={handleCancelSubmit} disabled={!cancelReason.trim() || isCancelling}>{isCancelling ? 'Cancelling…' : 'Cancel Course'}</PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CourseScheduling;
