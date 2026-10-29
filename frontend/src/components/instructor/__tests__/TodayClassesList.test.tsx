import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

import TodayClassesList from '../TodayClassesList';

const base = { coursetypename: 'CPR Advanced', location: '28 Malborough Road', date: '2026-10-28', studentcount: 3 };

function renderList(classes: React.ComponentProps<typeof TodayClassesList>['classes']) {
  render(<MemoryRouter><TodayClassesList classes={classes} /></MemoryRouter>);
}

describe('TodayClassesList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says whether the instructor has checked in on each class', () => {
    renderList([
      { ...base, id: 11 },
      { ...base, id: 12, instructorReadyAt: '2026-10-28T20:45:42.000Z', instructorReadyDistanceM: 9 },
    ]);

    expect(screen.getByText('Not checked in yet')).toBeInTheDocument();
    expect(screen.getByText('Checked in: Ready 4:45 p.m., 9 m from venue')).toBeInTheDocument();
  });

  it('opens the attendance screen on the class whose button was tapped', () => {
    renderList([{ ...base, id: 11 }, { ...base, id: 12 }]);

    // Each class has a phone button and a desktop button, in class order
    fireEvent.click(screen.getAllByRole('button', { name: 'Take Attendance' })[2]);

    expect(mockNavigate).toHaveBeenCalledWith('/instructor/class-attendance', { state: { classId: 12 } });
  });
});
