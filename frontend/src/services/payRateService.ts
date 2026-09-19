import { api } from './api';

export interface PayRateTier {
  id: number;
  name: string;
  description?: string;
  baseHourlyRate: number;
  courseBonus: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InstructorPayRate {
  id: number;
  instructorId: number;
  tierId?: number;
  hourlyRate: number;
  courseBonus: number;
  effectiveDate: string;
  endDate?: string;
  notes?: string;
  createdBy?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  tierName?: string;
  tierDescription?: string;
}

export interface InstructorPayRateDetail {
  instructor: {
    id: number;
    username: string;
    email: string;
    phone?: string;
  };
  currentRate: InstructorPayRate | null;
  history: PayRateHistory[];
}

export interface PayRateHistory {
  id: number;
  instructorId: number;
  oldHourlyRate?: number;
  newHourlyRate: number;
  oldCourseBonus?: number;
  newCourseBonus: number;
  oldTierId?: number;
  newTierId?: number;
  changeReason?: string;
  changedBy?: number;
  effectiveDate: string;
  createdAt: string;
  oldTierName?: string;
  newTierName?: string;
  changedByName?: string;
}

export interface InstructorPayRateList {
  id: number;
  username: string;
  email: string;
  phone?: string;
  hourlyRate?: number;
  courseBonus?: number;
  effectiveDate?: string;
  rateActive?: boolean;
  tierName?: string;
  tierDescription?: string;
  rateStatus: 'Set' | 'Not Set';
}

export interface PayRateTierForm {
  name: string;
  description?: string;
  baseHourlyRate: number;
  courseBonus: number;
}

export interface InstructorPayRateForm {
  hourlyRate: number;
  courseBonus?: number;
  tierId?: number;
  effectiveDate?: string;
  notes?: string;
  changeReason?: string;
}

export interface BulkPayRateUpdate {
  instructorIds: number[];
  hourlyRate: number;
  courseBonus?: number;
  tierId?: number;
  effectiveDate?: string;
  notes?: string;
  changeReason?: string;
}

class PayRateService {
  // Pay Rate Tiers
  async getTiers(): Promise<PayRateTier[]> {
    const response = await api.get('/pay-rates/tiers');
    return response.data.data;
  }

  async createTier(tier: PayRateTierForm): Promise<PayRateTier> {
    const response = await api.post('/pay-rates/tiers', tier);
    return response.data.data;
  }

  async updateTier(id: number, tier: Partial<PayRateTierForm> & { isActive?: boolean }): Promise<PayRateTier> {
    const response = await api.put(`/pay-rates/tiers/${id}`, tier);
    return response.data.data;
  }

  // Instructor Pay Rates
  async getInstructors(params?: {
    page?: number;
    limit?: number;
    search?: string;
    has_rate?: 'true' | 'false';
  }): Promise<{
    instructors: InstructorPayRateList[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    const response = await api.get('/pay-rates/instructors', { params });
    return response.data.data;
  }

  async getInstructorDetail(instructorId: number): Promise<InstructorPayRateDetail> {
    const response = await api.get(`/pay-rates/instructors/${instructorId}`);
    return response.data.data;
  }

  async setInstructorRate(instructorId: number, rate: InstructorPayRateForm): Promise<InstructorPayRate> {
    // POST /pay-rates/instructors/:id requires snake_case
    // (hourly_rate/course_bonus/tier_id/effective_date/change_reason) —
    // this form's own fields are camelCase and were sent as-is, so every
    // required field came through as undefined and the request always
    // 400'd. Setting an instructor's pay rate has never worked through
    // this screen.
    const response = await api.post(`/pay-rates/instructors/${instructorId}`, {
      hourly_rate: rate.hourlyRate,
      course_bonus: rate.courseBonus,
      tier_id: rate.tierId,
      effective_date: rate.effectiveDate,
      notes: rate.notes,
      change_reason: rate.changeReason,
    });
    return response.data.data;
  }

  async updateInstructorRate(instructorId: number, rate: Partial<InstructorPayRateForm>): Promise<InstructorPayRate> {
    const response = await api.put(`/pay-rates/instructors/${instructorId}`, rate);
    return response.data.data;
  }

  async getCurrentRate(instructorId: number, date?: string): Promise<{
    hourlyRate: number;
    courseBonus: number;
    tierName?: string;
    isDefault: boolean;
  }> {
    const response = await api.get(`/pay-rates/instructors/${instructorId}/current`, {
      params: { date }
    });
    return response.data.data;
  }

  // Bulk Operations
  async bulkUpdateRates(update: BulkPayRateUpdate): Promise<InstructorPayRate[]> {
    const response = await api.post('/pay-rates/bulk-update', update);
    return response.data.data;
  }
}

export const payRateService = new PayRateService(); 