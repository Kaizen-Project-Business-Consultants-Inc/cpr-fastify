import { api } from './api';

export interface HRDashboardStats {
  activeInstructors: number;
  organizations: number;
  expiringCertifications: number;
}

export interface InstructorProfile {
  id: number;
  username: string;
  email: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  totalCourses: number;
  completedCourses: number;
  activeCourses: number;
  lastCourseDate: string | null;
}

export interface OrganizationProfile {
  id: number;
  name: string;
  contactEmail: string;
  contactPhone: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  totalCourses: number;
  completedCourses: number;
  activeCourses: number;
  totalUsers: number;
  lastCourseDate: string | null;
}

export interface PaginationData {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface HRDashboardResponse {
  success: boolean;
  data: HRDashboardStats;
}

export interface InstructorsResponse {
  success: boolean;
  data: {
    instructors: InstructorProfile[];
    pagination: PaginationData;
  };
}

export interface OrganizationsResponse {
  success: boolean;
  data: {
    organizations: OrganizationProfile[];
    pagination: PaginationData;
  };
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  role: string;
  organizationId?: number;
  organizationName?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface CourseHistoryItem {
  id: number;
  courseName: string;
  courseDate: string;
  status: string;
  [key: string]: unknown;
}

export interface UserProfileResponse {
  success: boolean;
  data: {
    user: UserProfile;
    courseHistory: CourseHistoryItem[];
  };
}

class HRDashboardService {
  // Get HR Dashboard Statistics
  async getDashboardStats(): Promise<HRDashboardStats> {
    const response = await api.get<HRDashboardResponse>('/hr/dashboard');
    return response.data.data;
  }

  // Get Instructor Profiles
  async getInstructors(page: number = 1, limit: number = 10, search: string = ''): Promise<InstructorsResponse['data']> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(search && { search })
    });
    
    const response = await api.get<InstructorsResponse>(`/hr/instructors?${params}`);
    return response.data.data;
  }

  // Get Organization Profiles
  async getOrganizations(page: number = 1, limit: number = 10, search: string = ''): Promise<OrganizationsResponse['data']> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(search && { search })
    });
    
    const response = await api.get<OrganizationsResponse>(`/hr/organizations?${params}`);
    return response.data.data;
  }

  // Get User Profile Details
  async getUserProfile(userId: number): Promise<UserProfileResponse['data']> {
    const response = await api.get<UserProfileResponse>(`/hr/user/${userId}`);
    return response.data.data;
  }
}

export const hrDashboardService = new HRDashboardService(); 