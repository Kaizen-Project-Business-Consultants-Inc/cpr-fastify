import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetTimesheets = vi.fn();
vi.mock('../../../services/timesheetService', () => ({
  timesheetService: { getTimesheets: (...args: unknown[]) => mockGetTimesheets(...args) },
}));

import TimesheetHistory from '../TimesheetHistory';

// Real GET /timesheet row: DATE columns arrive as ISO datetimes.
const timesheet = {
  id: 1,
  instructorId: 4,
  weekStartDate: '2026-10-12T00:00:00.000Z',
  totalHours: '6.00',
  coursesTaught: 2,
  status: 'pending',
  createdAt: '2026-10-19T14:00:00.000Z',
  updatedAt: '2026-10-19T14:00:00.000Z',
  courseDetails: [],
};

describe('TimesheetHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the week from its Monday (not the Sunday before) and asks for the latest 100', async () => {
    mockGetTimesheets.mockResolvedValue({ timesheets: [timesheet], pagination: { page: 1, limit: 100, total: 1, pages: 1 } });
    render(<TimesheetHistory />);
    await waitFor(() => expect(screen.getByText('Oct 12, 2026 - Oct 18, 2026')).toBeInTheDocument());
    expect(mockGetTimesheets).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
  });

  it('says when older timesheets are not shown', async () => {
    mockGetTimesheets.mockResolvedValue({ timesheets: [timesheet], pagination: { page: 1, limit: 100, total: 130, pages: 2 } });
    render(<TimesheetHistory />);
    await waitFor(() => expect(screen.getByText('Showing the latest 1 of 130 timesheets.')).toBeInTheDocument());
  });

  it("shows the server's error text", async () => {
    mockGetTimesheets.mockRejectedValue({ response: { status: 500, data: { error: 'Database unavailable' } }, message: 'Request failed with status code 500' });
    render(<TimesheetHistory />);
    await waitFor(() => expect(screen.getByText('Database unavailable')).toBeInTheDocument());
  });
});
