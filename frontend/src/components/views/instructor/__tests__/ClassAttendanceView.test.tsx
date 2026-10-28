import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetClassesToday = vi.fn();
const mockGetClassStudents = vi.fn();
const mockCompleteClass = vi.fn();
const mockMarkReady = vi.fn();

vi.mock('../../../../services/api', () => ({
  instructorApi: {
    getClassesToday: (...args: unknown[]) => mockGetClassesToday(...args),
    getClassStudents: (...args: unknown[]) => mockGetClassStudents(...args),
    completeClass: (...args: unknown[]) => mockCompleteClass(...args),
    markReady: (...args: unknown[]) => mockMarkReady(...args),
  },
  collegesApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock('../../../../services/errorHandler', () => ({ handleError: vi.fn() }));

vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 4 } }) }));

import ClassAttendanceView from '../ClassAttendanceView';

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(<QueryClientProvider client={queryClient}><ClassAttendanceView /></QueryClientProvider>);
  return { invalidate };
}

function renderViewWithUnmount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ClassAttendanceView /></QueryClientProvider>);
}

describe('ClassAttendanceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClassesToday.mockResolvedValue({
      data: {
        data: [{
          courseId: 7, name: 'CPR Basic', organizationname: 'Test Organization', location: 'Room 1',
          startTime: '09:00:00', endTime: '13:00:00',
        }],
      },
    });
    // Real /instructor/classes/:id/students shape from MariaDB: TINYINT flags arrive as 0/1.
    mockGetClassStudents.mockResolvedValue({
      data: {
        data: [
          { studentid: '1', firstname: 'Ava', lastname: 'Lee', attendance: 1, attendanceMarked: 1 },
          { studentid: '2', firstname: 'Cy', lastname: 'Ng', attendance: 0, attendanceMarked: 1 },
          { studentid: '3', firstname: 'Bo', lastname: 'Ma', attendance: 0, attendanceMarked: 0 },
        ],
      },
    });
  });

  it('exposes 0/1 attendance flags as a valid aria-pressed state and counts them', async () => {
    renderView();

    const avaPresent = await screen.findByRole('button', { name: 'Mark Ava Lee present' });
    expect(avaPresent).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mark Ava Lee absent' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Mark Cy Ng absent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mark Bo Ma present' })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByText('1 Present')).toBeInTheDocument();
    expect(screen.getByText('1 Absent')).toBeInTheDocument();
    expect(screen.getByText('1 Not Marked')).toBeInTheDocument();
  });

  // UAT 2026-10-21: a completed class vanished from Class Attendance but did not
  // show in Archive, because the portal's cached lists were never reloaded.
  it('reloads the cached instructor lists after completing a class', async () => {
    mockGetClassStudents.mockResolvedValue({
      data: { data: [{ studentid: '1', firstname: 'Ava', lastname: 'Lee', attendance: 1, attendanceMarked: 1 }] },
    });
    mockCompleteClass.mockResolvedValue({ data: { success: true } });
    const { invalidate } = renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Complete Class' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Complete Class' }));

    await waitFor(() => expect(mockCompleteClass).toHaveBeenCalledWith(7, ''));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['instructor'] }));
  });
});

describe("ClassAttendanceView check-in (I'm ready)", () => {
  const CLASS = { courseId: 7, name: 'CPR Basic', organizationname: 'Test Organization', location: 'Room 1', startTime: '09:00:00', endTime: '13:00:00' };

  /** A phone that reports a position as soon as the screen listens. */
  const realGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  function stubPhone(accuracy = 9) {
    const clearWatch = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (ok: (p: unknown) => void) => { setTimeout(() => ok({ coords: { latitude: 43.8, longitude: -79.2, accuracy } }), 0); return 1; },
        clearWatch,
      },
    });
    return clearWatch;
  }
  /** A phone that never answers, so the screen stays "finding your location". */
  function stubSilentPhone() {
    const clearWatch = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition: () => 1, clearWatch },
    });
    return clearWatch;
  }

  afterEach(() => {
    if (realGeolocation) Object.defineProperty(navigator, 'geolocation', realGeolocation);
    else delete (navigator as unknown as { geolocation?: unknown }).geolocation;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClassStudents.mockResolvedValue({ data: { data: [] } });
    mockGetClassesToday.mockResolvedValue({ data: { data: [CLASS] } });
  });

  it('sends the phone position and then shows when and how far from the venue they checked in', async () => {
    stubPhone();
    mockMarkReady.mockResolvedValue({ data: { data: { distanceMeters: 14 } } });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));

    await waitFor(() => expect(mockMarkReady).toHaveBeenCalledWith(7, { lat: 43.8, lng: -79.2, accuracy: 9 }));
    expect(await screen.findByText('Checked in')).toBeInTheDocument();
    expect(screen.getByText(/, 14 m from venue$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "I'm ready" })).toBeNull();
  });

  it('shows the explanation the server gives when the instructor is not at the venue, and stays available', async () => {
    stubPhone();
    mockMarkReady.mockRejectedValue({ response: { status: 422, data: { error: 'You are about 1.2 km from the venue. You can check in once you are within 300 m.' } } });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));

    expect(await screen.findByText(/about 1\.2 km from the venue/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready" })).toBeEnabled();
  });

  it('shows a class that is already checked in without offering the button again', async () => {
    mockGetClassesToday.mockResolvedValue({ data: { data: [{ ...CLASS, instructorReadyAt: '2026-10-28T20:45:42.000Z', instructorReadyDistanceM: 9 }] } });
    renderView();

    expect(await screen.findByText('Checked in')).toBeInTheDocument();
    expect(screen.getByText(/, 9 m from venue$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "I'm ready" })).toBeNull();
  });

  it('stops looking for the location and sends nothing when the screen is left mid check-in', async () => {
    const clearWatch = stubSilentPhone();
    const { unmount } = renderViewWithUnmount();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));
    expect(await screen.findByText('Finding your location…')).toBeInTheDocument();
    unmount();

    expect(clearWatch).toHaveBeenCalled();
    expect(mockMarkReady).not.toHaveBeenCalled();
  });

  it('shows the server message when the class is not found', async () => {
    stubPhone();
    mockMarkReady.mockRejectedValue({ response: { status: 404, data: { error: 'Class not found' } } });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));

    expect(await screen.findByText('Class not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready" })).toBeEnabled();
  });

  it('shows a plain message for other failures', async () => {
    stubPhone();
    mockMarkReady.mockRejectedValue(new Error('network'));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));

    expect(await screen.findByText(/could not check you in right now/)).toBeInTheDocument();
  });

  it('uses the time and distance the server recorded and names the class', async () => {
    stubPhone();
    mockMarkReady.mockResolvedValue({ data: { data: { readyAt: '2026-10-28T20:45:42.000Z', distanceMeters: 21 } } });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));

    expect(await screen.findByText(/, 21 m from venue$/)).toBeInTheDocument();
    expect(screen.getByText("You're checked in as ready for CPR Basic.")).toBeInTheDocument();
  });

  it('does not reload the roster when the check-in status changes', async () => {
    stubPhone();
    mockMarkReady.mockResolvedValue({ data: { data: { readyAt: '2026-10-28T20:45:42.000Z', distanceMeters: 5 } } });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: "I'm ready" }));
    await screen.findByText('Checked in');

    expect(mockGetClassStudents).toHaveBeenCalledTimes(1);
  });
});
