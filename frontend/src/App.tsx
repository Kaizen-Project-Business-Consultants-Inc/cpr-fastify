import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import PrivateRoute from './components/PrivateRoute';
import RoleBasedRouter from './components/RoleBasedRouter';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { NotificationProvider } from './contexts/NotificationContext';
import SessionWarning from './components/common/SessionWarning';
import LocationTracker from './components/LocationTracker';
import TransitionWrapper from './components/common/TransitionWrapper';

// Lazy-loaded portals — each is a separate chunk, loaded only when the user navigates to that role
const InstructorPortal = React.lazy(() => import('./components/portals/InstructorPortalContainer'));
const OrganizationPortal = React.lazy(() => import('./components/portals/organization/OrganizationPortalContainer'));
const CourseAdminPortal = React.lazy(() => import('./components/portals/courseAdmin/CourseAdminPortalContainer'));
const SuperAdminPortal = React.lazy(() => import('./components/portals/SuperAdminPortal'));
const AccountingPortal = React.lazy(() => import('./components/portals/AccountingPortal'));
const SystemAdminPortal = React.lazy(() => import('./components/portals/SystemAdminPortal'));
const HRPortal = React.lazy(() => import('./components/portals/HRPortal'));
const VendorPortal = React.lazy(() => import('./components/portals/VendorPortal'));

// Lazy-loaded pages — rarely visited on initial load
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const RecoverPassword = React.lazy(() => import('./pages/RecoverPassword'));
const PrivacyPolicy = React.lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = React.lazy(() => import('./pages/TermsOfService'));

const LazyFallback = () => (
  <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
    <CircularProgress />
  </Box>
);

// QueryClient and ThemeProvider are provided by main.tsx — not duplicated here.

function App() {
  return (
    <SnackbarProvider>
      <RealtimeProvider>
        <NotificationProvider>
          <ErrorBoundary>
            <SessionWarning showAtMinutes={5} />
            <LocationTracker />
            <TransitionWrapper>
              <Suspense fallback={<LazyFallback />}>
              <Routes>
                {/* Public routes */}
                <Route path='/login' element={<Login />} />
                <Route path='/recover-password' element={<RecoverPassword />} />
                <Route path='/forgot-password' element={<ForgotPassword />} />
                <Route path='/reset-password' element={<ResetPassword />} />
                <Route path='/privacy' element={<PrivacyPolicy />} />
                <Route path='/terms' element={<TermsOfService />} />
                <Route path='/' element={<RoleBasedRouter />} />

                {/* Protected routes */}
                <Route
                  path='/instructor/*'
                  element={
                    <PrivateRoute role='instructor'>
                      <InstructorPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path='/organization/*'
                  element={
                    <PrivateRoute role='organization'>
                      <OrganizationPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path='/admin/*'
                  element={
                    <PrivateRoute role='admin'>
                      <CourseAdminPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path='/accounting/*'
                  element={
                    <PrivateRoute role='accountant'>
                      <AccountingPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path='/superadmin/*'
                  element={
                    <PrivateRoute role='superadmin'>
                      <SuperAdminPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path='/sysadmin/*'
                  element={
                    <PrivateRoute role='sysadmin'>
                      <SystemAdminPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path="/hr"
                  element={
                    <PrivateRoute role="hr">
                      <HRPortal />
                    </PrivateRoute>
                  }
                />

                <Route
                  path="/vendor/*"
                  element={
                    <PrivateRoute role="vendor">
                      <VendorPortal />
                    </PrivateRoute>
                  }
                />

                {/* Legacy route for backward compatibility */}
                <Route
                  path='/dashboard'
                  element={
                    <PrivateRoute>
                      <RoleBasedRouter />
                    </PrivateRoute>
                  }
                />

                <Route path='*' element={<NotFound />} />
              </Routes>
              </Suspense>
            </TransitionWrapper>
          </ErrorBoundary>
        </NotificationProvider>
      </RealtimeProvider>
    </SnackbarProvider>
  );
}

export default App;
