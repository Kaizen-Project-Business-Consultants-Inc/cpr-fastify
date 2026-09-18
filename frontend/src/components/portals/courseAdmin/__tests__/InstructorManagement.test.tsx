import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API module the way AuditLogViewer.test does: named + default exports.
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../../../services/api', () => {
  const api = {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  };
  return {
    api,
    default: api,
    fetchCourseAdminDashboardData: vi.fn().mockResolvedValue({}),
    adminApi: {},
    instructorApi: {},
  };
});

vi.mock('../../../../contexts/RealtimeContext', () => ({
  useRealtime: () => ({ isConnected: true, lastUpdate: null }),
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

// Child components that fetch their own data are stubbed out.
vi.mock('../InstructorDashboard', () => ({ default: () => <div data-testid="instructor-dashboard" /> }));
vi.mock('../../../dialogs/AdminViewStudentsDialog', () => ({ default: () => null }));

import InstructorManagement from '../InstructorManagement';

const renderWithQuery = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InstructorManagement />
    </QueryClientProvider>
  );
};

describe('InstructorManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every list endpoint returns an empty list by default
    mockGet.mockResolvedValue({ data: { success: true, data: [] } });
  });

  it('renders the section headings', async () => {
    renderWithQuery();
    expect(screen.getByText('Pending Course Requests')).toBeInTheDocument();
    expect(screen.getByText(/Instructor Availability/)).toBeInTheDocument();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/instructors'));
  });

  it('shows the "Add Instructor" button', async () => {
    renderWithQuery();
    expect(screen.getByRole('button', { name: 'Add Instructor' })).toBeInTheDocument();
  });

  it('opens the add dialog with a username field', async () => {
    renderWithQuery();
    fireEvent.click(screen.getByRole('button', { name: 'Add Instructor' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/First name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
  });

  it('validates required fields before posting', async () => {
    renderWithQuery();
    fireEvent.click(screen.getByRole('button', { name: 'Add Instructor' }));
    await waitFor(() => expect(screen.getByLabelText(/Username/)).toBeInTheDocument());

    // Submit the dialog form with everything blank
    const dialog = screen.getByRole('dialog');
    const submit = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByText('Username is required')).toBeInTheDocument();
    });
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
