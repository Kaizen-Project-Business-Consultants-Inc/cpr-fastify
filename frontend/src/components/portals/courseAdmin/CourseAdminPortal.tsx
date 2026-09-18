import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Alert } from '@mui/material';
import ErrorBoundary from '../../common/ErrorBoundary';
import { AdminShell, PortalNotFound } from '../../gtacpr';
import InstructorManagement from './InstructorManagement';
import CourseScheduling from './CourseScheduling';
import EmailTemplateManager from './EmailTemplateManager';
import DashboardView from './DashboardView';
import CancelledCourses from './CancelledCourses';
import VendorInvoiceApproval from './VendorInvoiceApproval';
import PaidVendorInvoices from './PaidVendorInvoices';
import { User } from '../../../types/api';

const pageConfig: Record<string, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: 'Overview', title: 'Dashboard' },
  instructors: { eyebrow: 'People', title: 'Instructor Management' },
  scheduling: { eyebrow: 'Courses', title: 'Course Scheduling' },
  'email-templates': { eyebrow: 'Communication', title: 'Email Templates' },
  'cancelled-courses': { eyebrow: 'Courses', title: 'Cancelled Courses' },
  'vendor-invoices': { eyebrow: 'Billing', title: 'Vendor Invoice Approval' },
  'paid-vendor-invoices': { eyebrow: 'Billing', title: 'Paid Vendor Invoices' },
};

const navItems = [
  { label: 'Dashboard', path: '/admin/dashboard' },
  { label: 'Instructor Management', path: '/admin/instructors' },
  { label: 'Course Scheduling', path: '/admin/scheduling' },
  { label: 'Email Templates', path: '/admin/email-templates' },
  { label: 'Cancelled Courses', path: '/admin/cancelled-courses' },
  { label: 'Vendor Invoices', path: '/admin/vendor-invoices' },
  { label: 'Paid Vendor Invoices', path: '/admin/paid-vendor-invoices' },
];

interface CourseAdminPortalProps {
  user: User | null;
  anchorEl: HTMLElement | null;
  error: string | null;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onMenuClose: () => void;
  onLogout: () => void;
  onPasswordReset: () => void;
}

const CourseAdminPortal: React.FC<CourseAdminPortalProps> = ({
  user,
  error,
}) => {
  const location = useLocation();
  const currentPath = location.pathname.split('/').pop() || 'dashboard';
  const config = pageConfig[currentPath] || { eyebrow: 'Course Admin', title: 'Course Administration' };

  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    console.error('[CourseAdminPortal] Error caught by boundary:', error, errorInfo);
  };

  return (
    <ErrorBoundary context="course_admin_portal" onError={handleError}>
      <AdminShell
        eyebrow={config.eyebrow}
        title={config.title}
        portalName="Course Admin"
        basePath="/admin/dashboard"
        navItems={navItems}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Routes>
          <Route path="dashboard" element={<DashboardView />} />
          <Route path="instructors" element={<InstructorManagement />} />
          <Route path="scheduling" element={<CourseScheduling />} />
          <Route path="email-templates" element={<EmailTemplateManager />} />
          <Route path="cancelled-courses" element={<CancelledCourses />} />
          <Route path="vendor-invoices" element={<VendorInvoiceApproval />} />
          <Route path="paid-vendor-invoices" element={<PaidVendorInvoices />} />
          <Route path="" element={<Navigate to="dashboard" replace />} />
          <Route path="*" element={<PortalNotFound homePath="/admin/dashboard" />} />
        </Routes>
      </AdminShell>
    </ErrorBoundary>
  );
};

export default CourseAdminPortal;
