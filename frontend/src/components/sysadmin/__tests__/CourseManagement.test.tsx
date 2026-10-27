import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { mockGetCourses, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockGetCourses: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  sysAdminApi: { getCourses: mockGetCourses, updateCourse: mockUpdate, deleteCourse: mockDelete, createCourse: vi.fn() },
}));

import CourseManagement from '../CourseManagement';

const course = (over: Record<string, unknown>) => ({
  id: '1', name: 'CPR Basic', duration_minutes: 120, certification_validity_months: 24,
  isActive: true, requestCount: 0, priceCount: 0, ...over,
});

describe('CourseManagement active / inactive groups', () => {
  const snackbar = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCourses.mockResolvedValue({ data: [
      course({ id: '1', name: 'CPR Basic' }),
      course({ id: '2', name: 'CPR Advanced', isActive: false, requestCount: 3 }),
      course({ id: '3', name: 'UAT Course', isActive: false }),
      course({ id: '4', name: 'Priced Old', isActive: false, priceCount: 2 }),
    ] });
  });

  it('shows active courses first, with counts on both buttons', async () => {
    render(<CourseManagement onShowSnackbar={snackbar} />);
    expect(await screen.findByText('CPR Basic')).toBeInTheDocument();
    expect(screen.queryByText('CPR Advanced')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inactive (3)' })).toBeInTheDocument();
  });

  it('lists inactive courses with why each is kept, and offers Delete only to a never-used one', async () => {
    render(<CourseManagement onShowSnackbar={snackbar} />);
    await screen.findByText('CPR Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive (3)' }));

    expect(screen.queryByText('CPR Basic')).not.toBeInTheDocument();
    expect(screen.getByText('Used by 3 requests, so it is kept on record')).toBeInTheDocument();
    expect(screen.getByText('Never used')).toBeInTheDocument();
    expect(screen.getByText('Has 2 price records, so it is kept on record')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reactivate / })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Delete UAT Course permanently' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete CPR Advanced permanently' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Priced Old permanently' })).not.toBeInTheDocument();
  });

  it('reactivates after a confirm, then returns to the Active list', async () => {
    mockUpdate.mockResolvedValue({});
    render(<CourseManagement onShowSnackbar={snackbar} />);
    await screen.findByText('CPR Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive (3)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate CPR Advanced' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(2, { is_active: true }));
    expect(snackbar).toHaveBeenCalledWith('CPR Advanced is active again', 'success');
    expect(mockGetCourses).toHaveBeenCalledTimes(2);
  });

  it('deletes a never-used course only after a confirm', async () => {
    mockDelete.mockResolvedValue({});
    render(<CourseManagement onShowSnackbar={snackbar} />);
    await screen.findByText('CPR Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive (3)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete UAT Course permanently' }));
    expect(mockDelete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(3));
    expect(snackbar).toHaveBeenCalledWith('UAT Course deleted', 'success');
  });

  it('says so when the server only kept the course as Inactive', async () => {
    mockDelete.mockResolvedValue({ softDeleted: true });
    render(<CourseManagement onShowSnackbar={snackbar} />);
    await screen.findByText('CPR Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive (3)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete UAT Course permanently' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(snackbar).toHaveBeenCalledWith('UAT Course was used meanwhile, so it was kept as Inactive', 'success'));
  });

  it('says so when a group is empty', async () => {
    mockGetCourses.mockResolvedValue({ data: [course({ id: '1', name: 'CPR Basic' })] });
    render(<CourseManagement onShowSnackbar={snackbar} />);
    await screen.findByText('CPR Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive (0)' }));
    expect(screen.getByText('No inactive course types.')).toBeInTheDocument();
  });
});
