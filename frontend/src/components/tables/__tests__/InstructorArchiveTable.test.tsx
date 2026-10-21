import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InstructorArchiveTable from '../InstructorArchiveTable';

// Real GET /instructor/classes/completed row (no camelCase layer).
const row = {
  id: 9,
  courseId: 9,
  date: '2026-10-14',
  name: 'CPR Basic',
  organizationname: 'Test Organization',
  location: '300 Front St W',
  max_students: 12,
  studentcount: 10,
  studentsattendance: 8,
  completedAt: '2026-10-15T15:30:00.000Z',
};

describe('InstructorArchiveTable', () => {
  it('shows the course name, roster count, attendance and completion date the server sends', () => {
    render(<InstructorArchiveTable courses={[row]} />);
    expect(screen.getByText('CPR Basic')).toBeInTheDocument();
    expect(screen.getByText('Test Organization')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Oct 14, 2026')).toBeInTheDocument();
    expect(screen.getByText('Oct 15, 2026')).toBeInTheDocument();
  });

  it('falls back to the requested size and the class date', () => {
    render(<InstructorArchiveTable courses={[{ ...row, studentcount: 0, completedAt: null }]} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('Oct 14, 2026')).toHaveLength(2);
  });
});
