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

/** The summary call passes no options at all, so it gets the full list back. */
const isSummaryCall = (args: unknown[]) => args.length === 1;

const listPage = (rows: unknown[], pagination?: Record<string, number>) => ({
  data: {
    success: true,
    data: rows,
    pagination: pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
  },
});

/** Three invoices exist overall; two of them are not yet paid. */
const everyInvoice = {
  data: {
    success: true,
    data: [
      invoice(),
      invoice({ id: 12, invoiceNumber: 'VI-2002' }),
      invoice({ id: 13, invoiceNumber: 'VI-2003', status: 'paid', totalPaid: 226, balanceDue: 0 }),
    ],
  },
};

describe('accounting VendorInvoiceManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(isSummaryCall(args) ? everyInvoice : listPage([invoice()]))
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

  it('shows the non-paid count on the Pending Invoices card, not every invoice', async () => {
    render(<VendorInvoiceManagement />);

    // Three invoices exist, two are non-paid — the card must read 2.
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('requests page 2 when Next is clicked', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? everyInvoice
          : listPage([invoice()], { page: 1, limit: 25, total: 30, pages: 2 })
      )
    );
    render(<VendorInvoiceManagement />);
    expect(await screen.findByText('VI-2001')).toBeInTheDocument();

    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isSummaryCall(args)
          ? everyInvoice
          : listPage([invoice({ id: 14, invoiceNumber: 'VI-2099' })], {
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
