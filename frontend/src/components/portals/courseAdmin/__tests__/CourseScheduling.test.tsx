import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock('../../../../services/api', () => {
  const api = {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: vi.fn(),
    delete: vi.fn(),
  };
  return { api, default: api };
});

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

import CourseScheduling from '../CourseScheduling';

// Real GET /courses/confirmed row (CourseRequestRepository LIST_COLS): DATE columns are ISO datetimes.
const course = {
  id: 31,
  courseTypeName: 'CPR Basic',
  organizationName: 'Test Organization',
  location: '300 Front St W',
  registeredStudents: 12,
  scheduledDate: '2026-11-03T00:00:00.000Z',
  confirmedDate: '2026-11-05T00:00:00.000Z',
  instructorName: 'instructor',
  status: 'confirmed',
};

const renderIt = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CourseScheduling />
    </QueryClientProvider>
  );
};

describe('CourseScheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { success: true, data: [course] } });
  });

  it('shows the confirmed date and filters on it as a calendar day', async () => {
    renderIt();
    await waitFor(() => expect(screen.getByText('Nov 5, 2026')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-05' } });
    expect(screen.getByText('CPR Basic')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-03' } });
    expect(screen.getByText('No courses match the selected filters')).toBeInTheDocument();
  });

  it("names the course and organization in the cancel dialog and shows the server's reason on failure", async () => {
    mockPut.mockRejectedValue({ response: { status: 400, data: { error: 'Course is already invoiced' } }, message: 'Request failed with status code 400' });
    renderIt();
    await waitFor(() => expect(screen.getByText('CPR Basic')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Cancel'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('CPR Basic')).toBeInTheDocument();
    expect(within(dialog).getByText('Test Organization')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Reason for Cancellation/), { target: { value: 'Venue closed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel Course' }));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Course is already invoiced'));
    expect(mockPut).toHaveBeenCalledWith('/courses/31/cancel', { reason: 'Venue closed' });
  });
});
