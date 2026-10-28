import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get: mockGet } }));

import VerifyCertificate from '../VerifyCertificate';

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/verify" element={<VerifyCertificate />} />
      <Route path="/verify/:number" element={<VerifyCertificate />} />
    </Routes>
  </MemoryRouter>
);

describe('VerifyCertificate (public)', () => {
  beforeEach(() => { mockGet.mockClear(); });

  it('checks the number in the address and shows a valid certificate', async () => {
    mockGet.mockResolvedValue({ data: { data: {
      number: 'GTACPR-2026-000007', studentName: 'Sam S.', courseName: 'CPR Basic',
      issuedOn: '2026-10-27', expiresOn: '2028-10-27', status: 'valid',
    } } });
    renderAt('/verify/GTACPR-2026-000007');

    expect(await screen.findByText('This certificate is valid')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/certificates/verify/GTACPR-2026-000007');
    expect(screen.getByText('Issued to: Sam S.')).toBeInTheDocument();
    expect(screen.getByText('Valid until: October 27, 2028')).toBeInTheDocument();
  });

  it('says so when the certificate has expired', async () => {
    mockGet.mockResolvedValue({ data: { data: {
      number: 'GTACPR-2024-000001', studentName: 'Sam S.', courseName: 'CPR Basic',
      issuedOn: '2024-01-05', expiresOn: '2026-01-05', status: 'expired',
    } } });
    renderAt('/verify/GTACPR-2024-000001');
    expect(await screen.findByText('This certificate has expired')).toBeInTheDocument();
    expect(screen.getByText('Expired on: January 5, 2026')).toBeInTheDocument();
  });

  it('says so when there is no such certificate', async () => {
    // A real axios error is an Error carrying the response
    mockGet.mockImplementation(() => Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } })));
    renderAt('/verify/GTACPR-2026-999999');
    expect(await screen.findByText(/No certificate was found with that number/)).toBeInTheDocument();
  });

  it('looks up what is typed in the box', async () => {
    mockGet.mockResolvedValue({ data: { data: {
      number: 'GTACPR-2026-000007', studentName: 'Sam S.', courseName: 'CPR Basic',
      issuedOn: '2026-10-27', expiresOn: null, status: 'valid',
    } } });
    renderAt('/verify');
    expect(mockGet).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Certificate number'), { target: { value: ' GTACPR-2026-000007 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/certificates/verify/GTACPR-2026-000007'));
    expect(await screen.findByText('This certificate is valid')).toBeInTheDocument();
    expect(screen.queryByText(/Valid until/)).not.toBeInTheDocument();
  });
});
