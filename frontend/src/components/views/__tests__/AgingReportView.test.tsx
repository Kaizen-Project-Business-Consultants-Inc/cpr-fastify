import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = vi.fn();
vi.mock('../../../services/api', () => ({ default: { get: (...args: unknown[]) => mockGet(...args) } }));

import AgingReportView from '../AgingReportView';

// The server sends calendar dates; read with new Date() they became UTC
// midnight, which is the evening before in Toronto (UAT 2026-10-21).
describe('AgingReportView', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Toronto'; });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('shows the as-of date as sent', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/accounting/organizations') return { data: { data: [] } };
      return {
        data: {
          data: {
            report_metadata: { generated_at: '2026-10-22T02:30:00.000Z', as_of_date: '2026-10-21' },
            executive_summary: {
              total_outstanding: 56.5, total_overdue: 0, collection_efficiency: 0,
              total_invoices: 1, overdue_invoices: 0, overdue_percentage: 0,
            },
            aging_summary: [{ aging_bucket: 'Current', invoice_count: 1, total_balance: 56.5, percentage_of_total: 100, avg_days_outstanding: 0 }],
            organization_breakdown: [],
            invoice_details: [{
              id: 1, aging_bucket: 'Current', invoice_number: 'INV-1', organization_name: 'Test Organization',
              amount: 56.5, balance_due: 56.5, due_date: '2026-11-21T00:00:00.000Z', days_outstanding: 0,
            }],
          },
        },
      };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AgingReportView /></QueryClientProvider>);

    expect(await screen.findByText(/As of Oct 21, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/10\/20\/2026|Oct 20, 2026/)).not.toBeInTheDocument();
  });
});
