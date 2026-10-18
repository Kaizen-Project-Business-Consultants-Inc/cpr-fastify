import { api } from './api';

export interface PayrollPayment {
  id: number;
  instructorId: number;
  instructorName?: string;
  instructorEmail?: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  notes?: string;
  status: 'pending' | 'completed' | 'rejected';
  transactionId?: string;
  hrNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollStats {
  totalPayrollThisMonth: number;
  pendingPayments: number;
  instructorsWithPending: number;
  averagePayment: number;
}

export interface PayrollCalculation {
  instructor: {
    username: string;
    email: string;
  };
  period: {
    start_date: string;
    end_date: string;
  };
  timesheets: {
    count: number;
    totalHours: number;
    totalCourses: number;
  };
  rates: {
    hourlyRate: number;
    courseBonus: number;
    tierName: string;
    isDefaultRate: boolean;
  };
  calculation: {
    baseAmount: number;
    courseBonus: number;
    totalAmount: number;
  };
}

export interface PayrollFilters {
  page?: number;
  limit?: number;
  status?: string;
  instructor_id?: string;
  month?: string;
}

export interface PaymentProcessing {
  action: 'approve' | 'reject';
  transaction_id?: string;
  notes?: string;
}

class PayrollService {
  // Get payroll statistics (HR only)
  async getStats(): Promise<PayrollStats> {
    const response = await api.get('/payroll/stats');
    return response.data.data;
  }

  // Get payroll payments with filtering
  async getPayments(filters: PayrollFilters = {}): Promise<{
    payments: PayrollPayment[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    const params = new URLSearchParams();
    
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.status) params.append('status', filters.status);
    if (filters.instructor_id) params.append('instructor_id', filters.instructor_id);
    // Send a month only once it is complete (YYYY-MM); a half-typed one would be refused.
    if (filters.month && /^\d{4}-\d{1,2}$/.test(filters.month)) params.append('month', filters.month);

    const response = await api.get(`/payroll/payments?${params.toString()}`);
    return response.data.data;
  }

  // Calculate payroll for instructor
  async calculatePayroll(
    instructorId: number, 
    startDate: string, 
    endDate: string, 
    // Leave out to use the instructor's own pay rate and course bonus.
    hourlyRate?: number
  ): Promise<PayrollCalculation> {
    const response = await api.post(`/payroll/calculate/${instructorId}`, {
      start_date: startDate,
      end_date: endDate,
      ...(hourlyRate !== undefined ? { hourly_rate: hourlyRate } : {}),
    });
    return response.data.data;
  }

  // Process payment (approve/reject)
  async processPayment(paymentId: number, data: PaymentProcessing): Promise<void> {
    await api.post(`/payroll/payments/${paymentId}/process`, data);
  }
}

export const payrollService = new PayrollService(); 