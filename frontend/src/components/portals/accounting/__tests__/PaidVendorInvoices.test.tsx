import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGetInvoices = vi.fn();
const mockGetDetails = vi.fn();

vi.mock('../../../../services/api', () => ({
  adminApi: {
    getAccountingVendorInvoices: (...args: unknown[]) => mockGetInvoices(...args),
    getAccountingVendorInvoiceDetails: (...args: unknown[]) => mockGetDetails(...args),
  },
  default: { get: vi.fn() },
}));

vi.mock('../../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../../hooks/useVendorInvoiceUpdates', () => ({
  useVendorInvoiceUpdates: () => ({ isConnected: true }),
}));

import PaidVendorInvoices from '../PaidVendorInvoices';

const invoice = {
  id: 7,
  invoiceNumber: 'VI-1007',
  description: 'Manikin rental',
  total: '1250.00',
  status: 'paid',
  createdAt: '2026-08-01',
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-31',
  vendorName: 'Rescue Supply Co',
  vendorEmail: 'ap@rescuesupply.example',
  vendorContact: 'Pat',
  vendorPaymentMethod: 'direct_deposit',
  approvedByName: 'Admin',
  approvedByEmail: 'admin@example.com',
  sentToAccountingAt: '2026-08-02',
  totalPaid: 1000,
  balanceDue: 250,
  paidAt: '2026-08-15',
  adminNotes: '',
};

describe('PaidVendorInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInvoices.mockResolvedValue({ success: true, data: [invoice] });
    mockGetDetails.mockResolvedValue({ success: true, data: { payments: [] } });
  });

  it('lists paid invoices with the amount actually paid', async () => {
    render(<PaidVendorInvoices />);
    await waitFor(() => expect(screen.getByText('VI-1007')).toBeInTheDocument());
    expect(screen.getAllByText('$1,250.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThan(0);
  });

  it('computes Balance Due as total minus totalPaid in the detail dialog', async () => {
    render(<PaidVendorInvoices />);
    await waitFor(() => expect(screen.getByText('VI-1007')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'View invoice VI-1007' }));

    await waitFor(() => expect(screen.getByText('Balance Due')).toBeInTheDocument());
    expect(screen.getByText('$250.00')).toBeInTheDocument();
    expect(mockGetDetails).toHaveBeenCalledWith(7);
  });
});
