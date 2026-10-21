import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Owner request 2026-10-20: tap several days, then save them in one request.
const mockSaveBatch = vi.fn();

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../../services/instructorService', () => ({
  useInstructorClasses: () => ({ data: [], isLoading: false }),
  useInstructorAvailability: () => ({ data: [], isLoading: false }),
  useSaveAvailabilityBatch: () => ({ mutateAsync: mockSaveBatch }),
}));

import AvailabilityView from '../AvailabilityView';

const day = (n: number) => screen.getByRole('gridcell', { name: String(n) });

describe('AvailabilityView multi-select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fake only Date, so the calendar opens on October 2026 with the 1st as today.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 1, 9, 0, 0) });
  });
  afterEach(() => vi.useRealTimers());

  function renderView() {
    return render(
      <AvailabilityView
        availableDates={[{ id: 1, date: '2026-10-20' }, { id: 2, date: '2026-10-04' }]}
        scheduledClasses={[{ date: '2026-10-15', organizationname: 'Test Org' }]}
      />
    );
  }

  it('saves two new days and one removal in one batch request, and lists skipped days', async () => {
    mockSaveBatch.mockResolvedValue({
      success: true,
      added: ['2026-10-10'],
      removed: ['2026-10-20'],
      skipped: [{ date: '2026-10-12', reason: 'Already available' }],
    });
    renderView();

    fireEvent.click(day(10));
    fireEvent.click(day(12));
    fireEvent.click(day(20)); // already available, 19 days away → to remove
    fireEvent.click(day(15)); // has a class → not selectable

    const bar = screen.getByRole('region', { name: 'Selected days' });
    expect(within(bar).getByText('2 days to add, 1 to remove')).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/2026-10-10, 2026-10-12/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-10-20/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockSaveBatch).toHaveBeenCalledTimes(1));
    expect(mockSaveBatch).toHaveBeenCalledWith({ add: ['2026-10-10', '2026-10-12'], remove: ['2026-10-20'] });

    expect(await screen.findByText('1 day could not be changed:', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('2026-10-12')).toBeInTheDocument();
    expect(screen.getByText(/Already available/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selected days' })).not.toBeInTheDocument();
  });

  it('tapping a selected day again undoes it, and Clear empties the selection', () => {
    renderView();
    fireEvent.click(day(10));
    fireEvent.click(day(11));
    fireEvent.click(day(10));
    expect(screen.getByText('1 day to add')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('region', { name: 'Selected days' })).not.toBeInTheDocument();
    expect(mockSaveBatch).not.toHaveBeenCalled();
  });

  it('refuses to select a removal 5 days or less away, with the usual message', () => {
    renderView();
    fireEvent.click(day(4)); // available, 3 days away
    expect(screen.getByText(/cannot be cancelled 5 days or less before the date/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selected days' })).not.toBeInTheDocument();
  });
});
