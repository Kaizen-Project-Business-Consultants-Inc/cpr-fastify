import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGet = vi.fn();
const mockGetDetails = vi.fn();

vi.mock('../../../../services/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  adminApi: {
    getAccountingVendorInvoiceDetails: (...args: unknown[]) => mockGetDetails(...args),
  },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

vi.mock('../../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../../hooks/useVendorInvoiceUpdates', () => ({
  useVendorInvoiceUpdates: () => ({ isConnected: true }),
}));

import PaidVendorInvoices from '../PaidVendorInvoices';

const invoice = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const page = (rows: unknown[], pagination?: Record<string, number>) => ({
  data: {
    success: true,
    data: rows,
    pagination: pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
  },
});

/** The unpaginated summary call (no page/limit) answers with the full array. */
const all = (rows: unknown[]) => ({ data: { success: true, data: rows } });

const isPagedCall = (args: unknown[]) =>
  Boolean((args[1] as { params?: { page?: number } } | undefined)?.params?.page);

describe('accounting PaidVendorInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDetails.mockResolvedValue({ success: true, data: { payments: [] } });
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(isPagedCall(args) ? page([invoice()]) : all([invoice()]))
    );
  });

  it('asks the server for paid invoices only, 25 to a page', async () => {
    render(<PaidVendorInvoices />);

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices', {
        params: { status: 'paid', page: 1, limit: 25 },
      })
    );
  });

  it('lists paid invoices with the amount actually paid', async () => {
    render(<PaidVendorInvoices />);
    await waitFor(() => expect(screen.getByText('VI-1007')).toBeInTheDocument());
    expect(screen.getAllByText('$1,250.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThan(0);
  });

  it('takes the invoice count from the server total, not the page length', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isPagedCall(args)
          ? page([invoice()], { page: 1, limit: 25, total: 63, pages: 3 })
          : all([invoice()])
      )
    );
    render(<PaidVendorInvoices />);

    expect(await screen.findByText(/of 63 results/)).toBeInTheDocument();
  });

  it('requests page 2 when Next is clicked', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isPagedCall(args)
          ? page([invoice()], { page: 1, limit: 25, total: 30, pages: 2 })
          : all([invoice()])
      )
    );
    render(<PaidVendorInvoices />);
    await waitFor(() => expect(screen.getByText('VI-1007')).toBeInTheDocument());

    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isPagedCall(args)
          ? page([invoice({ id: 8, invoiceNumber: 'VI-1008' })], {
              page: 2,
              limit: 25,
              total: 30,
              pages: 2,
            })
          : all([invoice()])
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices', {
        params: { status: 'paid', page: 2, limit: 25 },
      })
    );
    expect(await screen.findByText('VI-1008')).toBeInTheDocument();
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
