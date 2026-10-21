import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../../../services/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  default: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));

import OrganizationBilling from '../views/OrganizationBilling';

/** A row as GET /organization/invoices really sends it (DECIMALs as strings, invoice_date not created_at). */
const invoice = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  invoice_number: 'INV-2026-001',
  invoice_date: '2026-08-01T14:00:00.000Z',
  due_date: '2026-08-31T00:00:00.000Z',
  amount: '113.00',
  status: 'posted_to_org',
  students_billed: 2,
  paid_date: null,
  location: 'Toronto',
  course_type_name: 'CPR Level C',
  course_date: '2026-07-20T15:00:00.000Z',
  course_request_id: 10,
  amount_paid: '0.00',
  balance_due: '113.00',
  rate_per_student: 50,
  base_cost: '100.00',
  tax_amount: '13.00',
  payment_status: 'overdue',
  ...overrides,
});

const older = invoice();
const newer = invoice({
  id: 2, invoice_number: 'INV-2026-002', invoice_date: '2026-09-01T14:00:00.000Z',
  due_date: '2026-10-01T00:00:00.000Z', course_request_id: 11,
});

/** Answer the list (both the page and the unpaged copy) plus the View dialog's loads. */
const serve = (invoices: unknown[]) => {
  mockGet.mockImplementation((url: string) => {
    if (url === '/organization/invoices') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            invoices,
            pagination: { current_page: 1, total_pages: 1, total_records: invoices.length, per_page: 25 },
          },
        },
      });
    }
    return Promise.resolve({ data: { success: true, data: [] } });
  });
};

const renderScreen = () => render(<OrganizationBilling billingSummary={undefined} />);

/** The table row for an invoice number. */
const rowOf = (invoiceNumber: string) => screen.getByText(invoiceNumber).closest('[role="row"]') as HTMLElement;

const openInvoice = async (invoiceNumber: string) => {
  fireEvent.click(screen.getByRole('button', { name: `View invoice ${invoiceNumber}` }));
  return screen.findByRole('dialog');
};

describe('OrganizationBilling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an older invoice with a balance blocks a newer one', async () => {
    serve([newer, older]);
    renderScreen();

    expect(await screen.findByText('INV-2026-002')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('INV-2026-002')).getByText('Pay Older First')).toBeInTheDocument());
    expect(within(rowOf('INV-2026-001')).queryByText('Pay Older First')).not.toBeInTheDocument();

    const dialog = await openInvoice('INV-2026-002');
    expect(within(dialog).queryByRole('button', { name: 'Submit Payment' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Please pay older invoices first: INV-2026-001/)).toBeInTheDocument();
  });

  it('an older invoice already paid in full and awaiting verification does not block', async () => {
    serve([newer, invoice({ status: 'payment_submitted' })]);
    renderScreen();

    expect(await screen.findByText('INV-2026-002')).toBeInTheDocument();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/organization/invoices', { params: { page: 1, limit: 200 } }));
    expect(screen.queryByText('Pay Older First')).not.toBeInTheDocument();

    const dialog = await openInvoice('INV-2026-002');
    expect(await within(dialog).findByRole('button', { name: 'Submit Payment' })).toBeInTheDocument();
  });

  it('an invoice that is itself payment_submitted cannot be paid again', async () => {
    serve([invoice({ status: 'payment_submitted' })]);
    renderScreen();

    expect(await screen.findByText('INV-2026-001')).toBeInTheDocument();
    expect(within(rowOf('INV-2026-001')).getByText('Awaiting')).toBeInTheDocument();

    const dialog = await openInvoice('INV-2026-001');
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/organization/invoices/1/payments'));
    expect(within(dialog).queryByRole('button', { name: 'Submit Payment' })).not.toBeInTheDocument();
  });

  it('the Payment Submitted filter shows invoices whose status is payment_submitted', async () => {
    serve([newer, invoice({ status: 'payment_submitted' })]);
    renderScreen();

    expect(await screen.findByText('INV-2026-002')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('Status'));
    fireEvent.click(await screen.findByRole('option', { name: 'Payment Submitted' }));

    await waitFor(() => expect(screen.queryByText('INV-2026-002')).not.toBeInTheDocument());
    expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
  });

  it('shows a confirmation after a payment is submitted', async () => {
    serve([invoice()]);
    mockPost.mockResolvedValue({ data: { success: true, data: { is_full_payment: true, remaining_balance: 0 } } });
    renderScreen();

    expect(await screen.findByText('INV-2026-001')).toBeInTheDocument();
    const dialog = await openInvoice('INV-2026-001');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Submit Payment' }));

    const payDialog = await screen.findByRole('dialog', { name: /Submit Payment/i });
    fireEvent.mouseDown(within(payDialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Bank Transfer' }));
    fireEvent.click(within(payDialog).getByRole('button', { name: 'Submit Payment' }));

    const confirm = await screen.findByRole('dialog', { name: 'Submit payment?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Submit Payment' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/organization/invoices/1/payment-submission',
      expect.objectContaining({ amount: 113, payment_method: 'bank_transfer' })
    ));
    // Closing the payment form used to clear this message before it ever showed.
    expect(await screen.findByText('Full payment submitted successfully! Awaiting verification.')).toBeInTheDocument();
  });
});
