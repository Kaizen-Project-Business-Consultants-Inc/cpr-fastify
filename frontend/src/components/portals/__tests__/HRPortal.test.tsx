import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// HRDashboard goes through hrDashboardService, which goes through the api module.
const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../../services/api', () => {
  const api = {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return { api, default: api, adminApi: {}, instructorApi: {} };
});

// AdminShell reads the signed-in user for the sidebar footer.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, username: 'hradmin', firstName: 'Nadia', lastName: 'Okafor', email: 'nadia@gtacpr.test', role: 'hr' },
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleTheme: vi.fn() }),
}));

// Sibling views are only reachable from other URLs; stub them so this file only
// exercises the portal shell and its dashboard route.
vi.mock('../PersonnelManagement', () => ({ default: () => <div data-testid="personnel" /> }));
vi.mock('../../hr/TimesheetManagement', () => ({ default: () => <div data-testid="timesheets" /> }));
vi.mock('../../hr/PayrollManagement', () => ({ default: () => <div data-testid="payroll" /> }));
vi.mock('../../hr/PayRateManagement', () => ({ default: () => <div data-testid="payrates" /> }));
vi.mock('../../hr/NotificationsPanel', () => ({ default: () => <div data-testid="notifications" /> }));
vi.mock('../../hr/ReturnedPaymentRequests', () => ({ default: () => <div data-testid="returned-payments" /> }));

import HRPortal from '../HRPortal';

const stats = {
  pendingApprovals: 4,
  activeInstructors: 23,
  organizations: 11,
  expiringCertifications: 6,
  recentChanges: [
    { id: 1, userId: 55, username: 'dmorales', fieldName: 'email', status: 'pending', changeType: 'profile_update' },
  ],
  pendingApprovalsList: [
    {
      id: 900,
      username: 'dmorales',
      email: 'dmorales@gtacpr.test',
      changeType: 'profile_update',
      fieldName: 'phone',
      newValue: '+1 416 555 0134',
      status: 'pending',
      createdAt: '2026-09-01T12:00:00.000Z',
    },
  ],
};

// Reports the current URL so we can prove navigation is route-based, not state-based.
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderPortal = (path = '/hr/dashboard') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/hr/*" element={<HRPortal />} />
      </Routes>
    </MemoryRouter>
  );

describe('HRPortal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { success: true, data: stats } });
  });

  it('renders the dashboard for /hr/dashboard with the fetched stats', async () => {
    renderPortal();

    await waitFor(() => {
      expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
    });

    expect(mockGet).toHaveBeenCalledWith('/hr-dashboard/stats');
    // Real mocked numbers, not placeholder zeros.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('renders the pending approval row from the API', async () => {
    renderPortal();

    await waitFor(() => {
      expect(screen.getByText('dmorales@gtacpr.test')).toBeInTheDocument();
    });
    expect(screen.getByText('+1 416 555 0134')).toBeInTheDocument();
    expect(screen.getByText('Pending Approvals (1)')).toBeInTheDocument();
    expect(screen.queryByText('No pending approvals')).not.toBeInTheDocument();
  });

  it('renders every sidebar nav item and the portal name', async () => {
    renderPortal();

    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(screen.getByText('HR Portal')).toBeInTheDocument();
    // Scoped to the sidebar: the active view's label is also the page heading.
    [
      'Dashboard',
      'Personnel Management',
      'Timesheet Management',
      'Pay Rate Management',
      'Instructor Payroll',
      'Returned Payments',
      'Notifications',
      'HR Reports (Coming Soon)',
    ].forEach((label) => {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    });
  });

  it('uses URL routes: clicking a nav item changes the path and the rendered view', async () => {
    renderPortal();

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hr/dashboard'));

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sidebar' })).getByText('Personnel Management'));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/hr/personnel');
    });
    expect(screen.getByTestId('personnel')).toBeInTheDocument();
  });

  it('shows the not-found view for an unknown /hr URL', async () => {
    renderPortal('/hr/does-not-exist');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/hr/does-not-exist');
    });
    expect(screen.queryByText('Pending Approvals')).not.toBeInTheDocument();
  });
});
