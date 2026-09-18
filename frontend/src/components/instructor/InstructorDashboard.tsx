import React from 'react';
import {
  Box,
  Typography,
  Alert,
  CircularProgress,
  ButtonBase,
} from '@mui/material';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import { GhostButton } from '../gtacpr/Buttons';
import { useNavigate } from 'react-router-dom';
import { 
  useInstructorClasses, 
  useCompletedClasses, 
  useInstructorAvailability,
  useTodayClasses,
  useRefreshInstructorData
} from '../../services/instructorService';
import WelcomeHeader from './WelcomeHeader';
import TodayClassesList from './TodayClassesList';
import QuickActionsGrid from './QuickActionsGrid';

interface InstructorClass {
  id: number;
  coursename?: string;
  date: string;
  studentcount?: number;
  [key: string]: unknown;
}

interface ErrorWithDetails {
  userMessage?: string;
  suggestion?: string;
  message?: string;
}

const InstructorDashboard: React.FC = () => {
  const navigate = useNavigate();
  
  // Use centralized service hooks instead of useInstructorData
  const { data: scheduledClasses = [], isLoading: classesLoading, error: classesError } = useInstructorClasses();
  const { data: completedClasses = [], isLoading: completedLoading, error: completedError } = useCompletedClasses();
  const { data: availableDates = [], isLoading: availabilityLoading, error: availabilityError } = useInstructorAvailability();
  const { data: todayClasses = [], isLoading: todayLoading, error: todayError } = useTodayClasses();
  const refreshData = useRefreshInstructorData();

  // Combine loading states
  const loading = classesLoading || completedLoading || availabilityLoading || todayLoading;
  const error = classesError || completedError || availabilityError || todayError;

  // NOTE: there used to be a useEffect here that derived a `dashboardData` object from
  // the query results. It set state on every run and depended on `scheduledClasses` /
  // `completedClasses`, whose `= []` defaults are a NEW array identity on every render
  // while the queries are pending — so it re-ran, set state, re-rendered, and looped.
  // The value it produced was never read, so it is gone. Anything derived from the
  // query data is computed during render below.

  // Calculate additional statistics
  const classesArray = scheduledClasses as InstructorClass[];
  const todayArray = todayClasses as InstructorClass[];
  const totalClasses = classesArray.length;
  const upcomingClasses = classesArray.filter(
    (cls) => new Date(cls.date) > new Date()
  );
  const todayClassesCount = todayArray.length;
  const totalStudents = classesArray.reduce(
    (sum: number, cls) => sum + (cls.studentcount || 0),
    0
  );

  // Format date helper
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    const errorObj = error as ErrorWithDetails;
    return (
      <Alert severity="error" sx={{ mb: 4 }}>
        <Typography variant="h6">
          {typeof error === 'object' && error !== null && 'userMessage' in error ? errorObj.userMessage : 'Error Loading Dashboard'}
        </Typography>
        <Typography>
          {typeof error === 'object' && error !== null && 'suggestion' in error ? errorObj.suggestion :
           typeof error === 'object' && error !== null && 'message' in error ? errorObj.message :
           typeof error === 'string' ? error : 'An unexpected error occurred'}
        </Typography>
      </Alert>
    );
  }

  return (
    <Box>
      {/* Welcome Section */}
      <WelcomeHeader />
      
      {/* Force Refresh Button */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
        {/* refreshData() invalidates the instructor queries. It used to call
            queryClient.clear() as well, which wiped the whole cache including auth. */}
        <GhostButton onClick={() => refreshData()}>
          Refresh
        </GhostButton>
      </Box>

      {/* Quick Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px', mb: 4 }}>
        <StatCard label="Total Classes" value={totalClasses} sub="All scheduled" dotColor="#CC1F1F" />
        <StatCard label="Today's Classes" value={todayClassesCount} sub="Scheduled today" dotColor="#ED6C02" />
        <StatCard label="Total Students" value={totalStudents} sub="Enrolled students" dotColor="#4B5563" />
        <StatCard label="Available Dates" value={(availableDates as unknown[]).length} sub="Your availability" dotColor="#16A34A" />
      </Box>

      {/* Quick Actions */}
      <QuickActionsGrid />

      {/* Today's Classes */}
      <Box sx={{ mb: 4 }}>
        <TodayClassesList classes={todayClasses || []} />
      </Box>

      {/* Recent Classes */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: '24px' }}>
        <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Upcoming Classes</Typography>
          {upcomingClasses.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {upcomingClasses.slice(0, 5).map((cls, index: number) => (
                <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{cls.coursename || 'Course'}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{formatDate(cls.date)} &bull; {cls.studentcount || 0} students</Typography>
                  </Box>
                  <ButtonBase onClick={() => navigate('/instructor/classes')} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>View</ButtonBase>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 13 }}>No upcoming classes scheduled.</Typography>
          )}
        </Box>

        <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Recent Completed Classes</Typography>
          {(completedClasses as InstructorClass[]).length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {(completedClasses as InstructorClass[]).slice(0, 5).map((cls, index: number) => (
                <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{cls.coursename || 'Course'}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{formatDate(cls.date)} &bull; {cls.studentcount || 0} students</Typography>
                  </Box>
                  <StatusChip kind="success" label="Completed" />
                </Box>
              ))}
            </Box>
          ) : (
            <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 13 }}>No completed classes yet.</Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default InstructorDashboard;
