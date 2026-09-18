import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AdminShell } from '../gtacpr';

interface VendorLayoutProps {
  children: React.ReactNode;
  currentView: string;
}

const viewConfig: Record<string, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: 'Overview', title: 'Dashboard' },
  upload: { eyebrow: 'Invoicing', title: 'Upload Invoice' },
  history: { eyebrow: 'Invoicing', title: 'Invoice Management' },
  profile: { eyebrow: 'Account', title: 'Profile' },
};

const navItems = [
  { label: 'Dashboard', path: '/vendor/dashboard' },
  { label: 'Upload Invoice', path: '/vendor/upload' },
  { label: 'Invoice Management', path: '/vendor/history' },
  { label: 'Profile', path: '/vendor/profile' },
];

const VendorLayout: React.FC<VendorLayoutProps> = ({ children, currentView }) => {
  const config = viewConfig[currentView] || { eyebrow: 'Vendor', title: 'Vendor Portal' };

  return (
    <AdminShell
      eyebrow={config.eyebrow}
      title={config.title}
      portalName="Vendor Portal"
      basePath="/vendor/dashboard"
      navItems={navItems}
    >
      {children}
    </AdminShell>
  );
};

export default VendorLayout;
