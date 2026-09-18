import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

describe('OrganizationPaidInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the real invoice total, not a placeholder amount', () => {
    render(<OrganizationPaidInvoices invoices={[invoice() as never]} paidInvoicesSummary={summary} />);

    // Total and Amount Paid are both $1,234.56 for this invoice
    expect(screen.getAllByText('$1,234.56').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('$40.68')).not.toBeInTheDocument();
    expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
  });

  it('formats different totals per row', () => {
    render(
      <OrganizationPaidInvoices
        invoices={[
          invoice() as never,
          invoice({ id: 2, invoice_number: 'INV-2026-002', amount: 99.5, amount_paid: 99.5, course_type_name: 'First Aid' }) as never,
        ]}
        paidInvoicesSummary={summary}
      />
    );
    expect(screen.getAllByText('$1,234.56').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$99.50').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by search term client-side', () => {
    render(
      <OrganizationPaidInvoices
        invoices={[
          invoice() as never,
          invoice({ id: 2, invoice_number: 'INV-2026-002', course_type_name: 'First Aid' }) as never,
        ]}
        paidInvoicesSummary={summary}
      />
    );
    fireEvent.change(screen.getByLabelText('Search paid invoices'), { target: { value: 'first aid' } });
    expect(screen.getByText('INV-2026-002')).toBeInTheDocument();
    expect(screen.queryByText('INV-2026-001')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no paid invoices', () => {
    render(<OrganizationPaidInvoices invoices={[]} paidInvoicesSummary={undefined} />);
    expect(screen.getByText('No paid invoices found')).toBeInTheDocument();
  });
});
