import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Chip,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Add as AddIcon,
  Event as EventIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { timesheetService, TimesheetSubmission as TimesheetSubmissionData, WeekCourses, Timesheet } from '../../services/timesheetService';
import { useAuth } from '../../contexts/AuthContext';

interface TimesheetSubmissionProps {
  onTimesheetSubmitted?: () => void;
}

const TimesheetSubmission: React.FC<TimesheetSubmissionProps> = ({ onTimesheetSubmitted }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState<TimesheetSubmissionData>({
    weekStartDate: '',
    totalHours: 0,
    coursesTaught: 0,
    notes: '',
    travelTime: 0,
    prepTime: 0,
  });
  const [weekCourses, setWeekCourses] = useState<WeekCourses | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existingTimesheet, setExistingTimesheet] = useState<Timesheet | undefined>(undefined);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [teachingHours, setTeachingHours] = useState(0);
  const [isLateSubmission, setIsLateSubmission] = useState(false);
  const [availableWeeks, setAvailableWeeks] = useState<{ value: string; label: string; isLate: boolean }[]>([]);

  // Pure date helpers — stable across renders so they can safely sit in effect dep arrays.
  const formatDateString = useCallback((date: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }, []);

  const formatDateShort = useCallback((dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const getPreviousWeekStart = useCallback(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Get to this Monday
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysToSubtract);

    // Go back one more week to get previous Monday
    const previousMonday = new Date(thisMonday);
    previousMonday.setDate(thisMonday.getDate() - 7);

    return formatDateString(previousMonday);
  }, [formatDateString]);

  const getWeekStartByOffset = useCallback((weeksAgo: number) => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysToSubtract);

    const targetMonday = new Date(thisMonday);
    targetMonday.setDate(thisMonday.getDate() - (weeksAgo * 7));

    return formatDateString(targetMonday);
  }, [formatDateString]);

  const checkExistingTimesheet = useCallback(async (weekStartDate: string) => {
    setCheckingExisting(true);
    try {
      const response = await timesheetService.getTimesheets();
      const existing = response.timesheets.find(ts =>
        ts.weekStartDate === weekStartDate ||
        ts.weekStartDate.startsWith(weekStartDate)
      );
      setExistingTimesheet(existing);
    } catch (err) {
      console.error('Error checking existing timesheet:', err);
    } finally {
      setCheckingExisting(false);
    }
  }, []);

  // Generate available weeks (previous week + up to 4 past weeks for late submissions)
  useEffect(() => {
    const weeks: { value: string; label: string; isLate: boolean }[] = [];

    // Get previous week's Monday (the default submission week)
    const previousMonday = getPreviousWeekStart();

    // Add previous week (not late)
    weeks.push({
      value: previousMonday,
      label: `Week of ${formatDateShort(previousMonday)} (Previous Week)`,
      isLate: false,
    });

    // Add up to 4 more past weeks (late submissions)
    for (let i = 1; i <= 4; i++) {
      const pastMonday = getWeekStartByOffset(i + 1);
      weeks.push({
        value: pastMonday,
        label: `Week of ${formatDateShort(pastMonday)} (Late)`,
        isLate: true,
      });
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initializes state from a pure computation on mount, not derived from render
    setAvailableWeeks(weeks);

    // Default to previous week
    setFormData(prev => ({
      ...prev,
      weekStartDate: previousMonday,
    }));
    setIsLateSubmission(false);

    // Check if timesheet already exists for this week
    checkExistingTimesheet(previousMonday);
  }, [getPreviousWeekStart, formatDateShort, getWeekStartByOffset, checkExistingTimesheet]);

  const handleChange = (field: keyof TimesheetSubmissionData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = ['totalHours', 'coursesTaught', 'travelTime', 'prepTime'].includes(field)
      ? parseFloat(event.target.value) || 0
      : event.target.value;

    setFormData(prev => {
      const updated = { ...prev, [field]: value };

      // Recalculate total hours when travel or prep time changes
      if (field === 'travelTime' || field === 'prepTime') {
        updated.totalHours = teachingHours + (updated.travelTime || 0) + (updated.prepTime || 0);
      }

      return updated;
    });

    // Clear messages on change
    setError(null);
    setSuccess(null);
  };

  const handleWeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedWeek = event.target.value;
    const weekInfo = availableWeeks.find(w => w.value === selectedWeek);

    setFormData(prev => ({ ...prev, weekStartDate: selectedWeek }));
    setIsLateSubmission(weekInfo?.isLate || false);
    checkExistingTimesheet(selectedWeek);
  };

  const calculateTeachingHours = useCallback((courses: WeekCourses['courses']) => {
    let totalMinutes = 0;
    courses.filter(c => c.status === 'completed').forEach(course => {
      if (course.startTime && course.endTime) {
        const [startHour, startMin] = course.startTime.split(':').map(Number);
        const [endHour, endMin] = course.endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        if (endMinutes > startMinutes) {
          totalMinutes += endMinutes - startMinutes;
        }
      }
    });
    return Math.round((totalMinutes / 60) * 10) / 10; // Round to 1 decimal
  }, []);

  const fetchWeekCourses = useCallback(async (weekStartDate: string) => {
    setLoadingCourses(true);
    try {
      const courses = await timesheetService.getWeekCourses(weekStartDate);
      setWeekCourses(courses);

      // Auto-populate courses taught (only count completed courses)
      const completedCourses = courses.courses.filter(c => c.status === 'completed');
      const completedCount = completedCourses.length;

      // Calculate teaching hours from course times
      const calculatedTeachingHours = calculateTeachingHours(courses.courses);
      setTeachingHours(calculatedTeachingHours);

      // Update form with auto-calculated values
      setFormData(prev => ({
        ...prev,
        coursesTaught: completedCount,
        totalHours: calculatedTeachingHours + (prev.travelTime || 0) + (prev.prepTime || 0),
      }));
    } catch (err) {
      console.error('Error fetching week courses:', err);
      setWeekCourses(null);
      setTeachingHours(0);
      setFormData(prev => ({ ...prev, coursesTaught: 0, totalHours: 0 }));
    } finally {
      setLoadingCourses(false);
    }
  }, [calculateTeachingHours]);

  // Fetch courses when week start date changes — a data fetch driven by the
  // (external) selected week, not state derived from render.
  useEffect(() => {
    if (formData.weekStartDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchWeekCourses(formData.weekStartDate);
    } else {
      setWeekCourses(null);
      setFormData(prev => ({ ...prev, coursesTaught: 0 }));
    }
  }, [formData.weekStartDate, fetchWeekCourses]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.weekStartDate) {
      setError('Week start date is required');
      return;
    }

    const status = getSubmissionStatus();
    if (!status.canSubmit) {
      setError(status.message);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Include teachingHours and isLate in submission
      const submissionData = {
        ...formData,
        teachingHours,
        isLate: isLateSubmission,
      };

      await timesheetService.submitTimesheet(submissionData);

      const successMsg = isLateSubmission
        ? 'Late timesheet submitted successfully! HR will review it.'
        : 'Timesheet submitted successfully! HR will review and approve it.';
      setSuccess(successMsg);

      // Reset form to previous week
      const previousWeekStart = getPreviousWeekStart();
      setFormData({
        weekStartDate: previousWeekStart,
        totalHours: 0,
        coursesTaught: 0,
        notes: '',
        travelTime: 0,
        prepTime: 0,
      });
      setWeekCourses(null);
      setTeachingHours(0);
      setIsLateSubmission(false);

      // Notify parent component
      if (onTimesheetSubmitted) {
        onTimesheetSubmitted();
      }
    } catch (err: unknown) {
      // Handle specific error cases with user-friendly messages
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage = errObj.response?.data?.message || errObj.message || 'Failed to submit timesheet';

      if (errorMessage.includes('already exists for this week')) {
        setError('You have already submitted a timesheet for this week. You can view or update your existing timesheet in the timesheet history.');
      } else if (errorMessage.includes('Week start date must be a Monday')) {
        setError('The week start date must be a Monday. Please contact support if you see this error.');
      } else if (errorMessage.includes('until the week has ended')) {
        setError('Cannot submit timesheet until the week has ended. Please wait until after Sunday.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return 'N/A';
    // Parse the date string as local time to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getSubmissionStatus = () => {
    if (!formData.weekStartDate) return { canSubmit: false, message: 'Loading...', isLate: false };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [year, month, day] = formData.weekStartDate.split('-').map(Number);
    const weekStart = new Date(year, month - 1, day);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    // Get previous week's Monday
    const previousWeekStart = getPreviousWeekStart();
    const [py, pm, pd] = previousWeekStart.split('-').map(Number);
    const prevWeekDate = new Date(py, pm - 1, pd);

    if (today < weekEnd) {
      return { canSubmit: false, message: 'Week has not ended yet - submit after the week ends', isLate: false };
    } else if (weekStart.getTime() === prevWeekDate.getTime()) {
      return { canSubmit: true, message: 'Ready to submit for previous week', isLate: false };
    } else if (weekStart < prevWeekDate) {
      return { canSubmit: true, message: 'Late submission - will be flagged for HR review', isLate: true };
    } else {
      return { canSubmit: false, message: 'Cannot submit for future weeks', isLate: false };
    }
  };

  const submissionStatus = getSubmissionStatus();

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <AssignmentIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" component="h2">
            Submit Timesheet
          </Typography>
        </Box>

        {error && (
          <Alert 
            severity="error" 
            sx={{ mb: 2 }}
            action={
              error.includes('already submitted a timesheet for this week') ? (
                <Button 
                  color="inherit" 
                  size="small" 
                  onClick={() => {
                    // This could navigate to timesheet history or trigger a callback
                    if (onTimesheetSubmitted) {
                      onTimesheetSubmitted();
                    }
                  }}
                >
                  View Timesheets
                </Button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        )}

        {existingTimesheet && !checkingExisting && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  if (onTimesheetSubmitted) {
                    onTimesheetSubmitted();
                  }
                }}
              >
                View Timesheets
              </Button>
            }
          >
            You have already submitted a timesheet for this week (Week of {formatDate(existingTimesheet.weekStartDate)}).
            You can view or update your existing timesheet in the timesheet history.
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {isLateSubmission && (
          <Alert severity="warning" sx={{ mb: 2 }} icon={<WarningIcon />}>
            <strong>Late Submission:</strong> This timesheet is for a past week and will be flagged for HR review.
          </Alert>
        )}

        <Paper sx={{ p: 3 }}>
          <Box component="form" onSubmit={handleSubmit}>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  select
                  label="Select Week"
                  value={formData.weekStartDate}
                  onChange={handleWeekChange}
                  disabled={loading}
                  SelectProps={{ native: true }}
                  helperText="Select the week to submit timesheet for"
                >
                  {availableWeeks.map((week) => (
                    <option key={week.value} value={week.value}>
                      {week.label}
                    </option>
                  ))}
                </TextField>
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Courses Taught"
                  type="number"
                  value={formData.coursesTaught}
                  disabled={true}
                  inputProps={{ min: 0 }}
                  helperText="Auto-calculated from completed courses"
                />
              </Grid>

              {/* Hours Breakdown */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                  Hours Breakdown
                </Typography>
                <Divider sx={{ mb: 2 }} />
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Teaching Hours"
                  type="number"
                  value={teachingHours}
                  disabled={true}
                  inputProps={{ min: 0, step: 0.5 }}
                  helperText="Auto-calculated from course times"
                />
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Travel Time (hours)"
                  type="number"
                  value={formData.travelTime || 0}
                  onChange={handleChange('travelTime')}
                  disabled={loading}
                  inputProps={{ min: 0, step: 0.5 }}
                  helperText="Time spent traveling to/from courses"
                />
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Prep Time (hours)"
                  type="number"
                  value={formData.prepTime || 0}
                  onChange={handleChange('prepTime')}
                  disabled={loading}
                  inputProps={{ min: 0, step: 0.5 }}
                  helperText="Time spent preparing for courses"
                />
              </Grid>

              <Grid item xs={12}>
                <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                  <Typography variant="body1">
                    <strong>Total Hours:</strong> {formData.totalHours} hours
                    <Typography variant="caption" color="textSecondary" sx={{ ml: 2 }}>
                      (Teaching: {teachingHours} + Travel: {formData.travelTime || 0} + Prep: {formData.prepTime || 0})
                    </Typography>
                  </Typography>
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Notes"
                  multiline
                  rows={3}
                  value={formData.notes}
                  onChange={handleChange('notes')}
                  disabled={loading}
                  helperText="Additional notes about your work this week (optional)"
                  placeholder="Describe any special circumstances, extra work, or important details..."
                />
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="body2" color="textSecondary">
                      Submitted by: {user?.username || 'Instructor'}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Status: <Chip label={isLateSubmission ? "LATE" : "PENDING"} color={isLateSubmission ? "error" : "warning"} size="small" />
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                      {submissionStatus.message}
                    </Typography>
                  </Box>
                  
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={loading ? <CircularProgress size={20} /> : <AddIcon />}
                    disabled={loading || !submissionStatus.canSubmit || !!existingTimesheet}
                    size="large"
                  >
                    {loading ? 'Submitting...' : existingTimesheet ? 'Timesheet Already Submitted' : 'Submit Timesheet'}
                  </Button>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Paper>

        {/* Week Courses Section */}
        {formData.weekStartDate && (
          <Paper sx={{ p: 3, mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <EventIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" component="h3">
                Completed Courses for Week of {formatDate(formData.weekStartDate)}
              </Typography>
            </Box>

            {loadingCourses ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : weekCourses ? (
              <Box>
                {weekCourses.courses.filter(c => c.status === 'completed').length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Organization</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Course Type</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {weekCourses.courses
                          .filter(course => course.status === 'completed')
                          .map((course) => (
                          <TableRow key={course.id} hover>
                            <TableCell>{formatDate(course.date)}</TableCell>
                            <TableCell>{course.organizationName}</TableCell>
                            <TableCell>{course.location || 'TBD'}</TableCell>
                            <TableCell>{course.courseType}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">
                    No completed courses for this week.
                  </Alert>
                )}
              </Box>
            ) : (
              <Alert severity="warning">
                Unable to load courses for this week. Please try again.
              </Alert>
            )}
          </Paper>
        )}

        <Divider sx={{ my: 2 }} />
        
        <Box>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            Timesheet Guidelines:
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            • Submit one timesheet per week (Monday to Sunday)
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            • Week start date is automatically set to Monday of the current week
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            • You can submit your timesheet any day from Monday to Sunday of the week
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            • Courses taught is automatically calculated from your scheduled courses
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            • Include all hours worked, including preparation and travel time
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            • HR will review and approve your timesheet within 2-3 business days
          </Typography>
          <Typography variant="body2" color="textSecondary">
            • You'll be notified when your timesheet is approved or if changes are needed
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default TimesheetSubmission; 