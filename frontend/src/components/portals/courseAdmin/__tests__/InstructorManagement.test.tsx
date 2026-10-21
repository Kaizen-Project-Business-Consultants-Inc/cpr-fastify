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
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/instructors/overview', undefined));
  });

  // Found in UAT 2026-10-20: the table read dates GET /instructors never sent,
  // so it was always empty. Uses the real /instructors/overview row shape.
  it('lists each available day and keeps instructors with no dates editable', async () => {
    const pat = { id: 4, username: 'instructor', email: 'i@x.com', firstName: 'Pat', lastName: 'Lee', instructorName: 'Pat Lee' };
    mockGet.mockImplementation(async (url: string) =>
      url === '/instructors/overview'
        ? { data: { success: true, data: [
            { ...pat, availabilityDate: '2026-10-27', assignmentStatus: 'Available' },
            { ...pat, availabilityDate: '2026-10-28', assignmentStatus: 'Confirmed', assignedOrganization: 'Test Organization' },
            { id: 7, username: 'newbie', email: 'n@x.com', firstName: null, lastName: null, instructorName: 'newbie', availabilityDate: null, assignmentStatus: 'No dates' },
          ] } }
        : { data: { success: true, data: [] } });

    renderWithQuery();

    expect(await screen.findByText('Test Organization')).toBeInTheDocument();
    expect(screen.getAllByText('Pat Lee')).toHaveLength(2);
    expect(screen.getByText('newbie')).toBeInTheDocument();
    expect(screen.getByText('No availability set')).toBeInTheDocument();
    // Remove Date only on the available day, not on the confirmed course.
    expect(screen.getAllByRole('button', { name: 'Remove Date' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThanOrEqual(3);
  });

  it('asks for pending and completed courses 25 at a time and shows the full count', async () => {
    mockGet.mockImplementation(async (url: string) =>
      url === '/courses/pending'
        ? { data: { success: true, data: [], pagination: { page: 1, limit: 25, total: 60, pages: 3 } } }
        : { data: { success: true, data: [] } });

    renderWithQuery();

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/courses/pending', { params: { page: 1, limit: 25 } }));
    expect(mockGet).toHaveBeenCalledWith('/courses/completed', { params: { page: 1, limit: 25 } });
    expect(await screen.findByText('60')).toBeInTheDocument();
  });

  it('loads the next 25 pending courses when Next is clicked', async () => {
    mockGet.mockImplementation(async (url: string, opts?: { params?: { page?: number } }) =>
      url === '/courses/pending'
        ? { data: { success: true, data: [], pagination: { page: opts?.params?.page ?? 1, limit: 25, total: 60, pages: 3 } } }
        : { data: { success: true, data: [] } });

    renderWithQuery();
    await screen.findByText('60');
    // The pending table is the first one with paging.
    fireEvent.click((await screen.findAllByRole('button', { name: /next/i }))[0]);

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/courses/pending', { params: { page: 2, limit: 25 } }));
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
