import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetClassesToday = vi.fn();
const mockGetClassStudents = vi.fn();

vi.mock('../../../../services/api', () => ({
  instructorApi: {
    getClassesToday: (...args: unknown[]) => mockGetClassesToday(...args),
    getClassStudents: (...args: unknown[]) => mockGetClassStudents(...args),
  },
  collegesApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock('../../../../services/errorHandler', () => ({ handleError: vi.fn() }));

import ClassAttendanceView from '../ClassAttendanceView';

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
    render(<ClassAttendanceView />);

    const avaPresent = await screen.findByRole('button', { name: 'Mark Ava Lee present' });
    expect(avaPresent).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mark Ava Lee absent' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Mark Cy Ng absent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mark Bo Ma present' })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByText('1 Present')).toBeInTheDocument();
    expect(screen.getByText('1 Absent')).toBeInTheDocument();
    expect(screen.getByText('1 Not Marked')).toBeInTheDocument();
  });
});
