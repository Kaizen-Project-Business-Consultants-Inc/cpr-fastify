import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// The dashboard route is OrganizationManager, which calls api.getOrganizations().
const mockGetOrganizations = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../../services/api', () => {
  const api = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: (...args: unknown[]) => mockDelete(...args),
  };
  return {
    api,
    default: api,
    getOrganizations: (...args: unknown[]) => mockGetOrganizations(...args),
    adminApi: {},
    instructorApi: {},
  };
});

// AdminShell reads the signed-in user for the sidebar footer.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'sysadmin', firstName: 'Root', lastName: 'Admin', email: 'root@gtacpr.test', role: 'sysadmin' },
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleTheme: vi.fn() }),
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  }),
}));

// Sibling views live at other URLs; stub them so this file exercises the shell + dashboard.
vi.mock('../../admin/UserManager', () => ({ default: () => <div data-testid="user-manager" /> }));
vi.mock('../../admin/CourseManager', () => ({ default: () => <div data-testid="course-manager" /> }));
vi.mock('../../admin/PricingRuleManager', () => ({ default: () => <div data-testid="pricing-manager" /> }));
vi.mock('../../admin/OrganizationDialog', () => ({ default: () => null }));

import SuperAdminPortal from '../SuperAdminPortal';

const organizations = [
  {
    id: 31,
    organizationName: 'Seneca Polytechnic',
    contactName: 'Priya Raman',
    contactEmail: 'priya@seneca.test',
    contactPhone: '+14165550188',
    addressStreet: '1750 Finch Ave E',
    addressCity: 'Toronto',
    addressProvince: 'ON',
  },
  {
    id: 32,
    organizationName: 'Peel Regional Paramedics',
    contactName: 'Owen Tse',
    contactEmail: 'owen@peel.test',
    contactPhone: '+19055550142',
    addressStreet: '10 Peel Centre Dr',
    addressCity: 'Brampton',
    addressProvince: 'ON',
  },
];

// Reports the current URL so we can prove navigation is route-based, not state-based.
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderPortal = (path = '/superadmin/dashboard') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/superadmin/*" element={<SuperAdminPortal />} />
      </Routes>
    </MemoryRouter>
  );

describe('SuperAdminPortal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizations.mockResolvedValue(organizations);
  });

  it('renders the organizations from the API at /superadmin/dashboard', async () => {
    renderPortal();

    await waitFor(() => {
      expect(screen.getByText('Seneca Polytechnic')).toBeInTheDocument();
    });

    expect(mockGetOrganizations).toHaveBeenCalled();
    expect(screen.getByText('Peel Regional Paramedics')).toBeInTheDocument();
    expect(screen.getByText('priya@seneca.test')).toBeInTheDocument();
    expect(screen.getByText('Owen Tse')).toBeInTheDocument();
    expect(screen.getByText('1750 Finch Ave E, Toronto, ON')).toBeInTheDocument();
    expect(screen.queryByText('No organizations found.')).not.toBeInTheDocument();
  });

  it('renders every sidebar nav item and the portal name', async () => {
    renderPortal();

    await waitFor(() => expect(screen.getByText('Seneca Polytechnic')).toBeInTheDocument());

    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
    // Scoped to the sidebar: the active view's label is also the page heading.
    ['Organizations', 'Users', 'Course Types', 'Pricing Rules'].forEach((label) => {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    });
  });

  it('uses URL routes: clicking a nav item changes the path and the rendered view', async () => {
    renderPortal();

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/superadmin/dashboard'));

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sidebar' })).getByText('Users'));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/superadmin/users');
    });
    expect(screen.getByTestId('user-manager')).toBeInTheDocument();
    expect(screen.queryByText('Seneca Polytechnic')).not.toBeInTheDocument();
  });

  it('asks for confirmation before deleting an organization and does not delete on cancel', async () => {
    renderPortal();

    await waitFor(() => expect(screen.getByText('Seneca Polytechnic')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete Seneca Polytechnic' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Seneca Polytechnic will be deleted.');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('redirects a legacy /superadmin/organizations URL to the dashboard', async () => {
    renderPortal('/superadmin/organizations');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/superadmin/dashboard');
    });
  });
});
