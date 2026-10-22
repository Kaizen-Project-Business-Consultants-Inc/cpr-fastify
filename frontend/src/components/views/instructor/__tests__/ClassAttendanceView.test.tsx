import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetClassesToday = vi.fn();
const mockGetClassStudents = vi.fn();
const mockCompleteClass = vi.fn();

vi.mock('../../../../services/api', () => ({
  instructorApi: {
    getClassesToday: (...args: unknown[]) => mockGetClassesToday(...args),
    getClassStudents: (...args: unknown[]) => mockGetClassStudents(...args),
    completeClass: (...args: unknown[]) => mockCompleteClass(...args),
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
