import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminShell } from '../gtacpr';

interface InstructorLayoutProps {
  children: React.ReactNode;
  currentView: string;
  onRefresh?: () => void;
}

const viewConfig: Record<string, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: 'Overview', title: 'Dashboard' },
  availability: { eyebrow: 'Schedule', title: 'Availability' },
  classes: { eyebrow: 'Schedule', title: 'My Schedule' },
  timesheet: { eyebrow: 'Time & Pay', title: 'Timesheet' },
  'class-attendance': { eyebrow: 'Classes', title: 'Class Attendance' },
  archive: { eyebrow: 'History', title: 'Archive' },
  profile: { eyebrow: 'Account', title: 'Profile' },
};

const navItems = [
  { label: 'Dashboard', path: '/instructor/dashboard' },
  { label: 'Availability', path: '/instructor/availability' },
  { label: 'My Schedule', path: '/instructor/classes' },
  { label: 'Timesheet', path: '/instructor/timesheet' },
  { label: 'Class Attendance', path: '/instructor/class-attendance' },
  { label: 'Archive', path: '/instructor/archive' },
  { label: 'Profile', path: '/instructor/profile' },
];

const InstructorLayout: React.FC<InstructorLayoutProps> = ({
  children,
  currentView,
  onRefresh,
}) => {
  const navigate = useNavigate();
  const config = viewConfig[currentView] || { eyebrow: 'Instructor', title: 'Instructor Portal' };

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <AdminShell
      eyebrow={config.eyebrow}
      title={config.title}
      portalName="Instructor Portal"
      basePath="/instructor/dashboard"
      navItems={navItems}
      onNavigate={handleNavigate}
    >
      {children}
    </AdminShell>
  );
};

export default InstructorLayout;
