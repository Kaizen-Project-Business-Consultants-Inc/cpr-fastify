import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  LinearProgress,
  Avatar,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  Assessment as AssessmentIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CompletedIcon,
  CalendarToday as CalendarIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { fetchCourseAdminDashboardData } from '../../../services/api';
import { toLocalDateString, formatDisplayDate } from '../../../utils/formatters';

/** "YYYY-MM" for a Date in local time (no UTC shift). */
const toLocalMonthString = (d: Date) => toLocalDateString(d).slice(0, 7);

interface InstructorStats {
  instructorId: number;
  instructorName: string;
  email: string;
  coursesCompleted: number;
  coursesScheduled: number;
  totalCourses: number;
  completionRate: number;
  lastCourseDate: string;
  avgStudentsPerCourse: number;
}

interface DashboardSummary {
  totalInstructors: number;
  totalCoursesThisMonth: number;
  totalCompletedThisMonth: number;
  avgCoursesPerInstructor: number;
}

const InstructorDashboard: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState(
    toLocalMonthString(new Date())
  );
  const [instructorStats, setInstructorStats] = useState<InstructorStats[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, [selectedMonth]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCourseAdminDashboardData(selectedMonth);
      setInstructorStats(Array.isArray(data.instructorStats) ? data.instructorStats : []);
      setDashboardSummary(data.dashboardSummary as unknown as DashboardSummary);
    } catch (err: any) {
      setError('Failed to fetch dashboard data');
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (completionRate: number) => {
    if (completionRate >= 80) return 'success';
    if (completionRate >= 60) return 'warning';
    return 'error';
  };

  const getWorkloadStatus = (totalCourses: number, avgCourses: number) => {
    const ratio = totalCourses / avgCourses;
    if (ratio > 1.2) return { status: 'High', color: 'error' };
    if (ratio > 0.8) return { status: 'Normal', color: 'success' };
    return { status: 'Low', color: 'warning' };
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Typography
          variant='h5'
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <AssessmentIcon color='primary' />
          Instructor Fairness Dashboard
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size='small' sx={{ minWidth: 150 }}>
            <InputLabel>Month</InputLabel>
            <Select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              label='Month'
            >
              {Array.from({ length: 12 }, (_, i) => {
                const now = new Date();
                // Day 1 so that subtracting months never overflows (e.g. 31 Mar - 1 month).
                const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthStr = toLocalMonthString(date);
                return (
                  <MenuItem key={monthStr} value={monthStr}>
                    {date.toLocaleDateString('en-CA', {
                      year: 'numeric',
                      month: 'long',
                    })}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          <Tooltip title='Refresh Data'>
            <IconButton onClick={fetchDashboardData} disabled={loading} aria-label="Refresh dashboard data">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Summary Cards */}
      {dashboardSummary && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              boxShadow: '0 8px 32px rgba(102, 126, 234, 0.3)',
              transition: 'transform 0.2s ease-in-out',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 12px 40px rgba(102, 126, 234, 0.4)',
              }
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}>
                    <TrendingUpIcon />
                  </Avatar>
                  <Box>
                    <Typography variant='h6' sx={{ color: 'white', fontWeight: 600 }}>
                      {dashboardSummary.totalInstructors}
                    </Typography>
                    <Typography variant='body2' sx={{ color: 'rgba(255,255,255,0.8)' }}>
                      Active Instructors
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ 
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
              color: 'white',
              boxShadow: '0 8px 32px rgba(79, 172, 254, 0.3)',
              transition: 'transform 0.2s ease-in-out',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 12px 40px rgba(79, 172, 254, 0.4)',
              }
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}>
                    <ScheduleIcon />
                  </Avatar>
                  <Box>
                    <Typography variant='h6' sx={{ color: 'white', fontWeight: 600 }}>
                      {dashboardSummary.totalCoursesThisMonth}
                    </Typography>
                    <Typography variant='body2' sx={{ color: 'rgba(255,255,255,0.8)' }}>
                      Total Courses
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ 
              background: 'linear-gradient(135deg, #4caf50 0%, #388e3c 100%)',
              color: 'white',
              boxShadow: '0 8px 32px rgba(76, 175, 80, 0.3)',
              transition: 'transform 0.2s ease-in-out',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 12px 40px rgba(76, 175, 80, 0.4)',
              }
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}>
                    <CompletedIcon />
                  </Avatar>
                  <Box>
                    <Typography variant='h6' sx={{ color: 'white', fontWeight: 600 }}>
                      {dashboardSummary.totalCompletedThisMonth}
                    </Typography>
                    <Typography variant='body2' sx={{ color: 'rgba(255,255,255,0.8)' }}>
                      Completed Courses
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ 
              background: 'linear-gradient(135deg, #ff9800 0%, #ff5722 100%)',
              color: 'white',
              boxShadow: '0 8px 32px rgba(255, 152, 0, 0.3)',
              transition: 'transform 0.2s ease-in-out',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 12px 40px rgba(255, 152, 0, 0.4)',
              }
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}>
                    <CalendarIcon />
                  </Avatar>
                  <Box>
                    <Typography variant='h6' sx={{ color: 'white', fontWeight: 600 }}>
                      {Number(
                        dashboardSummary.avgCoursesPerInstructor
                      ).toFixed(1)}
                    </Typography>
                    <Typography variant='body2' sx={{ color: 'rgba(255,255,255,0.8)' }}>
                      Avg per Instructor
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Instructor Statistics Table */}
      <Card>
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: 2,
              p: 2,
              borderRadius: 1,
              backgroundColor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'primary.dark'
                  : 'primary.main',
            }}
          >
            <AssessmentIcon sx={{ color: 'white', fontSize: '1.8rem' }} />
            <Typography
              sx={{
                fontWeight: 600,
                fontSize: '1.25rem',
                color: 'white',
              }}
            >
              Instructor Performance & Fairness Metrics
            </Typography>
          </Box>

          {loading && <LinearProgress sx={{ mb: 2 }} />}

          <TableContainer component={Paper} variant='outlined'>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>
                    <strong>Instructor</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Completed</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Scheduled</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Total Courses</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Completion Rate</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Workload Status</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Avg Students</strong>
                  </TableCell>
                  <TableCell align='center'>
                    <strong>Last Course</strong>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {instructorStats.map(instructor => {
                  const workloadStatus = getWorkloadStatus(
                    Number(instructor.totalCourses),
                    Number(dashboardSummary?.avgCoursesPerInstructor || 1)
                  );

                  return (
                    <TableRow key={instructor.instructorId}>
                      <TableCell>
                        <Box>
                          <Typography variant='body2' fontWeight='medium'>
                            {instructor.instructorName}
                          </Typography>
                          <Typography variant='caption' color='textSecondary'>
                            {instructor.email}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align='center'>
                        <Chip
                          label={instructor.coursesCompleted}
                          color='success'
                          size='small'
                          icon={<CompletedIcon />}
                        />
                      </TableCell>
                      <TableCell align='center'>
                        <Chip
                          label={instructor.coursesScheduled}
                          color='info'
                          size='small'
                          icon={<ScheduleIcon />}
                        />
                      </TableCell>
                      <TableCell align='center'>
                        <Typography variant='body2' fontWeight='bold'>
                          {instructor.totalCourses}
                        </Typography>
                      </TableCell>
                      <TableCell align='center'>
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <LinearProgress
                            variant='determinate'
                            value={Number(instructor.completionRate)}
                            color={getStatusColor(
                              Number(instructor.completionRate)
                            )}
                            sx={{ width: 60, height: 8, borderRadius: 4 }}
                          />
                          <Typography variant='body2'>
                            {Number(instructor.completionRate).toFixed(0)}%
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align='center'>
                        <Chip
                          label={workloadStatus.status}
                          color={workloadStatus.color as any}
                          size='small'
                          variant='outlined'
                        />
                      </TableCell>
                      <TableCell align='center'>
                        <Typography variant='body2'>
                          {Number(instructor.avgStudentsPerCourse).toFixed(
                            1
                          )}
                        </Typography>
                      </TableCell>
                      <TableCell align='center'>
                        <Typography variant='body2'>
                          {instructor.lastCourseDate
                            ? formatDisplayDate(instructor.lastCourseDate)
                            : 'N/A'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {instructorStats.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} align='center'>
                      <Typography
                        variant='body2'
                        color='textSecondary'
                        sx={{ py: 2 }}
                      >
                        No instructor data available for the selected month
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {error && (
            <Typography variant='body2' color='error' sx={{ mt: 2 }}>
              {error}
            </Typography>
          )}

          <Box sx={{ mt: 2 }}>
            <Typography variant='caption' color='textSecondary'>
              <strong>Workload Status:</strong> High (&gt;20% above avg) |
              Normal (±20% of avg) | Low (&lt;20% below avg)
              <br />
              <strong>Completion Rate:</strong> Percentage of scheduled courses
              that have been completed
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default InstructorDashboard;
