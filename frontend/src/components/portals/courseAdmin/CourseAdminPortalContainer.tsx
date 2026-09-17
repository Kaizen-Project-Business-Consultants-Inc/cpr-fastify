import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../services/api';
import logger from '../../../utils/logger';
import analytics from '../../../services/analytics';
import ErrorBoundary from '../../common/ErrorBoundary';
import CourseAdminPortal from './CourseAdminPortal';
import { CircularProgress, Box } from '@mui/material';

const CourseAdminPortalContainer: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Navigation state
  // const [selectedTab, setSelectedTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  
  // Error handling
  const [error, setError] = useState<string | null>(null);

  // Analytics tracking
  useEffect(() => {
    if (user) {
      analytics.setUser(user.id || user.username, {
        role: user.role,
        portal: 'course_admin',
      });
    }
  }, [user]);

  // Error handler for error boundaries
  const handleError = useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    logger.error('Course Admin Portal Error:', error, errorInfo);
    analytics.trackError(error, 'course_admin_portal', {
      componentStack: errorInfo.componentStack,
      // tab: selectedTab,
    });
    setError(error.message);
  }, []);

  // Handle menu operations
  const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);

  const handleMenuClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  // Handle logout
  const handleLogout = useCallback(async () => {
    handleMenuClose();
    analytics.trackCourseAdminAction('logout', {});
    await logout();
    navigate('/');
  }, [logout, navigate, handleMenuClose]);

  // Handle password reset
  const handlePasswordReset = useCallback(() => {
    handleMenuClose();
    analytics.trackCourseAdminAction('password_reset', {});
    navigate('/forgot-password');
  }, [navigate, handleMenuClose]);

  // Data fetching with React Query (placeholder for future implementation)
  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['course-admin-dashboard'],
    queryFn: async () => {
      // Placeholder - implement actual dashboard data fetching
      return { stats: {} as any, recentActivity: [] as any[] };
    },
    enabled: !!user,
  });

  // Loading state
  const isLoading = dashboardLoading;

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <ErrorBoundary context="course_admin_portal" onError={handleError}>
      <CourseAdminPortal
        user={user}
        // selectedTab={selectedTab}
        anchorEl={anchorEl}
        error={error}
        // onTabChange={handleTabChange}
        onMenuOpen={handleMenuOpen}
        onMenuClose={handleMenuClose}
        onLogout={handleLogout}
        onPasswordReset={handlePasswordReset}
      />
    </ErrorBoundary>
  );
};

export default CourseAdminPortalContainer; 