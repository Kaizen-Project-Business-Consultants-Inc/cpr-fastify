import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Divider,
} from '@mui/material';
import {
  Person as PersonIcon,
  Email as EmailIcon,
  CheckCircle as PresentIcon,
  Cancel as AbsentIcon,
  HelpOutline as NotMarkedIcon,
} from '@mui/icons-material';
import { adminApi, instructorApi } from '../../services/api';
import logger from '../../utils/logger';
import { useAuth } from '../../contexts/AuthContext';

interface Student {
  id: number;
  courseRequestId: number;
  firstName: string;
  lastName: string;
  email?: string;
  attended?: boolean;
  attendanceMarked?: boolean;
  createdAt?: string;
}

interface AdminViewStudentsDialogProps {
  open: boolean;
  onClose: () => void;
  courseId: number | null;
  courseInfo?: {
    courseType?: string;
    organizationName?: string;
    location?: string;
  };
}

const AdminViewStudentsDialog: React.FC<AdminViewStudentsDialogProps> = ({
  open,
  onClose,
  courseId,
  courseInfo,
}) => {
  const { user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && courseId) {
      const fetchStudents = async () => {
        setLoading(true);
        setError('');
        try {
          logger.info(`[${user?.role || 'User'}] Fetching students for course: ${courseId}`);
          
          // Use appropriate API based on user role
          let response;
          if (user?.role === 'instructor') {
            response = await instructorApi.getClassStudents(courseId);
          } else {
            response = await adminApi.getCourseStudents(courseId);
          }
          
          const studentsData = response.data?.data || response.data || [];
          logger.info(
            `[${user?.role || 'User'}] Successfully fetched ${studentsData.length} students for course: ${courseId}`
          );
          setStudents(studentsData);
        } catch (err: unknown) {
          logger.error(`[${user?.role || 'User'}] Failed to fetch students:`, err);
          const errObj = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
          setError(
            errObj.response?.data?.error?.message ||
              errObj.message ||
              'Failed to fetch students'
          );
        } finally {
          setLoading(false);
        }
      };
      fetchStudents();
    }
  }, [open, courseId, user?.role]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const getAttendanceChip = (student: Student) => {
    if (!student.attendanceMarked) {
      return (
        <Chip
          icon={<NotMarkedIcon />}
          label='Not Marked'
          size='small'
          color='default'
          variant='outlined'
        />
      );
    }

    if (student.attended) {
      return (
        <Chip
          icon={<PresentIcon />}
          label='Present'
          size='small'
          color='success'
        />
      );
    } else {
      return (
        <Chip icon={<AbsentIcon />} label='Absent' size='small' color='error' />
      );
    }
  };

  // Calculate attendance statistics
  const attendanceStats = students.reduce(
    (stats, student) => {
      if (student.attendanceMarked) {
        stats.marked++;
        if (student.attended) {
          stats.present++;
        } else {
          stats.absent++;
        }
      } else {
        stats.notMarked++;
      }
      return stats;
    },
    { present: 0, absent: 0, notMarked: 0, marked: 0 }
  );

  const attendanceRate =
    attendanceStats.marked > 0
      ? Math.round((attendanceStats.present / attendanceStats.marked) * 100)
      : 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PersonIcon color='primary' />
          <Typography variant='h6'>Course Student List</Typography>
          {students.length > 0 && (
            <Chip
              label={`${students.length} Students`}
              color='primary'
              size='small'
            />
          )}
        </Box>
        {courseInfo && (
          <Typography variant='body2' color='text.secondary' sx={{ mt: 1 }}>
            {courseInfo.courseType} - {courseInfo.organizationName} -{' '}
            {courseInfo.location}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
            <Typography variant='body2' sx={{ ml: 2 }}>
              Loading student list...
            </Typography>
          </Box>
        )}
        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!loading && !error && students.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant='h6' color='text.secondary' gutterBottom>
              No students enrolled
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              The organization has not uploaded a student list for this course
              yet.
            </Typography>
          </Box>
        )}
        {!loading && !error && students.length > 0 && (
          <Box>
            {/* Attendance Summary */}
            <Box
              sx={{
                mb: 2,
                p: 2,
                bgcolor: 'background.default',
                borderRadius: 1,
              }}
            >
              <Typography variant='subtitle2' gutterBottom>
                Attendance Summary
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Chip
                  label={`Present: ${attendanceStats.present}`}
                  color='success'
                  size='small'
                />
                <Chip
                  label={`Absent: ${attendanceStats.absent}`}
                  color='error'
                  size='small'
                />
                <Chip
                  label={`Not Marked: ${attendanceStats.notMarked}`}
                  color='default'
                  size='small'
                />
              </Box>
              {attendanceStats.marked > 0 && (
                <Typography
                  variant='body2'
                  color='text.secondary'
                  sx={{ mt: 1 }}
                >
                  Attendance Rate: {attendanceRate}% ({attendanceStats.present}{' '}
                  of {attendanceStats.marked} marked students)
                </Typography>
              )}
            </Box>

            <List sx={{ maxHeight: 400, overflow: 'auto' }}>
              {students.map((student, index) => (
                <React.Fragment key={student.id || index}>
                  <ListItem>
                    <ListItemIcon>
                      <PersonIcon color='primary' />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <Typography variant='body1' fontWeight='medium'>
                            {student.firstName} {student.lastName}
                          </Typography>
                          {getAttendanceChip(student)}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5 }}>
                          {student.email && (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                mb: 0.5,
                              }}
                            >
                              <EmailIcon fontSize='small' color='action' />
                              <Typography
                                variant='body2'
                                color='text.secondary'
                              >
                                {student.email}
                              </Typography>
                            </Box>
                          )}
                          {student.createdAt && (
                            <Typography
                              variant='caption'
                              color='text.secondary'
                            >
                              Added: {formatDate(student.createdAt)}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                  {index < students.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant='contained'>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AdminViewStudentsDialog;
