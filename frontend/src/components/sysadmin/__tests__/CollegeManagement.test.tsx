import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { mockGetAllAdmin, mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockGetAllAdmin: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  collegesApi: { getAllAdmin: mockGetAllAdmin, create: mockCreate, update: mockUpdate, delete: vi.fn() },
}));

import CollegeManagement from '../CollegeManagement';

describe('CollegeManagement', () => {
  const snackbar = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllAdmin.mockResolvedValue({ data: { data: [
      { id: 1, name: 'Seneca', is_active: 1 },
      { id: 2, name: 'Old School', is_active: 0 },
    ] } });
  });

  it('lists colleges, including hidden ones', async () => {
    render(<CollegeManagement onShowSnackbar={snackbar} />);
    expect(await screen.findByText('Seneca')).toBeInTheDocument();
    expect(screen.getByText('Old School')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Seneca' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Old School' })).toBeInTheDocument();
  });

  it('adds a college and reloads the list', async () => {
    mockCreate.mockResolvedValue({});
    render(<CollegeManagement onShowSnackbar={snackbar} />);
    await screen.findByText('Seneca');

    fireEvent.click(screen.getByRole('button', { name: '+ Add College' }));
    fireEvent.change(screen.getByLabelText('College or school name'), { target: { value: ' Humber ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Humber'));
    expect(snackbar).toHaveBeenCalledWith('Humber added', 'success');
    await waitFor(() => expect(mockGetAllAdmin).toHaveBeenCalledTimes(2));
  });

  it('shows the server error in the dialog when a name is taken', async () => {
    mockCreate.mockRejectedValue({ response: { data: { error: 'College with this name already exists' } } });
    render(<CollegeManagement onShowSnackbar={snackbar} />);
    await screen.findByText('Seneca');

    fireEvent.click(screen.getByRole('button', { name: '+ Add College' }));
    fireEvent.change(screen.getByLabelText('College or school name'), { target: { value: 'Seneca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('College with this name already exists')).toBeInTheDocument();
  });

  it('hides a shown college', async () => {
    mockUpdate.mockResolvedValue({});
    render(<CollegeManagement onShowSnackbar={snackbar} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide Seneca' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(1, { isActive: false }));
  });
});
