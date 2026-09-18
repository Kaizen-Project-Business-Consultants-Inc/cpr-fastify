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

/** A count probe asks for a single row of one status. */
const isCountProbe = (args: unknown[]) =>
  (args[1] as { params?: { limit?: number } } | undefined)?.params?.limit === 1;

const listPage = (rows: unknown[], pagination?: Record<string, number>) => ({
  data: {
    success: true,
    data: rows,
    pagination: pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
  },
});

const countOf = (total: number) => ({
  data: { success: true, data: [], pagination: { page: 1, limit: 1, total, pages: total } },
});

describe('VendorInvoiceApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(isCountProbe(args) ? countOf(4) : listPage([invoice()]))
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

  it('counts the stat cards from the whole set, not the page', async () => {
    render(<VendorInvoiceApproval />);

    // Every status probe reports 4 matching rows; "Rejected" sums the two
    // rejected statuses, so it shows 8 while a single page holds one row.
    expect(await screen.findByText('8')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/vendor-invoices', {
        params: { status: 'paid', page: 1, limit: 1 },
      })
    );
  });

  it('requests page 2 when Next is clicked', async () => {
    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isCountProbe(args)
          ? countOf(4)
          : listPage([invoice()], { page: 1, limit: 25, total: 40, pages: 2 })
      )
    );
    render(<VendorInvoiceApproval />);
    expect(await screen.findByText('VI-3001')).toBeInTheDocument();

    mockGet.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        isCountProbe(args)
          ? countOf(4)
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
