import React from 'react';
import { useLocation } from 'react-router-dom';
import { AdminShell } from '../../gtacpr';

interface User {
  id: number;
  username: string;
  role: string;
  organizationId?: number;
  organizationName?: string;
  locationId?: number;
  locationName?: string;
  [key: string]: unknown;
}

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface OrganizationLayoutProps {
  children: React.ReactNode;
  user: User | null;
  currentView?: string;
  onViewChange?: (view: string) => void;
  onLogout: () => void;
  onRefresh?: () => void;
  navigationItems: NavigationItem[];
  drawerWidth: number;
}

const BASE = '/organization';

const viewConfig: Record<string, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: 'Overview', title: 'Dashboard' },
  courses: { eyebrow: 'Training', title: 'My Courses' },
  archive: { eyebrow: 'Training', title: 'Archive' },
  schedule: { eyebrow: 'Training', title: 'Schedule a Course' },
  billing: { eyebrow: 'Finance', title: 'Bills Payable' },
  'paid-invoices': { eyebrow: 'Finance', title: 'Paid Invoices' },
  pricing: { eyebrow: 'Finance', title: 'Pricing' },
  profile: { eyebrow: 'Account', title: 'Profile' },
  analytics: { eyebrow: 'Insights', title: 'Analytics' },
};

/** Turn a nav id ("courses") into an absolute portal path ("/organization/courses"). */
const toPath = (id: string) => (id.startsWith('/') ? id : `${BASE}/${id}`);

const OrganizationLayout: React.FC<OrganizationLayoutProps> = ({
  children,
  user,
  currentView,
  onViewChange,
  onLogout: _onLogout,
  onRefresh: _onRefresh,
  navigationItems,
  drawerWidth: _drawerWidth,
}) => {
  const location = useLocation();

  // Derive the active view from the URL when the parent does not pass one.
  // /organization/billing -> "billing"; /organization -> "dashboard"
  const urlView = location.pathname.replace(BASE, '').split('/').filter(Boolean)[0] || 'dashboard';
  const view = currentView || urlView;
  const config = viewConfig[view] || { eyebrow: 'Organization', title: 'Organization Portal' };

  // All portals use absolute paths so AdminShell can call navigate(path) directly.
  const navItems = navigationItems.map((item) => ({
    label: item.label,
    path: toPath(item.id),
  }));

  const orgName = user?.organizationName
    ? `${user.organizationName}${user.locationName ? ` - ${user.locationName}` : ''}`
    : undefined;

  return (
    <AdminShell
      eyebrow={config.eyebrow}
      title={config.title}
      portalName="Organization Portal"
      basePath={`${BASE}/dashboard`}
      navItems={navItems}
      activePath={toPath(view)}
      onNavigate={onViewChange ? (path) => onViewChange(path.replace(`${BASE}/`, '')) : undefined}
      subtitle={orgName}
    >
      {children}
    </AdminShell>
  );
};

export default OrganizationLayout;
