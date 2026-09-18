import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGet = vi.fn();

vi.mock('../../../../services/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  adminApi: {
    getAccountingVendorInvoiceDetails: vi.fn().mockResolvedValue({ data: { payments: [] } }),
    approveVendorInvoice: vi.fn().mockResolvedValue({ success: true }),
    downloadVendorInvoice: vi.fn(),
    updateVendorInvoiceNotes: vi.fn().mockResolvedValue({ success: true }),
  },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

vi.mock('../../../../hooks/useVendorInvoiceUpdates', () => ({
  useVendorInvoiceUpdates: () => ({ isConnected: true }),
}));

import VendorInvoiceApproval from '../VendorInvoiceApproval';

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  invoiceNumber: 'VI-3001',
  item: 'Training',
  billingCompany: 'Rescue Supply Co',
  quantity: 2,
  description: 'Instructor day rate',
  rate: 500,
  amount: 1000,
  subtotal: 1000,
  hst: 130,
  total: 1130,
  status: 'submitted_to_admin',
  createdAt: '2026-08-01',
  dueDate: '2026-08-31',
  vendorName: 'Rescue Supply Co',
  vendorEmail: 'ap@rescuesupply.example',
  ...overrides,
});

/** The cards come from the aggregate endpoint, never from the list endpoint. */
const isSummaryCall = (args: unknown[]) => String(args[0]).endsWith('/summary');

const listPage = (rows: unknown[], pagination?: Record<string, number>) => ({
  data: {
    success: true,
    data: rows,
    pagination: pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
  },
});

/**
 * A whole-set aggregate deliberately unlike any page: 42 invoices in total, of
 * which 26 are paid, while a page on screen holds at most a handful of rows.
 */
const summaryOf = (byStatus: Record<string, number> = {}) => ({
  data: {
    success: true,
    data: {
      total: 42,
      byStatus: {
        pending_submission: 4,
        submitted_to_admin: 5,
        submitted_to_accounting: 4,
        rejected_by_admin: 2,
        rejected_by_accountant: 1,
        paid: 26,
        ...byStatus,
      },
      totalAmount: 50000,
      totalPaid: 41000,
      outstanding: 9000,
      paymentsProcessed: 58,
      mostRecentPaymentAt: '2026-09-17T14:02:00.000Z',
    },
  },
});

describe('VendorInvoiceApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(isSummaryCall(args) ? summaryOf() : listPage([invoice()]))
    );
  });

  it('asks the server for the not-yet-paid invoices, 25 to a page', async () => {
    render(<VendorInvoiceApproval />);

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/vendor-invoices', {
        params: { page: 1, limit: 25, status: 'unpaid' },
      })
    );
  });

  it('renders the rows the server returned', async () => {
    render(<VendorInvoiceApproval />);

    expect(await screen.findByText('VI-3001')).toBeInTheDocument();
    expect(screen.getAllByText('Rescue Supply Co').length).toBeGreaterThan(0);
  });

  it('counts the stat cards from the summary, not from the rows on the page', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? summaryOf()
          : listPage([
              invoice(),
              invoice({ id: 4, invoiceNumber: 'VI-3002' }),
              invoice({ id: 5, invoiceNumber: 'VI-3003' }),
            ])
      )
    );
    render(<VendorInvoiceApproval />);

    // The page holds three rows, but Paid reads the whole-set 26, Submitted to
    // Admin reads 5, and Rejected sums the two rejected statuses (2 + 1 = 3).
    expect(await screen.findByText('26')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('asks the summary once, with no status and no search', async () => {
    render(<VendorInvoiceApproval />);

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/vendor-invoices/summary', { params: {} })
    );
    const summaryCalls = mockGet.mock.calls.filter((args) => isSummaryCall(args));
    expect(summaryCalls).toHaveLength(1);
  });

  it('narrows the summary with the same search text as the table', async () => {
    render(<VendorInvoiceApproval />);
    expect(await screen.findByText('VI-3001')).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText('Search vendor invoices by invoice # or vendor'),
      { target: { value: 'rescue' } }
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/vendor-invoices/summary', {
        params: { search: 'rescue' },
      })
    );
  });

  it('requests page 2 when Next is clicked', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? summaryOf()
          : listPage([invoice()], { page: 1, limit: 25, total: 40, pages: 2 })
      )
    );
    render(<VendorInvoiceApproval />);
    expect(await screen.findByText('VI-3001')).toBeInTheDocument();

    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? summaryOf()
          : listPage([invoice({ id: 4, invoiceNumber: 'VI-3002' })], {
              page: 2,
              limit: 25,
              total: 40,
              pages: 2,
            })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/vendor-invoices', {
        params: { page: 2, limit: 25, status: 'unpaid' },
      })
    );
    expect(await screen.findByText('VI-3002')).toBeInTheDocument();
  });

  it('sends the picked status straight through to the server', async () => {
    render(<VendorInvoiceApproval />);
    expect(await screen.findByText('VI-3001')).toBeInTheDocument();

    // The status picker is the only combobox on the screen.
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Submitted to Accounting' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/vendor-invoices', {
        params: { page: 1, limit: 25, status: 'submitted_to_accounting' },
      })
    );
  });
});
