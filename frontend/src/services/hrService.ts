import api from './api';

/** HR → Returned Payments (ReturnedPaymentRequests.tsx). The other HR screens use hrDashboardService. */
export const hrService = {
  async getReturnedPaymentRequests(filters?: { page?: number; limit?: number }): Promise<Record<string, unknown>> {
    const response = await api.get('/hr/returned-payment-requests', { params: filters });
    return response.data.data;
  },

  // Process returned payment request (override/final reject)
  async processReturnedPaymentRequest(
    requestId: number,
    action: 'override_approve' | 'final_reject',
    notes: string
  ): Promise<void> {
    await api.post(`/hr/returned-payment-requests/${requestId}/process`, {
      action,
      notes
    });
  },
};
