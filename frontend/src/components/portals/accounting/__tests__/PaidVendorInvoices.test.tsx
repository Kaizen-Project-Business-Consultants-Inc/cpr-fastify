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

/** The cards come from the aggregate endpoint, never from the list endpoint. */
const isSummaryCall = (args: unknown[]) => String(args[0]).endsWith('/summary');

/**
 * A whole-set aggregate deliberately unlike any page: 42 paid invoices and 58
 * recorded payments, while a page on screen holds at most a handful of rows.
 */
const summary = {
  data: {
    success: true,
    data: {
      total: 42,
      byStatus: {
        pending_submission: 0,
        submitted_to_admin: 0,
        submitted_to_accounting: 0,
        rejected_by_admin: 0,
        rejected_by_accountant: 0,
        paid: 42,
      },
      totalAmount: 52500,
      totalPaid: 41000,
      outstanding: 11500,
      paymentsProcessed: 58,
      mostRecentPaymentAt: '2026-09-17T14:02:00.000Z',
    },
  },
};

describe('accounting PaidVendorInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDetails.mockResolvedValue({ success: true, data: { payments: [] } });
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(isSummaryCall(args) ? summary : page([invoice()]))
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

  it('asks the summary for the same paid set the table pages through', async () => {
    render(<PaidVendorInvoices />);

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices/summary', {
        params: { status: 'paid' },
      })
    );
  });

  it('narrows the summary with the same search text as the table', async () => {
    render(<PaidVendorInvoices />);
    await waitFor(() => expect(screen.getByText('VI-1007')).toBeInTheDocument());

    fireEvent.change(
      screen.getByPlaceholderText('Search paid vendor invoices by invoice # or vendor'),
      { target: { value: 'rescue' } }
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices/summary', {
        params: { status: 'paid', search: 'rescue' },
      })
    );
  });

  it('takes the stat cards from the summary, not from the rows on the page', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? summary
          : page(
              [
                invoice(),
                invoice({ id: 8, invoiceNumber: 'VI-1008' }),
                invoice({ id: 9, invoiceNumber: 'VI-1009' }),
              ],
              { page: 1, limit: 25, total: 42, pages: 2 }
            )
      )
    );
    render(<PaidVendorInvoices />);

    // Three rows on screen, but the cards describe all 42 paid invoices and the
    // 58 payments recorded against them.
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('$41,000.00')).toBeInTheDocument();
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
        isSummaryCall(args)
          ? summary
          : page([invoice()], { page: 1, limit: 25, total: 63, pages: 3 })
      )
    );
    render(<PaidVendorInvoices />);

    expect(await screen.findByText(/of 63 results/)).toBeInTheDocument();
  });

  it('requests page 2 when Next is clicked', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? summary
          : page([invoice()], { page: 1, limit: 25, total: 30, pages: 2 })
      )
    );
    render(<PaidVendorInvoices />);
    await waitFor(() => expect(screen.getByText('VI-1007')).toBeInTheDocument());

    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? summary
          : page([invoice({ id: 8, invoiceNumber: 'VI-1008' })], {
              page: 2,
              limit: 25,
              total: 30,
              pages: 2,
            })
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
