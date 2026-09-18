import { toLocalDateString } from '../../utils/formatters';
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Visibility as VisibilityIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { timesheetService, Timesheet } from '../../services/timesheetService';

interface TimesheetHistoryProps {
  onRefresh?: () => void;
}

interface CourseDetail {
  date: string;
  startTime?: string;
  endTime?: string;
  organizationName?: string;
  location?: string;
  courseType: string;
  studentCount?: number;
  status?: string;
}

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

const TimesheetHistory: React.FC<TimesheetHistoryProps> = ({ onRefresh }) => {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimesheet, setSelectedTimesheet] = useState<Timesheet | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadTimesheets = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await timesheetService.getTimesheets();
      setTimesheets(response.timesheets || []);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(errObj.response?.data?.message || errObj.message || 'Failed to load timesheets');
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTimesheets();
  }, []);

  const handleViewDetails = (timesheet: Timesheet) => {
    setSelectedTimesheet(timesheet);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedTimesheet(null);
  };

  const handleRefresh = () => {
    loadTimesheets();
    if (onRefresh) {
      onRefresh();
    }
  };

  const getStatusColor = (status: string): ChipColor => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatWeekRange = (weekStartDate: string) => {
    const start = new Date(weekStartDate);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    
    return `${formatDate(weekStartDate)} - ${formatDate(toLocalDateString(end))}`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <AssignmentIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6" component="h2">
              Timesheet History
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <AssignmentIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6" component="h2">
              Timesheet History
            </Typography>
          </Box>
          <Button
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={loading}
            size="small"
          >
            Refresh
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {timesheets.length === 0 ? (
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body1" color="textSecondary">
              No timesheets submitted yet.
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              Submit your first timesheet using the form above.
            </Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Week Period</TableCell>
                  <TableCell>Hours</TableCell>
                  <TableCell>Courses</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Submitted</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {timesheets.map((timesheet) => (
                  <TableRow key={timesheet.id}>
                    <TableCell>
                      <Typography variant="body2">
                        {formatWeekRange(timesheet.weekStartDate)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {timesheet.totalHours} hours
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {timesheet.coursesTaught} courses
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={timesheet.status.toUpperCase()}
                        color={getStatusColor(timesheet.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(timesheet.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Button
                        startIcon={<VisibilityIcon />}
                        onClick={() => handleViewDetails(timesheet)}
                        size="small"
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Timesheet Details Dialog */}
        <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
          <DialogTitle>
            Timesheet Details - {selectedTimesheet && formatWeekRange(selectedTimesheet.weekStartDate)}
          </DialogTitle>
          <DialogContent>
            {selectedTimesheet && (
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Week Period
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {formatWeekRange(selectedTimesheet.weekStartDate)}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Status
                  </Typography>
                  <Chip
                    label={selectedTimesheet.status.toUpperCase()}
                    color={getStatusColor(selectedTimesheet.status)}
                    sx={{ mt: 0.5 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Total Hours
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {selectedTimesheet.totalHours} hours
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Courses Taught
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {selectedTimesheet.coursesTaught} courses
                  </Typography>
                </Grid>
                {selectedTimesheet.courseDetails && selectedTimesheet.courseDetails.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 2 }}>
                      Course Details
                    </Typography>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Time</TableCell>
                            <TableCell>Organization</TableCell>
                            <TableCell>Location</TableCell>
                            <TableCell>Course Type</TableCell>
                            <TableCell>Students</TableCell>
                            <TableCell>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {selectedTimesheet.courseDetails.map((course: CourseDetail, index: number) => (
                            <TableRow key={index}>
                              <TableCell>{formatDate(course.date)}</TableCell>
                              <TableCell>
                                {course.startTime && course.endTime
                                  ? `${course.startTime} - ${course.endTime}`
                                  : 'TBD'
                                }
                              </TableCell>
                              <TableCell>{course.organizationName || 'TBD'}</TableCell>
                              <TableCell>{course.location || 'TBD'}</TableCell>
                              <TableCell>{course.courseType}</TableCell>
                              <TableCell>{course.studentCount ?? '-'}</TableCell>
                              <TableCell>
                                {course.status ? (
                                  <Chip
                                    label={course.status}
                                    color={course.status === 'completed' ? 'success' : 'primary'}
                                    size="small"
                                  />
                                ) : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Grid>
                )}
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Notes
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {selectedTimesheet.notes || 'No notes provided'}
                  </Typography>
                </Grid>
                {selectedTimesheet.hrComment && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="textSecondary">
                      HR Comment
                    </Typography>
                    <Typography variant="body1" gutterBottom>
                      {selectedTimesheet.hrComment}
                    </Typography>
                  </Grid>
                )}
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Submitted
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {formatDate(selectedTimesheet.createdAt)}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Last Updated
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {formatDate(selectedTimesheet.updatedAt)}
                  </Typography>
                </Grid>
              </Grid>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Close</Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default TimesheetHistory; 