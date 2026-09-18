import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = vi.fn();

vi.mock('../../../../services/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

const mockShowError = vi.fn();
vi.mock('../../../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({
    showSuccess: vi.fn(),
    showError: mockShowError,
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  }),
}));

import OrganizationPaidInvoices from '../views/OrganizationPaidInvoices';

const invoice = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  invoice_number: 'INV-2026-001',
  created_at: '2026-08-01',
  due_date: '2026-08-31',
  amount: 1234.56,
  status: 'paid',
  payment_status: 'paid',
  students_billed: 12,
  paid_date: '2026-08-15',
  location: 'Toronto',
  course_type_name: 'CPR Level C',
  course_date: '2026-07-20',
  course_request_id: 10,
  amount_paid: 1234.56,
  balance_due: 0,
  ...overrides,
});

const summary = {
  total_paid_invoices: 2,
  total_paid_amount: 2000,
  average_paid_amount: 1000,
  paid_last_30_days: 1,
  amount_paid_last_30_days: 1000,
};

/** The paid-invoices endpoint answers with a nested list + pagination block. */
const page = (invoices: unknown[], pagination?: Record<string, number>) => ({
  data: {
    success: true,
    data: {
      invoices,
      pagination: pagination ?? {
        current_page: 1,
        total_pages: 1,
        total_records: invoices.length,
        per_page: 25,
      },
    },
  },
});

const renderScreen = () =>
  render(<OrganizationPaidInvoices paidInvoicesSummary={summary} />);

describe('OrganizationPaidInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests page 1 with a page size of 25', async () => {
    mockGet.mockResolvedValue(page([invoice()]));
    renderScreen();

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/organization/paid-invoices', {
        params: { page: 1, limit: 25 },
      })
    );
  });

  it('renders the real invoice total, not a placeholder amount', async () => {
    mockGet.mockResolvedValue(page([invoice()]));
    renderScreen();

    // Total and Amount Paid are both $1,234.56 for this invoice
    expect(await screen.findByText('INV-2026-001')).toBeInTheDocument();
    expect(screen.getAllByText('$1,234.56').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('$40.68')).not.toBeInTheDocument();
  });

  it('formats different totals per row', async () => {
    mockGet.mockResolvedValue(
      page([
        invoice(),
        invoice({ id: 2, invoice_number: 'INV-2026-002', amount: 99.5, amount_paid: 99.5, course_type_name: 'First Aid' }),
      ])
    );
    renderScreen();

    expect(await screen.findByText('INV-2026-002')).toBeInTheDocument();
    expect(screen.getAllByText('$1,234.56').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$99.50').length).toBeGreaterThanOrEqual(1);
  });

  it('filters the loaded page by search term', async () => {
    mockGet.mockResolvedValue(
      page([
        invoice(),
        invoice({ id: 2, invoice_number: 'INV-2026-002', course_type_name: 'First Aid' }),
      ])
    );
    renderScreen();

    expect(await screen.findByText('INV-2026-001')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search paid invoices'), { target: { value: 'first aid' } });

    // The search box is debounced at 300ms
    await waitFor(() => expect(screen.queryByText('INV-2026-001')).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('INV-2026-002')).toBeInTheDocument();
  });

  it('shows the total row count from the server, not the page size', async () => {
    mockGet.mockResolvedValue(
      page([invoice()], { current_page: 1, total_pages: 4, total_records: 97, per_page: 25 })
    );
    renderScreen();

    expect(await screen.findByText(/of 97 results/)).toBeInTheDocument();
  });

  it('loads the next page when Next is clicked', async () => {
    mockGet.mockResolvedValue(
      page([invoice()], { current_page: 1, total_pages: 2, total_records: 26, per_page: 25 })
    );
    renderScreen();

    expect(await screen.findByText('INV-2026-001')).toBeInTheDocument();

    mockGet.mockResolvedValue(
      page([invoice({ id: 2, invoice_number: 'INV-2026-050' })], {
        current_page: 2,
        total_pages: 2,
        total_records: 26,
        per_page: 25,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/organization/paid-invoices', {
        params: { page: 2, limit: 25 },
      })
    );
    expect(await screen.findByText('INV-2026-050')).toBeInTheDocument();
  });

  it('shows the empty state when there are no paid invoices', async () => {
    mockGet.mockResolvedValue(page([]));
    render(<OrganizationPaidInvoices paidInvoicesSummary={undefined} />);

    expect(await screen.findByText('No paid invoices found')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    renderScreen();

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to load paid invoices'));
  });
});
