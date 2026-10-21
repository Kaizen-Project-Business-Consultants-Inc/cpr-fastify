import React, { useEffect, Suspense } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CircularProgress, Box, Typography } from '@mui/material';
import { tokenService } from '../services/tokenService';

const InstructorPortal = React.lazy(() => import('../components/portals/InstructorPortalContainer'));
const OrganizationPortalContainer = React.lazy(() => import('../components/portals/organization/OrganizationPortalContainer'));
const CourseAdminPortal = React.lazy(() => import('../components/portals/courseAdmin/CourseAdminPortalContainer'));
const AccountingPortal = React.lazy(() => import('../components/portals/AccountingPortal'));
const SystemAdminPortal = React.lazy(() => import('../components/portals/SystemAdminPortal'));
const HRPortal = React.lazy(() => import('../components/portals/HRPortal'));
const VendorPortal = React.lazy(() => import('../components/portals/VendorPortal'));

const LazyFallback = () => (
  <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
    <CircularProgress />
  </Box>
);

const RoleBasedRouter: React.FC = () => {
  const { user, loading, checkAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = tokenService.getAccessToken();
    if (token && !user && !loading) {
      checkAuth();
    }
  }, [user, loading, checkAuth]);

  useEffect(() => {
    // Redirect users to their role-specific URLs for better bookmarking and refresh behavior
    if (user && !loading) {
      const roleRoutes = {
        instructor: '/instructor/dashboard',
        organization: '/organization/dashboard',
        admin: '/admin/dashboard',
        accountant: '/accounting/dashboard',
        sysadmin: '/sysadmin/dashboard',
        hr: '/hr',
        vendor: '/vendor/dashboard',
      };

      const targetRoute = roleRoutes[user.role as keyof typeof roleRoutes];
      if (targetRoute) {
        navigate(targetRoute, { replace: true });
      }
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <Box
        display='flex'
        justifyContent='center'
        alignItems='center'
        minHeight='60vh'
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    // Declarative redirect: navigate() during render is a no-op (React Router 6 with v7_startTransition, and 7).
    return <Navigate to='/login' replace />;
  }

  // For direct access (when not redirecting), still render the appropriate portal
  // This ensures the component works even if the redirect hasn't happened yet
  const renderPortal = () => {
    switch (user.role) {
      case 'instructor':
        return <InstructorPortal />;
      case 'organization':
        return <OrganizationPortalContainer />;
      case 'admin':
        return <CourseAdminPortal />;
      case 'accountant':
        return <AccountingPortal />;
      case 'sysadmin':
        return <SystemAdminPortal />;
      case 'hr':
        return <HRPortal />;
      case 'vendor':
        return <VendorPortal />;
      default:
        return (
          <Box
            display='flex'
            justifyContent='center'
            alignItems='center'
            minHeight='60vh'
          >
            <Typography variant='h6' color='error'>
              Invalid user role: {user.role}. Please contact support.
            </Typography>
          </Box>
        );
    }
  };

  return <Suspense fallback={<LazyFallback />}>{renderPortal()}</Suspense>;
};

export default RoleBasedRouter;
