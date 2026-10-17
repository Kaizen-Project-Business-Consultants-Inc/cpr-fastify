import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUpdateStudentAttendance = vi.fn();
vi.mock('../../../../services/api', () => ({
  instructorApi: { updateStudentAttendance: (...args: unknown[]) => mockUpdateStudentAttendance(...args) },
}));
// Stable references, like react-query's: a new array each render would re-seed the roster forever.
const { todayClasses, roster } = vi.hoisted(() => ({
  todayClasses: { data: [{ courseId: 7, name: 'CPR Level C', organizationName: 'Test Org' }], isLoading: false, error: null },
  // The roster endpoint sends lower-case keys.
  roster: { data: [{ studentid: '5', firstname: 'Ana', lastname: 'Bo', email: 'ana@x.com', attendance: false, attendanceMarked: false }], isLoading: false },
}));
vi.mock('../../../../services/instructorService', () => ({
  INSTRUCTOR_QUERY_KEYS: { classStudents: (id: number) => ['instructor', 'classes', id, 'students'] },
  useTodayClasses: () => todayClasses,
  useClassStudents: () => roster,
}));
vi.mock('../../../../services/errorHandler', () => ({ handleError: vi.fn() }));

import AttendanceView from '../AttendanceView';

describe('AttendanceView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the roster names and marks just the ticked student', async () => {
    mockUpdateStudentAttendance.mockResolvedValue({ data: { success: true } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AttendanceView />
      </QueryClientProvider>
    );

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /CPR Level C/ }));

    expect(await screen.findByText('Ana Bo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(mockUpdateStudentAttendance).toHaveBeenCalledWith(7, '5', true));
    expect(await screen.findByText('Present')).toBeInTheDocument();
  });

  it('puts the box back when saving fails', async () => {
    mockUpdateStudentAttendance.mockRejectedValue(new Error('offline'));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AttendanceView />
      </QueryClientProvider>
    );

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /CPR Level C/ }));
    fireEvent.click(await screen.findByRole('checkbox'));

    expect(await screen.findByText('Failed to update attendance')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Not Marked')).toBeInTheDocument();
  });
});
