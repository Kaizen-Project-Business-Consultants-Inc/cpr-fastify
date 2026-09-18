import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGet = vi.fn();

vi.mock('../../../../services/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  adminApi: {
    getAccountingVendorInvoiceDetails: vi.fn().mockResolvedValue({
      success: true,
      data: { payments: [] },
    }),
    processVendorPayment: vi.fn().mockResolvedValue({ success: true }),
  },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

vi.mock('../../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../../hooks/useVendorInvoiceUpdates', () => ({
  useVendorInvoiceUpdates: () => ({ isConnected: true }),
}));

import VendorInvoiceManagement from '../VendorInvoiceManagement';

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  invoiceNumber: 'VI-2001',
  item: 'Supplies',
  billingCompany: 'Rescue Supply Co',
  quantity: 1,
  description: 'AED pads',
  rate: 200,
  amount: 200,
  subtotal: 200,
  hst: 26,
  total: 226,
  status: 'submitted_to_accounting',
  createdAt: '2026-08-01',
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-31',
  vendorName: 'Rescue Supply Co',
  vendorEmail: 'ap@rescuesupply.example',
  vendorContact: 'Pat',
  vendorPaymentMethod: 'check',
  bankName: '',
  accountNumber: '',
  routingNumber: '',
  approvedByName: 'Admin',
  approvedByEmail: 'admin@example.com',
  sentToAccountingAt: '2026-08-02',
  totalPaid: 0,
  balanceDue: 226,
  paymentStatus: 'unpaid',
  adminNotes: '',
  ...overrides,
});

const isSummaryCall = (args: unknown[]) => String(args[0]).endsWith('/summary');

/** The one remaining row fetch: non-paid invoices, read only for `paymentStatus`. */
const isUnpaidRowsCall = (args: unknown[]) => {
  const params = (args[1] as { params?: Record<string, unknown> } | undefined)?.params;
  return !isSummaryCall(args) && params?.status === 'unpaid' && params?.page === undefined;
};

const listPage = (rows: unknown[], pagination?: Record<string, number>) => ({
  data: {
    success: true,
    data: rows,
    pagination: pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
  },
});

/**
 * The whole-set aggregate: 42 invoices, 26 of them paid, so "Pending Invoices
 * (Non-Paid)" must read 16 no matter what the table is filtered to.
 */
const summary = {
  data: {
    success: true,
    data: {
      total: 42,
      partiallyPaid: 2,
      byStatus: {
        pending_submission: 3,
        submitted_to_admin: 5,
        submitted_to_accounting: 6,
        rejected_by_admin: 1,
        rejected_by_accountant: 1,
        paid: 26,
      },
      totalAmount: 50000,
      totalPaid: 41000,
      outstanding: 9000,
      paymentsProcessed: 58,
      mostRecentPaymentAt: '2026-09-17T14:02:00.000Z',
    },
  },
};

/** Two of the non-paid invoices carry a partial payment. */
const unpaidRows = {
  data: {
    success: true,
    data: [
      invoice({ paymentStatus: 'partially_paid', totalPaid: 100, balanceDue: 126 }),
      invoice({ id: 12, invoiceNumber: 'VI-2002', paymentStatus: 'partially_paid' }),
      invoice({ id: 13, invoiceNumber: 'VI-2003' }),
    ],
  },
};

const respond = (args: unknown[]) =>
  isSummaryCall(args) ? summary : isUnpaidRowsCall(args) ? unpaidRows : null;

describe('accounting VendorInvoiceManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(respond(args) ?? listPage([invoice()]))
    );
  });

  it('asks the server for the not-yet-paid invoices, 25 to a page', async () => {
    render(<VendorInvoiceManagement />);

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices', {
        params: { page: 1, limit: 25, status: 'unpaid' },
      })
    );
    expect(await screen.findByText('VI-2001')).toBeInTheDocument();
  });

  it('takes the stat cards from the summary, not from the rows on the page', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        respond(args) ??
          listPage(
            [
              invoice(),
              invoice({ id: 21, invoiceNumber: 'VI-2021' }),
              invoice({ id: 22, invoiceNumber: 'VI-2022' }),
            ],
            { page: 1, limit: 25, total: 16, pages: 1 }
          )
      )
    );
    render(<VendorInvoiceManagement />);

    // Three rows on the page, but 42 invoices exist of which 26 are paid, so the
    // Pending card reads 16 and the money cards read the whole-set aggregates.
    expect(await screen.findByText('16')).toBeInTheDocument();
    expect(screen.getByText('$9,000.00')).toBeInTheDocument();
    expect(screen.getByText('$41,000.00')).toBeInTheDocument();
    // Partially Paid now comes from the summary (vendor invoices carry no paymentStatus).
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('asks the summary for every invoice, with no status and no search', async () => {
    render(<VendorInvoiceManagement />);

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices/summary')
    );
    // Every card comes from that one aggregate now — no extra row fetch for the
    // partial-payment count.
    expect(mockGet).not.toHaveBeenCalledWith('/accounting/vendor-invoices', {
      params: { status: 'unpaid' },
    });
  });

  it('keeps the cards whole-set when the table is narrowed to one status', async () => {
    render(<VendorInvoiceManagement />);
    expect(await screen.findByText('VI-2001')).toBeInTheDocument();
    expect(screen.getByText('16')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Invoices Paid' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/accounting/vendor-invoices', {
        params: { page: 1, limit: 25, status: 'paid' },
      })
    );
    expect(screen.getByText('16')).toBeInTheDocument();
  });

  it('requests page 2 when Next is clicked', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        respond(args) ?? listPage([invoice()], { page: 1, limit: 25, total: 30, pages: 2 })
      )
    );
    render(<VendorInvoiceManagement />);
    expect(await screen.findByText('VI-2001')).toBeInTheDocument();

    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        respond(args) ??
          listPage([invoice({ id: 14, invoiceNumber: 'VI-2099' })], {
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
        params: { page: 2, limit: 25, status: 'unpaid' },
      })
    );
    expect(await screen.findByText('VI-2099')).toBeInTheDocument();
  });
});
