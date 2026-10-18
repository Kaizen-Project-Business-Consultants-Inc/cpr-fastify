import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const { mockCalculate } = vi.hoisted(() => ({ mockCalculate: vi.fn() }));
vi.mock('../../../services/payrollService', () => ({
  payrollService: {
    getPayments: vi.fn().mockResolvedValue({ payments: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } }),
    getStats: vi.fn().mockResolvedValue({ totalPayrollThisMonth: 0, pendingPayments: 0, instructorsWithPending: 0, averagePayment: 0 }),
    calculatePayroll: mockCalculate,
    processPayment: vi.fn(),
  },
}));

import PayrollManagement from '../PayrollManagement';

const fill = (label: string, value: string) =>
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(label, { exact: false }), { target: { value } });

async function openCalculator() {
  render(<PayrollManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'Calculate Payroll' }));
  fill('Instructor ID', '4');
  fill('Start Date', '2026-03-01');
  fill('End Date', '2026-03-31');
}

describe('PayrollManagement: Calculate Payroll', () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the instructor's own pay rate when the override is blank, and shows the period as entered", async () => {
    mockCalculate.mockResolvedValue({
      instructor: { username: 'instructor', email: 'i@test.com' },
      period: { start_date: '2026-03-01', end_date: '2026-03-31' },
      timesheets: { count: 2, totalHours: 10, totalCourses: 3 },
      rates: { hourlyRate: 30, courseBonus: 40, tierName: 'Senior', isDefaultRate: false },
      calculation: { baseAmount: 300, courseBonus: 120, totalAmount: 420 },
    });
    await openCalculator();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => expect(mockCalculate).toHaveBeenCalledWith(4, '2026-03-01', '2026-03-31', undefined));
    expect(await screen.findByText('Mar 1, 2026 — Mar 31, 2026')).toBeInTheDocument();
    expect(screen.getByText('$30/hr + $40/course (Senior)')).toBeInTheDocument();
    expect(screen.getByText('$420.00')).toBeInTheDocument();
  });

  it('sends an override rate when one is typed', async () => {
    mockCalculate.mockResolvedValue({
      instructor: { username: 'i', email: 'e' }, period: { start_date: '2026-03-01', end_date: '2026-03-31' },
      timesheets: { count: 0, totalHours: 0, totalCourses: 0 },
      rates: { hourlyRate: 22.5, courseBonus: 50, tierName: 'Default', isDefaultRate: true },
      calculation: { baseAmount: 0, courseBonus: 0, totalAmount: 0 },
    });
    await openCalculator();
    fill('Hourly Rate override', '22.5');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(mockCalculate).toHaveBeenCalledWith(4, '2026-03-01', '2026-03-31', 22.5));
  });

  it("shows the server's reason when the calculation fails", async () => {
    mockCalculate.mockRejectedValue({ response: { data: { error: 'Instructor not found' } } });
    await openCalculator();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findByText('Instructor not found')).toBeInTheDocument();
  });
});
