import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../services/api', () => ({ api: { get: vi.fn() } }));

import PaymentHistoryTable from '../PaymentHistoryTable';

// Rows shaped like GET /accounting/invoices/:id/payments: the raw `payments`
// columns (DECIMAL amount as a string) plus the camelCase copies.
const accountingRow = {
  id: 1, invoice_id: 7, invoiceId: 7, amount: '56.50', status: 'verified',
  payment_date: '2026-10-01T00:00:00.000Z', paymentDate: '2026-10-01T00:00:00.000Z',
  payment_method: 'bank_transfer', paymentMethod: 'bank_transfer',
  reference_number: 'REF-1', referenceNumber: 'REF-1',
};

describe('PaymentHistoryTable', () => {
  it('shows a payment from the accounting endpoint', () => {
    render(<PaymentHistoryTable payments={[accountingRow]} />);

    expect(screen.getByText('$56.50')).toBeInTheDocument();
    // Date-only value: shown as that calendar day, not the day before.
    expect(screen.getByText('Oct 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
    expect(screen.getByText('REF-1')).toBeInTheDocument();
  });

  it('still reads rows that only have the snake_case columns', () => {
    render(
      <PaymentHistoryTable
        payments={[{ id: 2, invoice_id: 7, amount_paid: '20.00', status: 'pending_verification', payment_date: '2026-10-02', payment_method: 'cheque', reference_number: 'C-9' }]}
      />
    );

    expect(screen.getByText('$20.00')).toBeInTheDocument();
    expect(screen.getByText('Oct 2, 2026')).toBeInTheDocument();
    expect(screen.getByText('C-9')).toBeInTheDocument();
  });
});
