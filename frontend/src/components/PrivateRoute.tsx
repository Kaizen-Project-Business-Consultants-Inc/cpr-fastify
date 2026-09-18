import React, { useEffect, useState, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Alert, Button } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { tokenService } from '../services/tokenService';

const isDev = import.meta.env.DEV;
// eslint-disable-next-line no-console
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args); };

interface PrivateRouteProps {
  children: React.ReactNode;
  role?: string;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({
  children,
  role,
}) => {
  const { user, loading, checkAuth, validateTokenOnPageLoad } = useAuth();
  const location = useLocation();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const isMountedRef = useRef(true);

  // Cleanup on unmount to prevent memory leaks
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const token = tokenService.getAccessToken();
    devLog('[TRACE] PrivateRoute - Token check:', {
      hasToken: !!token,
      hasUser: !!user,
      loading,
      pathname: location.pathname
    });

    if (token && !user && !loading) {
      devLog('[TRACE] PrivateRoute - Attempting auth check');
      checkAuth();
    }
  }, [user, loading, checkAuth, location.pathname]);

  // Enhanced validation on route changes
  useEffect(() => {
    const validateRouteAccess = async () => {
      if (user && !loading) {
        devLog('[TRACE] PrivateRoute - Validating route access for:', location.pathname);
        if (isMountedRef.current) setIsValidating(true);
        if (isMountedRef.current) setValidationError(null);

        try {
          const validationResult = await validateTokenOnPageLoad();

          // Check if still mounted before updating state
          if (!isMountedRef.current) return;

          if (!validationResult.isValid) {
            devLog('[TRACE] PrivateRoute - Route validation failed:', validationResult.error);
            setValidationError(validationResult.error || 'Access denied');

            if (validationResult.requiresReauth) {
              // Clear tokens and redirect to login
              tokenService.clearTokens();
              tokenService.clearSavedLocation();
              sessionStorage.removeItem('location_restoration_attempted');
            }
          } else {
            devLog('[TRACE] PrivateRoute - Route validation successful');
            setValidationError(null);
          }
        } catch (err) {
          if (!isMountedRef.current) return;
          devLog('[TRACE] PrivateRoute - Validation error:', err);
          setValidationError('Route validation failed');
        } finally {
          if (isMountedRef.current) setIsValidating(false);
        }
      }
    };

    // Only validate if we have a user and are not loading
    if (user && !loading) {
      validateRouteAccess();
    }
  }, [user, loading, location.pathname, validateTokenOnPageLoad]);

  // Show loading while authentication is being checked
  if (loading || isValidating) {
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

  // Show validation error if token validation failed
  if (validationError) {
    return (
      <Box
        display='flex'
        flexDirection='column'
        justifyContent='center'
        alignItems='center'
        minHeight='60vh'
        gap={2}
        p={3}
      >
        <Alert severity="error" sx={{ maxWidth: 600 }}>
          <strong>Authentication Error</strong>
          <br />
          {validationError}
          <br />
          <br />
          This usually happens when you have multiple browser tabs open with different user accounts.
          Please log out of all tabs and log back in with the correct account.
        </Alert>
        <Button 
          variant="contained" 
          onClick={() => {
            tokenService.clearTokens();
            window.location.href = '/login';
          }}
        >
          Go to Login
        </Button>
      </Box>
    );
  }

  // If not authenticated and no token exists, redirect to login
  if (!user && !tokenService.getAccessToken()) {
    // Save the current full location so we can redirect back after login
    tokenService.saveCurrentFullLocation();
    return <Navigate to='/login' state={{ from: location }} replace />;
  }

  // If we have a token but no user yet, continue showing loading
  // This handles the case where authentication is still being verified
  if (tokenService.getAccessToken() && !user) {
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

  // If we don't have a user at this point, something went wrong
  if (!user) {
    // Save the current full location so we can redirect back after login
    tokenService.saveCurrentFullLocation();
    return <Navigate to='/login' state={{ from: location }} replace />;
  }

  // Role-based access control
  if (role && user.role !== role) {
    devLog('[TRACE] PrivateRoute - Role mismatch:', {
      required: role,
      actual: user.role,
      pathname: location.pathname
    });
    
    return (
      <Box
        display='flex'
        flexDirection='column'
        justifyContent='center'
        alignItems='center'
        minHeight='60vh'
        gap={2}
        p={3}
      >
        <Alert severity="warning" sx={{ maxWidth: 600 }}>
          <strong>Access Denied</strong>
          <br />
          You don't have permission to access this page.
          <br />
          Required role: {role}
          <br />
          Your role: {user.role}
        </Alert>
        <Button 
          variant="contained" 
          onClick={() => {
            // Navigate to user's appropriate dashboard
            const roleRoutes = {
              instructor: '/instructor/dashboard',
              organization: '/organization/dashboard',
              admin: '/admin/dashboard',
              accountant: '/accounting/dashboard',
              superadmin: '/superadmin/dashboard',
              sysadmin: '/sysadmin/dashboard',
              hr: '/hr',
              vendor: '/vendor/dashboard',
            };
            const targetRoute = roleRoutes[user.role as keyof typeof roleRoutes] || '/';
            window.location.href = targetRoute;
          }}
        >
          Go to My Dashboard
        </Button>
      </Box>
    );
  }

  // User is authenticated and has the required role
  return <>{children}</>;
};

export default PrivateRoute;
