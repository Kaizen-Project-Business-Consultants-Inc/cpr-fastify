import React, { useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import logger from '../../utils/logger';
import { Alert, Snackbar } from '@mui/material';
import ErrorBoundary from '../common/ErrorBoundary';
import { AdminShell, PortalNotFound } from '../gtacpr';
import OrganizationManager from '../admin/OrganizationManager';
import UserManager from '../admin/UserManager';
import CourseManager from '../admin/CourseManager';
import PricingRuleManager from '../admin/PricingRuleManager';

const BASE = '/superadmin';

const views = [
  { key: 'dashboard', label: 'Organizations', eyebrow: 'Management' },
  { key: 'users', label: 'Users', eyebrow: 'Management' },
  { key: 'course_types', label: 'Course Types', eyebrow: 'Management' },
  { key: 'pricing', label: 'Pricing Rules', eyebrow: 'Billing' },
];

const navItems = views.map((v) => ({ label: v.label, path: `${BASE}/${v.key}` }));

/** Super Admin portal. Each view has its own URL (/superadmin/<view>). */
const SuperAdminPortal = () => {
  const location = useLocation();
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning' | 'info';
  }>({ open: false, message: '', severity: 'success' });

  const showSnackbar = useCallback((message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    logger.error('[SuperAdminPortal] Error caught by boundary:', error, errorInfo);
  };

  const currentKey = location.pathname.split('/').filter(Boolean)[1] || 'dashboard';
  const current = views.find((v) => v.key === currentKey) || views[0];

  return (
    <ErrorBoundary context="super_admin_portal" onError={handleError}>
      <AdminShell
        eyebrow={current.eyebrow}
        title={current.label}
        portalName="Super Admin"
        basePath={`${BASE}/dashboard`}
        navItems={navItems}
      >
        <Routes>
          <Route path="dashboard" element={<ErrorBoundary context="super_admin_organizations" onError={handleError}><OrganizationManager /></ErrorBoundary>} />
          {/* Legacy address from the old state-based portal */}
          <Route path="organizations" element={<Navigate to={`${BASE}/dashboard`} replace />} />
          <Route path="users" element={<ErrorBoundary context="super_admin_users" onError={handleError}><UserManager /></ErrorBoundary>} />
          <Route path="course_types" element={<ErrorBoundary context="super_admin_course_types" onError={handleError}><CourseManager showSnackbar={showSnackbar} /></ErrorBoundary>} />
          <Route path="pricing" element={<ErrorBoundary context="super_admin_pricing" onError={handleError}><PricingRuleManager /></ErrorBoundary>} />
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="*" element={<PortalNotFound homePath={`${BASE}/dashboard`} />} />
        </Routes>
      </AdminShell>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </ErrorBoundary>
  );
};

export default SuperAdminPortal;
