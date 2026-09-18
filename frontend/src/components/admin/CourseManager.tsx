import React, { useState, useEffect } from 'react';
import { Box, Typography, CircularProgress, Alert, ButtonBase } from '@mui/material';
import { api } from '../../services/api';
import logger from '../../utils/logger';
import CourseDialog from './CourseDialog';
import { formatDisplayDate } from '../../utils/dateUtils';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton } from '../gtacpr/Buttons';
import { useConfirm } from '../gtacpr/ConfirmDialog';

interface Course {
  id: number;
  name: string;
  coursecode: string;
  duration: number;
  maxstudents: number;
  createdAt: string;
  updatedAt: string;
}

interface CourseManagerProps {
  showSnackbar: (message: string, severity: 'success' | 'error') => void;
}

const columns = [
  { key: 'name', label: 'COURSE NAME', width: '1.6fr' },
  { key: 'code', label: 'CODE', width: '0.8fr' },
  { key: 'duration', label: 'DURATION', width: '0.8fr' },
  { key: 'max', label: 'MAX STUDENTS', width: '0.8fr' },
  { key: 'created', label: 'CREATED', width: '1fr' },
  { key: 'updated', label: 'UPDATED', width: '1fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

const CourseManager: React.FC<CourseManagerProps> = ({ showSnackbar }) => {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const response = await api.get('/sysadmin/courses');
      setCourses(response.data.data || []);
      setError(null);
    } catch (err: any) {
      logger.error('Error fetching courses:', err);
      setError('Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCourses(); }, []);

  const handleAddOpen = () => { setEditingCourse(null); setDialogOpen(true); };
  const handleEditOpen = (course: Course) => { setEditingCourse(course); setDialogOpen(true); };

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: 'Delete course?',
      message: `"${name}" will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      try {
        setError(null);
        const response = await api.delete(`/sysadmin/courses/${id}`);
        if (response.data.success) {
          showSnackbar(`Course deleted successfully.`, 'success');
          fetchCourses();
        } else {
          throw new Error(response.data.message || 'Failed to delete course');
        }
      } catch (err: any) {
        logger.error(`Error deleting course ${id}:`, err);
        showSnackbar(err instanceof Error ? err.message : 'Failed to delete course.', 'error');
      }
    }
  };

  const handleSave = async (courseData: Omit<Course, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingCourse) {
        await api.put(`/sysadmin/courses/${editingCourse.id}`, courseData);
        showSnackbar('Course updated successfully', 'success');
      } else {
        await api.post('/sysadmin/courses', courseData);
        showSnackbar('Course created successfully', 'success');
      }
      fetchCourses();
    } catch (err: any) {
      logger.error('Error saving course:', err);
      showSnackbar(err instanceof Error ? err.message : 'Failed to save course', 'error');
      throw err;
    }
  };

  const formatDuration = (mins: number) => {
    if (!mins) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryButton onClick={handleAddOpen}>+ Add Course</PrimaryButton>
      </Box>

      {courses.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No courses found.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={courses.length} totalCount={courses.length}>
          {courses.map(course => (
            <DataTableRow key={course.id} columns={columns}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.name}</Typography>
              <Typography sx={{ fontSize: 12.5, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>{course.coursecode}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDuration(course.duration)}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.maxstudents}</Typography>
              <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(course.createdAt)}</Typography>
              <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(course.updatedAt)}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                <ButtonBase onClick={() => handleEditOpen(course)} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>Edit</ButtonBase>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                <ButtonBase onClick={() => handleDelete(course.id, course.name)} sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, '&:hover': { textDecoration: 'underline', color: '#CC1F1F' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>Delete</ButtonBase>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <CourseDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingCourse(null); }} onSave={handleSave as any} course={editingCourse || undefined} />
      {confirmDialog}
    </Box>
  );
};

export default CourseManager;
