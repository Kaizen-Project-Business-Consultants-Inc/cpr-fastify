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
    startDate: string;
    endDate: string;
  };
  timesheets: {
    count: number;
    totalHours: number;
    totalCourses: number;
  };
  rates: {
    hourlyRate: number;
    courseBonus: number;
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

export interface PaymentCreation {
  instructor_id: number;
  amount: number;
  payment_date: string;
  payment_method?: string;
  notes?: string;
}

export interface PaymentProcessing {
  action: 'approve' | 'reject';
  transaction_id?: string;
  notes?: string;
}

export interface PayrollReport {
  summary: {
    totalPayments: number;
    completedPayments: number;
    pendingPayments: number;
    rejectedPayments: number;
    totalPaid: number;
    averagePayment: number;
  };
  byInstructor: Array<{
    instructorId: number;
    instructorName: string;
    paymentCount: number;
    totalPaid: number;
    averagePayment: number;
  }>;
  byMonth: Array<{
    year: number;
    month: number;
    paymentCount: number;
    totalPaid: number;
  }>;
}

export interface InstructorPayrollSummary {
  instructor: {
    username: string;
    email: string;
  };
  summary: {
    totalPayments: number;
    completedPayments: number;
    pendingPayments: number;
    totalPaid: number;
    averagePayment: number;
    lastPaymentDate: string;
  };
  recentPayments: PayrollPayment[];
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

  // Get payment details
  async getPayment(paymentId: number): Promise<PayrollPayment> {
    const response = await api.get(`/payroll/payments/${paymentId}`);
    return response.data.data;
  }

  // Calculate payroll for instructor
  async calculatePayroll(
    instructorId: number, 
    startDate: string, 
    endDate: string, 
    hourlyRate: number
  ): Promise<PayrollCalculation> {
    const response = await api.post(`/payroll/calculate/${instructorId}`, {
      start_date: startDate,
      end_date: endDate,
      hourly_rate: hourlyRate
    });
    return response.data.data;
  }

  // Create payment
  async createPayment(data: PaymentCreation): Promise<PayrollPayment> {
    const response = await api.post('/payroll/payments', data);
    return response.data.data;
  }

  // Process payment (approve/reject)
  async processPayment(paymentId: number, data: PaymentProcessing): Promise<void> {
    await api.post(`/payroll/payments/${paymentId}/process`, data);
  }

  // Get payroll report
  async getReport(filters: {
    start_date?: string;
    end_date?: string;
    instructor_id?: string;
  } = {}): Promise<PayrollReport> {
    const params = new URLSearchParams();
    
    if (filters.start_date) params.append('start_date', filters.start_date);
    if (filters.end_date) params.append('end_date', filters.end_date);
    if (filters.instructor_id) params.append('instructor_id', filters.instructor_id);

    const response = await api.get(`/payroll/report?${params.toString()}`);
    return response.data.data;
  }

  // Get instructor payroll summary
  async getInstructorSummary(instructorId: number): Promise<InstructorPayrollSummary> {
    const response = await api.get(`/payroll/instructor/${instructorId}/summary`);
    return response.data.data;
  }
}

export const payrollService = new PayrollService(); 