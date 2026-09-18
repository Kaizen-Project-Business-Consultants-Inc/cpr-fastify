import React from 'react';
import { Box, Typography } from '@mui/material';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AdminShell, PortalNotFound } from '../gtacpr';
import HRDashboard from './HRDashboard';
import PersonnelManagement from './PersonnelManagement';
import TimesheetManagement from '../hr/TimesheetManagement';
import PayrollManagement from '../hr/PayrollManagement';
import PayRateManagement from '../hr/PayRateManagement';
import NotificationsPanel from '../hr/NotificationsPanel';
import ReturnedPaymentRequests from '../hr/ReturnedPaymentRequests';

const HRReports = () => (
  <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
    <Typography sx={{ fontSize: 16, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>HR Reports</Typography>
    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 1 }}>Coming soon - Analytics and compliance reports.</Typography>
  </Box>
);

const BASE = '/hr';

const views = [
  { key: 'dashboard', label: 'Dashboard', eyebrow: 'Overview' },
  { key: 'personnel', label: 'Personnel Management', eyebrow: 'People' },
  { key: 'timesheet', label: 'Timesheet Management', eyebrow: 'Time & Pay' },
  { key: 'payrates', label: 'Pay Rate Management', eyebrow: 'Time & Pay' },
  { key: 'payroll', label: 'Instructor Payroll', eyebrow: 'Time & Pay' },
  { key: 'returned-payments', label: 'Returned Payments', eyebrow: 'Time & Pay' },
  { key: 'notifications', label: 'Notifications', eyebrow: 'System' },
  { key: 'reports', label: 'HR Reports (Coming Soon)', eyebrow: 'Analytics' },
];

const navItems = views.map((v) => ({ label: v.label, path: `${BASE}/${v.key}` }));

/** HR portal. Each view has its own URL (/hr/<view>) so refresh, back and bookmarks work. */
const HRPortal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentKey = location.pathname.split('/').filter(Boolean)[1] || 'dashboard';
  const current = views.find((v) => v.key === currentKey) || views[0];

  // Child screens still call onViewChange('personnel') etc.; translate to a URL.
  const goToView = (view: string) => navigate(`${BASE}/${view}`);

  return (
    <AdminShell
      eyebrow={current.eyebrow}
      title={current.label}
      portalName="HR Portal"
      basePath={`${BASE}/dashboard`}
      navItems={navItems}
    >
      <Routes>
        <Route path="dashboard" element={<HRDashboard onViewChange={goToView} />} />
        <Route path="personnel" element={<PersonnelManagement onViewChange={goToView} />} />
        <Route path="timesheet" element={<TimesheetManagement />} />
        <Route path="payrates" element={<PayRateManagement />} />
        <Route path="payroll" element={<PayrollManagement />} />
        <Route path="returned-payments" element={<ReturnedPaymentRequests />} />
        <Route path="notifications" element={<NotificationsPanel />} />
        <Route path="reports" element={<HRReports />} />
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="*" element={<PortalNotFound homePath={`${BASE}/dashboard`} />} />
      </Routes>
    </AdminShell>
  );
};

export default HRPortal;
