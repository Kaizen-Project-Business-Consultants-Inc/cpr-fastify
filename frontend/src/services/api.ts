import axios from 'axios';
import { tokenService } from './tokenService';
import type {
  DashboardMetrics,
  Class,
  Availability,
  ApiResponse,
  CourseData,
  InstructorData,
  OrganizationData,
  VendorData,
  StudentData,
  PricingData,
  PaymentData,
  EmailTemplateData,
  NotificationPreferences,
} from '../types/api';
import { API_URL } from '../config';

// Internal types for dashboard API responses
interface DashboardStatsResponse {
  scheduledClasses?: number;
  completedClasses?: number;
  totalStudents?: number;
  recentClasses?: Array<{ id: string; date: string; type: string; students: number }>;
  upcomingCourses?: number;
  completedCourses?: number;
  recentCourses?: Array<{ id: string; date: string; type: string; students: number }>;
  pendingInvoices?: number;
  totalRevenue?: number;
  completedCoursesThisMonth?: number;
  pendingApprovals?: number;
  activeInstructors?: number;
  organizations?: number;
  instructorStats?: DashboardStatsResponse;
  summary?: {
    totalUsers?: number;
    totalOrganizations?: number;
    totalCourses?: number;
  };
  upcomingClasses?: number;
}

// Development-only logging utility - prevents sensitive data from being logged in production
const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
// eslint-disable-next-line no-console
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args); };

devLog('🌐 [API] Initializing API service with base URL:', API_URL);

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Enable sending cookies
});

// Add request interceptor
api.interceptors.request.use(
  (config) => {
    // Add auth token to all requests
    const token = tokenService.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Ensure proper JSON formatting for request data
    if (config.data && typeof config.data === 'object') {
      try {
        // Validate JSON data
        JSON.stringify(config.data);
      } catch (error) {
        console.error('❌ [API REQUEST ERROR] Invalid JSON data:', error);
        return Promise.reject(new Error('Invalid JSON data in request'));
      }
    }

    devLog('\n🚀 [API REQUEST]', {
      method: config.method?.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL,
      headers: config.headers,
      params: config.params,
      data: config.data,
    });
    return config;
  },
  (error) => {
    console.error('❌ [API REQUEST ERROR]', error);
    return Promise.reject(error);
  }
);

// Track refresh attempts to prevent infinite loops
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;
let failedQueue: Array<{
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  // Atomically swap out the queue to prevent race conditions
  const queueToProcess = failedQueue;
  failedQueue = [];

  queueToProcess.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else if (token) {
      resolve(token);
    } else {
      reject(new Error('Token refresh failed'));
    }
  });
};

// Add response interceptor
api.interceptors.response.use(
  (response) => {
    devLog('\n✅ [API RESPONSE]', {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
    });
    return response;
  },
  async (error) => {
    console.error('❌ [API RESPONSE ERROR]', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      config: {
        method: error.config?.method,
        url: error.config?.url,
      }
    });

    const originalRequest = error.config;

    // Handle 401 errors (unauthorized)
    if (error.response?.status === 401) {
      const errorCode = error.response?.data?.error?.code;

      // For failed login attempts, just reject — let the Login component show the error.
      // Do NOT call forceLogout() here: it navigates before React can render the alert.
      if (originalRequest.url?.includes('/auth/login')) {
        devLog('🔐 [API] Login attempt rejected (401) — passing error to caller');
        return Promise.reject(error);
      }

      // For refresh token errors or blacklisted tokens, force logout + redirect
      if (
        errorCode === 'AUTH_1003' ||
        error.response?.data?.error?.message?.includes('Refresh token')
      ) {
        devLog('🔐 [API] Refresh/blacklist auth error - forcing logout');
        tokenService.forceLogout();
        return Promise.reject(error);
      }

      // For other 401 errors, try to refresh the token
      if (!isRefreshing) {
        isRefreshing = true;

        // Create a shared promise for all concurrent 401 requests
        refreshPromise = (async () => {
          try {
            devLog('🔐 [API] Attempting token refresh...');
            const response = await tokenService.refreshTokenSilently();

            if (response) {
              devLog('🔐 [API] Token refresh successful');
              processQueue(null, response);
              return response;
            }
            throw new Error('Token refresh returned null');
          } catch (refreshError) {
            console.error('🔐 [API] Token refresh failed:', refreshError);
            const error = refreshError instanceof Error ? refreshError : new Error('Token refresh failed');
            processQueue(error, null);

            // Clear tokens and redirect to login
            tokenService.forceLogout();
            window.location.href = '/login';
            throw error;
          } finally {
            isRefreshing = false;
            refreshPromise = null;
          }
        })();

        try {
          const token = await refreshPromise;
          // Retry the original request
          if (originalRequest && token) {
            originalRequest.headers.Authorization = token;
            return api(originalRequest);
          }
        } catch (err) {
          return Promise.reject(err);
        }
      } else {
        // If refresh is already in progress, queue this request
        try {
          const token = await new Promise<string>((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          });
          if (originalRequest) {
            originalRequest.headers.Authorization = token;
            return api(originalRequest);
          }
        } catch (err) {
          return Promise.reject(err);
        }
      }
    }

    // Handle 403 errors (forbidden)
    if (error.response?.status === 403) {
      devLog('🔐 [API] Access denied - insufficient permissions');
      // Don't redirect for 403 errors, just show the error
    }

    return Promise.reject(error);
  }
);

// Helper function to extract data from API response (new format)
const extractData = <T>(response: {
  data: { success: boolean; data: T; error?: { code?: string; message?: string }; message?: string };
}): T => {
  if (response.data.success === false) {
    throw new Error(
      response.data.error?.message || response.data.message || 'API Error'
    );
  }
  return response.data.data;
};

// Helper function for legacy API responses (old format)
const extractLegacyData = <T>(response: { data: ApiResponse<T> }): T => {
  if (!response.data.success) {
    throw new Error(response.data.message || 'API Error');
  }
  return response.data.data;
};

// Dashboard endpoints
export const fetchDashboardData = async (): Promise<DashboardMetrics> => {
  devLog('[Debug] api.ts - Fetching dashboard data');

  const defaultData: DashboardMetrics = {
    upcomingClasses: 0,
    totalStudents: 0,
    completedClasses: 0,
    recentClasses: []
  };

  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const currentDate = `${year}-${month}-${day}`;

    // Try all dashboard endpoints in parallel and use the first successful one
    // This is much faster than sequential fallbacks
    const [genericResult, instructorResult, adminResult] = await Promise.allSettled([
      api.get<ApiResponse<DashboardStatsResponse>>('/dashboard'),
      api.get<ApiResponse<DashboardStatsResponse>>('/instructor/dashboard/stats'),
      Promise.all([
        api.get<ApiResponse<DashboardStatsResponse>>(`/admin/instructor-stats?month=${currentDate}`),
        api.get<ApiResponse<DashboardStatsResponse>>(`/admin/dashboard-summary?month=${currentDate}`)
      ])
    ]);

    // Check generic dashboard first
    if (genericResult.status === 'fulfilled' && genericResult.value.data.success && genericResult.value.data.data) {
      const dashboardStats = genericResult.value.data.data.instructorStats;
      if (dashboardStats) {
        devLog('[Debug] api.ts - Using generic dashboard data');
        return {
          upcomingClasses: dashboardStats.scheduledClasses || 0,
          totalStudents: 0,
          completedClasses: dashboardStats.completedClasses || 0,
          recentClasses: []
        };
      }
    }

    // Check instructor dashboard
    if (instructorResult.status === 'fulfilled' && instructorResult.value.data.success) {
      const stats = instructorResult.value.data.data;
      devLog('[Debug] api.ts - Using instructor dashboard data');
      return {
        upcomingClasses: stats.scheduledClasses || 0,
        totalStudents: stats.totalStudents || 0,
        completedClasses: stats.completedClasses || 0,
        recentClasses: stats.recentClasses || []
      };
    }

    // Check admin dashboard
    if (adminResult.status === 'fulfilled') {
      const [, dashboardSummary] = adminResult.value;
      const summaryData = extractLegacyData<DashboardStatsResponse>(dashboardSummary);
      if (summaryData) {
        devLog('[Debug] api.ts - Using admin dashboard data');
        return {
          upcomingClasses: summaryData.upcomingClasses || 0,
          totalStudents: summaryData.totalStudents || 0,
          completedClasses: summaryData.completedClasses || 0,
          recentClasses: summaryData.recentClasses || []
        };
      }
    }

    devLog('[Debug] api.ts - No dashboard data available, returning defaults');
    return defaultData;
  } catch (error) {
    devLog('[Debug] api.ts - Error fetching dashboard data:', error);
    return defaultData;
  }
};

// Role-specific dashboard data fetching
export const fetchRoleSpecificDashboardData = async (userRole: string): Promise<DashboardMetrics> => {
  devLog('[Debug] api.ts - Fetching role-specific dashboard data for role:', userRole);

  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const currentDate = `${year}-${month}-${day}`;

    let dashboardData: DashboardMetrics = {
      upcomingClasses: 0,
      totalStudents: 0,
      completedClasses: 0,
      recentClasses: []
    };

    switch (userRole) {
      case 'instructor':
        try {
          const response = await api.get<ApiResponse<DashboardStatsResponse>>('/instructor/dashboard/stats');
          if (response.data.success) {
            const stats = response.data.data;
            dashboardData = {
              upcomingClasses: stats.scheduledClasses || 0,
              totalStudents: stats.totalStudents || 0,
              completedClasses: stats.completedClasses || 0,
              recentClasses: stats.recentClasses || []
            };
          }
        } catch (error) {
          devLog('[Debug] api.ts - Instructor dashboard not available, using fallback');
        }
        break;

      case 'admin':
      case 'courseadmin':
        try {
          const [, dashboardSummary] = await Promise.all([
            api.get<ApiResponse<DashboardStatsResponse>>(`/admin/instructor-stats?month=${currentDate}`),
            api.get<ApiResponse<DashboardStatsResponse>>(`/admin/dashboard-summary?month=${currentDate}`)
          ]);

          const summaryData = extractLegacyData<DashboardStatsResponse>(dashboardSummary);
          dashboardData = {
            upcomingClasses: summaryData?.upcomingClasses || 0,
            totalStudents: summaryData?.totalStudents || 0,
            completedClasses: summaryData?.completedClasses || 0,
            recentClasses: summaryData?.recentClasses || []
          };
        } catch (error) {
          devLog('[Debug] api.ts - Admin dashboard not available, using fallback');
        }
        break;

      case 'organization':
        try {
          const response = await api.get<ApiResponse<DashboardStatsResponse>>('/organization/dashboard');
          if (response.data.success) {
            const stats = response.data.data;
            dashboardData = {
              upcomingClasses: stats.upcomingCourses || 0,
              totalStudents: stats.totalStudents || 0,
              completedClasses: stats.completedCourses || 0,
              recentClasses: stats.recentCourses || []
            };
          }
        } catch (error) {
          devLog('[Debug] api.ts - Organization dashboard not available, using fallback');
        }
        break;

      case 'accountant':
        try {
          const response = await api.get<ApiResponse<DashboardStatsResponse>>('/accounting/dashboard');
          if (response.data.success) {
            const stats = response.data.data;
            dashboardData = {
              upcomingClasses: stats.pendingInvoices || 0,
              totalStudents: stats.totalRevenue || 0,
              completedClasses: stats.completedCoursesThisMonth || 0,
              recentClasses: []
            };
          }
        } catch (error) {
          devLog('[Debug] api.ts - Accounting dashboard not available, using fallback');
        }
        break;

      case 'hr':
        try {
          const response = await api.get<ApiResponse<DashboardStatsResponse>>('/hr/dashboard');
          if (response.data.success) {
            const stats = response.data.data;
            dashboardData = {
              upcomingClasses: stats.pendingApprovals || 0,
              totalStudents: stats.activeInstructors || 0,
              completedClasses: stats.organizations || 0,
              recentClasses: []
            };
          }
        } catch (error) {
          devLog('[Debug] api.ts - HR dashboard not available, using fallback');
        }
        break;

      case 'sysadmin':
        try {
          const response = await api.get<ApiResponse<DashboardStatsResponse>>('/sysadmin/dashboard');
          if (response.data.success) {
            const summary = response.data.data.summary;
            dashboardData = {
              upcomingClasses: summary?.totalUsers || 0,
              totalStudents: summary?.totalOrganizations || 0,
              completedClasses: summary?.totalCourses || 0,
              recentClasses: []
            };
          }
        } catch (error) {
          devLog('[Debug] api.ts - Sysadmin dashboard not available, using fallback');
        }
        break;

      default:
        // Try generic dashboard endpoint
        try {
          const response = await api.get<ApiResponse<DashboardStatsResponse>>('/dashboard');
          if (response.data.success && response.data.data) {
            const dashboardStats = response.data.data.instructorStats;
            dashboardData = {
              upcomingClasses: dashboardStats?.scheduledClasses || 0,
              totalStudents: 0,
              completedClasses: dashboardStats?.completedClasses || 0,
              recentClasses: []
            };
          }
        } catch (error) {
          devLog('[Debug] api.ts - Generic dashboard not available, using default data');
        }
        break;
    }

    devLog('[Debug] api.ts - Role-specific dashboard data received:', dashboardData);
    return dashboardData;
  } catch (error) {
    devLog('[Debug] api.ts - Error fetching role-specific dashboard data:', error);

    // Return default data instead of throwing error
    return {
      upcomingClasses: 0,
      totalStudents: 0,
      completedClasses: 0,
      recentClasses: []
    };
  }
};

// Auth endpoints
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout'),
  refreshToken: () => api.post('/auth/refresh'),
};

// SYSADMIN endpoints
export const sysadminApi = {
  getConfigurations: () => api.get('/sysadmin/configurations'),
  updateConfiguration: (key: string, value: string) =>
    api.put(`/sysadmin/configurations/${key}`, { value }),
  getConfiguration: (key: string) =>
    api.get(`/sysadmin/configurations/${key}`),
};

// Password reset functions
export const requestPasswordReset = async (email: string) => {
  const response = await api.post('/auth/forgot-password', { email });
  return response.data;
};

export const resetPassword = async (token: string, password: string) => {
  const response = await api.post('/auth/reset-password', {
    token,
    password,
  });
  return response.data;
};

// Course admin endpoints
export const courseAdminApi = {
  // Courses
  getCourses: () => api.get('/courses'),
  createCourse: (data: CourseData) => api.post('/courses', data),
  updateCourse: (id: number, data: CourseData) =>
    api.put(`/courses/${id}`, data),
  deleteCourse: (id: number) => api.delete(`/courses/${id}`),
  assignInstructor: (courseId: number, instructorId: number) =>
    api.put(`/courses/${courseId}/assign-instructor`, { instructorId }),

  // Classes
  getClasses: () => api.get('/classes'),
  createClass: (data: Record<string, unknown>) => api.post('/classes', data),
  updateClass: (id: number, data: Record<string, unknown>) =>
    api.put(`/classes/${id}`, data),
  deleteClass: (id: number) => api.delete(`/classes/${id}`),

  // Instructors
  getInstructors: () => api.get('/instructors'),
  createInstructor: (data: InstructorData) => api.post('/instructors', data),
  updateInstructor: (id: number, data: InstructorData) =>
    api.put(`/instructors/${id}`, data),
  deleteInstructor: (id: number) => api.delete(`/instructors/${id}`),
  updateInstructorAvailability: (id: number, data: Record<string, unknown>) =>
    api.put(`/instructors/${id}/availability`, data),
};

// Organization endpoints
export const organizationApi = {
  getDashboard: async () => {
    const response = await api.get('/organization/dashboard');
    return response.data;
  },
  getMyCourses: async () => {
    const response = await api.get('/organization/courses');
    return extractData(response);
  },
  getArchivedCourses: async () => {
    const response = await api.get('/organization/archive');
    return extractData(response);
  },
  getInvoices: () => api.get('/organization/invoices'),
  getBalanceCalculation: (invoiceId: string, paymentAmount: number) =>
    api.get(`/organization/invoices/${invoiceId}/balance-calculation`, {
      params: { payment_amount: paymentAmount }
    }),
  getBillingSummary: () => api.get('/organization/billing-summary'),
  getCourseTypes: async () => {
    const response = await api.get('/course-types');
    return extractData(response);
  },
  requestCourse: (data: Record<string, unknown>) => api.post('/organization/course-request', data),

  // Upload students for a course
  uploadStudents: async (courseRequestId: number, students: StudentData[]) => {
    devLog('[TRACE] API - Uploading students for course:', courseRequestId);
    devLog('[TRACE] API - Students data:', students);

    try {
      const response = await api.post(`/courses/org/students/${courseRequestId}`, {
        students
      });

      devLog('[TRACE] API - Upload response:', response.data);
      return response.data;
    } catch (error) {
      devLog('[TRACE] API - Upload error:', error);
      throw error;
    }
  },

  // Get students for a course
  getCourseStudents: async (courseId: number) => {
    const response = await api.get(`/courses/org/students/${courseId}`);
    return response.data;
  },
};

// Student endpoints
export const studentApi = {
  getSchedule: () => api.get('/student/classes'),
  enrollInClass: (classId: number) =>
    api.post(`/student/enroll/${classId}`),
  withdrawFromClass: (classId: number) =>
    api.delete(`/student/withdraw/${classId}`),
};

// Instructor endpoints
export const instructorApi = {
  // Basic instructor data
  getSchedule: () => api.get('/instructor/schedule'),
  getAvailability: () => api.get('/instructor/availability'),
  updateAvailability: (data: Record<string, unknown>) =>
    api.put('/instructor/availability', data),

  // Classes and courses
  getClasses: () => api.get('/instructor/classes'),
  getClassesToday: () => {
    // Send client's local date to handle timezone differences between frontend and backend
    const today = new Date();
    const localDate = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    return api.get(`/instructor/classes/today?date=${localDate}`);
  },
  getClassesCompleted: () => api.get('/instructor/classes/completed'),
  getClassesActive: () => api.get('/instructor/classes/active'),
  getClassStudents: (courseId: number) => api.get(`/instructor/classes/${courseId}/students`),
  completeClass: (courseId: number, instructorComments?: string) =>
    api.post(`/instructor/classes/${courseId}/complete`, { instructor_comments: instructorComments || '' }),
  updateAttendance: (courseId: number, students: StudentData[]) =>
    api.put(`/instructor/classes/${courseId}/attendance`, { students }),
  updateStudentAttendance: (courseId: number, studentId: string, attended: boolean) =>
    api.put(`/instructor/classes/${courseId}/students/${studentId}/attendance`, { attended }),
  addStudent: (courseId: number, studentData: StudentData) =>
    api.post(`/instructor/classes/${courseId}/students`, studentData),
  updateClassNotes: (courseId: number, notes: string) =>
    api.post('/instructor/classes/notes', { courseId, notes }),

  // Availability management
  addAvailability: (date: string) => api.post('/instructor/availability', { date }),
  removeAvailability: (date: string) => api.delete(`/instructor/availability/${date}`),

  // Attendance
  getAttendance: () => api.get('/instructor/attendance'),
  markAttendance: (courseId: number, students: StudentData[]) =>
    api.post(`/instructor/classes/${courseId}/attendance`, { students }),

  // Dashboard data
  getDashboardStats: () => api.get('/instructor/dashboard/stats'),
  getTodayClasses: () => api.get('/instructor/classes/today'),
};

// Additional exports for backward compatibility
export const fetchInstructorAvailability = async (): Promise<
  Availability[]
> => {
  const response = await api.get<ApiResponse<Availability[]>>(
    '/instructor/availability'
  );
  return extractLegacyData(response);
};

export const fetchSchedule = async (): Promise<Class[]> => {
  const response = await api.get<ApiResponse<Class[]>>(
    '/instructor/schedule'
  );
  return extractLegacyData(response);
};

// Export the api instance for use in other services
export { api };

// Accounting and Course Pricing API functions
export const getCoursePricing = async () => {
  const response = await api.get('/accounting/course-pricing');
  return response.data.data || [];
};

export const updateCoursePrice = async (pricingId: number, data: PricingData) => {
  const response = await api.put(
    `/accounting/course-pricing/${pricingId}`,
    data
  );
  return response.data;
};

export const createCoursePricing = async (data: PricingData): Promise<ApiResponse<Record<string, unknown>>> => {
  const response = await api.post('/accounting/course-pricing', data);
  return response.data;
};

export const deleteCoursePricing = async (id: number) => {
  const response = await api.delete(`/accounting/course-pricing/${id}`);
  return response.data;
};

export const getOrganizations = async () => {
  const response = await api.get('/accounting/organizations');
  return response.data.data || [];
};

// Organization Pricing API endpoints
export const getOrganizationPricing = async () => {
  const response = await api.get('/organization-pricing/admin');
  return response.data.data || [];
};

// Get organization pricing for organization users (read-only)
export const getOrganizationPricingForOrg = async (organizationId: number) => {
  const response = await api.get(`/organization-pricing/organization/${organizationId}`);
  return response.data;
};

export const getOrganizationPricingById = async (id: number) => {
  const response = await api.get(`/organization-pricing/admin/${id}`);
  return response.data.data;
};

export const createOrganizationPricing = async (data: PricingData) => {
  const response = await api.post('/organization-pricing/admin', data);
  return response.data.data;
};

export const updateOrganizationPricing = async (id: number, data: PricingData) => {
  const response = await api.put(`/organization-pricing/admin/${id}`, data);
  return response.data.data;
};

export const deleteOrganizationPricing = async (id: number) => {
  const response = await api.delete(`/organization-pricing/admin/${id}`);
  return response.data.data;
};

// Get class types for pricing setup
export const getClassTypes = async () => {
  const response = await api.get('/course-types');
  const data = response.data.data || [];
  // Transform the data to match expected format
  return data.map((item: { id: number; name: string }) => ({
    id: item.id,
    name: item.name
  }));
};

// Invoice and Billing API functions
export const getBillingQueue = async () => {
  const response = await api.get('/accounting/billing-queue');
  return response.data;
};

export const createInvoice = async (courseId: number) => {
  const response = await api.post('/accounting/invoices', { courseId });
  return response.data;
};

export const getInvoices = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get('/accounting/invoices', { params });
  return params ? response.data : (response.data.data || []);
};

export const getPendingApprovals = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get('/accounting/invoices/pending-approval', { params });
  return params ? response.data : (response.data.data || []);
};

export const approveInvoice = async (invoiceId: number) => {
  const response = await api.put(`/accounting/invoices/${invoiceId}/approval`, {
    approval_status: 'approved',
  });
  return response.data;
};

export const rejectInvoice = async (invoiceId: number, reason: string) => {
  const response = await api.put(`/accounting/invoices/${invoiceId}/approval`, {
    approval_status: 'rejected',
    notes: reason,
  });
  return response.data;
};

export const getRejectedInvoices = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get('/accounting/invoices/rejected', { params });
  return params ? response.data : (response.data.data || []);
};

export const resubmitInvoice = async (invoiceId: number) => {
  const response = await api.put(`/accounting/invoices/${invoiceId}/resubmit`);
  return response.data;
};

export const getInvoiceDetails = async (invoiceId: number) => {
  const response = await api.get(`/accounting/invoices/${invoiceId}`);
  return extractData(response);
};

export const updateInvoice = async (invoiceId: number, data: Record<string, unknown>) => {
  const response = await api.put(
    `/accounting/invoices/${invoiceId}`,
    data
  );
  return extractData(response);
};

export const emailInvoice = async (invoiceId: number) => {
  const response = await api.post(
    `/accounting/invoices/${invoiceId}/email`
  );
  return response.data;
};

export const postInvoiceToOrganization = async (invoiceId: number) => {
  const response = await api.put(
    `/accounting/invoices/${invoiceId}/post-to-org`
  );
  return response.data;
};

export const getInvoicePayments = async (invoiceId: number) => {
  const response = await api.get(
    `/accounting/invoices/${invoiceId}/payments`
  );
  return response.data;
};

export const recordInvoicePayment = async (
  invoiceId: number,
  paymentData: PaymentData
) => {
  const response = await api.post(
    `/accounting/invoices/${invoiceId}/payments`,
    paymentData
  );
  return response.data;
};

export const getRevenueReport = async (year: number) => {
  const response = await api.get(`/accounting/reports/revenue?year=${year}`);
  return response.data;
};

// System Administration API functions
export const sysAdminApi = {
  // Dashboard
  getDashboard: async (params?: { from?: string; to?: string }) => {
    const response = await api.get('/sysadmin/dashboard', { params });
    return response.data;
  },

  // Vendor Management
  getVendors: async () => {
    const response = await api.get('/sysadmin/vendors');
    return response.data;
  },
  createVendor: async (vendorData: VendorData) => {
    const response = await api.post('/sysadmin/vendors', vendorData);
    return response.data;
  },
  updateVendor: async (id: number, vendorData: VendorData) => {
    const response = await api.put(`/sysadmin/vendors/${id}`, vendorData);
    return response.data;
  },
  deleteVendor: async (id: number) => {
    const response = await api.delete(`/sysadmin/vendors/${id}`);
    return response.data;
  },

  // User Management
  getUsers: async () => {
    const response = await api.get('/sysadmin/users');
    return response.data;
  },
  createUser: async (userData: Record<string, unknown>) => {
    const response = await api.post('/sysadmin/users', userData);
    return response.data;
  },
  updateUser: async (id: number, userData: Record<string, unknown>) => {
    const response = await api.put(`/sysadmin/users/${id}`, userData);
    return response.data;
  },
  deleteUser: async (id: number) => {
    const response = await api.delete(`/sysadmin/users/${id}`);
    return response.data;
  },

  // Vendor Invoice Management
  getVendorInvoices: async (status?: string) => {
    const params = status ? `?status=${status}` : '';
    const response = await api.get(`/sysadmin/vendor-invoices${params}`);
    return response.data;
  },
  approveVendorInvoice: async (id: number, action: 'approve' | 'reject', comment?: string) => {
    const response = await api.put(`/sysadmin/vendor-invoices/${id}/approve`, { action, comment });
    return response.data;
  },
  downloadVendorInvoice: async (id: number) => {
    const response = await api.get(`/sysadmin/vendor-invoices/${id}/download`, { responseType: 'blob' });
    return response;
  },

  // Course Management
  getCourses: async () => {
    const response = await api.get('/sysadmin/courses');
    return response.data;
  },
  createCourse: async (courseData: CourseData) => {
    const response = await api.post('/sysadmin/courses', courseData);
    return response.data;
  },
  updateCourse: async (id: number, courseData: CourseData) => {
    const response = await api.put(`/sysadmin/courses/${id}`, courseData);
    return response.data;
  },
  deleteCourse: async (id: number) => {
    const response = await api.delete(`/sysadmin/courses/${id}`);
    return response.data;
  },
  toggleCourseActive: async (id: number) => {
    const response = await api.put(`/sysadmin/courses/${id}/toggle-active`);
    return response.data;
  },

  // Organization Management
  getOrganizations: async (params?: { page?: number; limit?: number; search?: string }) => {
    const response = await api.get('/sysadmin/organizations', { params });
    return response.data;
  },
  createOrganization: async (orgData: OrganizationData) => {
    const response = await api.post('/sysadmin/organizations', orgData);
    return response.data;
  },
  updateOrganization: async (id: number, orgData: OrganizationData) => {
    const response = await api.put(`/sysadmin/organizations/${id}`, orgData);
    return response.data;
  },
  deleteOrganization: async (id: number) => {
    const response = await api.delete(`/sysadmin/organizations/${id}`);
    return response.data;
  },

  // Organization Locations
  getOrganizationLocations: async (orgId: number) => {
    const response = await api.get(`/sysadmin/organizations/${orgId}/locations`);
    return response.data;
  },
  getOrganizationLocation: async (orgId: number, locationId: number) => {
    const response = await api.get(`/sysadmin/organizations/${orgId}/locations/${locationId}`);
    return response.data;
  },
  createOrganizationLocation: async (orgId: number, locationData: Record<string, unknown>) => {
    const response = await api.post(`/sysadmin/organizations/${orgId}/locations`, locationData);
    return response.data;
  },
  updateOrganizationLocation: async (orgId: number, locationId: number, locationData: Record<string, unknown>) => {
    const response = await api.put(`/sysadmin/organizations/${orgId}/locations/${locationId}`, locationData);
    return response.data;
  },
  deleteOrganizationLocation: async (orgId: number, locationId: number) => {
    const response = await api.delete(`/sysadmin/organizations/${orgId}/locations/${locationId}`);
    return response.data;
  },

  // Student Directory
  getStudents: async (params?: { q?: string; orgId?: number }) => {
    const query = new URLSearchParams();
    if (params?.q) query.set('q', params.q);
    if (params?.orgId) query.set('orgId', String(params.orgId));
    const qs = query.toString();
    const response = await api.get(`/sysadmin/students${qs ? `?${qs}` : ''}`);
    return response.data;
  },
  getStudent: async (id: number) => {
    const response = await api.get(`/sysadmin/students/${id}`);
    return response.data;
  },
  updateStudent: async (id: number, data: Record<string, unknown>) => {
    const response = await api.put(`/sysadmin/students/${id}`, data);
    return response.data;
  },
  updateStudentConsent: async (id: number, consent: boolean) => {
    const response = await api.put(`/sysadmin/students/${id}/consent`, { marketing_consent: consent });
    return response.data;
  },

  // Certification Expiry
  getExpiringCertifications: async (days = 90) => {
    const response = await api.get(`/sysadmin/certifications/expiring?days=${days}`);
    return response.data;
  },
  getExpiredCertifications: async () => {
    const response = await api.get('/sysadmin/certifications/expired');
    return response.data;
  },
  getCertificationStats: async () => {
    const response = await api.get('/sysadmin/certifications/stats');
    return response.data;
  },

  // Audit Logs
  getAuditLogs: async (params?: { page?: number; limit?: number; action?: string; entity_type?: string; user_id?: string; search?: string; from?: string; to?: string }) => {
    const response = await api.get('/sysadmin/audit-logs', { params });
    return response.data;
  },
  getAuditLogStats: async () => {
    const response = await api.get('/sysadmin/audit-logs/stats');
    return response.data;
  },

  // WSIB Training History Reporting
  getWSIBTrainingHistory: async (params?: { page?: number; limit?: number; org_id?: number; search?: string; from?: string; to?: string; course_type_id?: number; compliance_status?: string; course_type?: string }) => {
    const response = await api.get('/sysadmin/wsib/training-history', { params });
    return response.data;
  },
  getWSIBComplianceSummary: async (params?: { org_id?: number }) => {
    const response = await api.get('/sysadmin/wsib/compliance-summary', { params });
    return response.data;
  },
};

// Organization Analytics API
export const getOrganizationCourseRequestAnalytics = async (
  timeframe: string = '12'
) => {
  const response = await api.get(
    `/organization/analytics/course-requests?timeframe=${timeframe}`
  );
  return response.data;
};

export const getOrganizationStudentParticipationAnalytics = async (
  timeframe: string = '12'
) => {
  const response = await api.get(
    `/organization/analytics/student-participation?timeframe=${timeframe}`
  );
  return response.data;
};

// Admin endpoints
export const adminApi = {
  // Dashboard
  getDashboard: async () => {
    const response = await api.get('/admin/dashboard');
    return response.data;
  },

  // Instructor Management
  getInstructors: async () => {
    const response = await api.get('/admin/instructors');
    return response.data;
  },
  createInstructor: async (instructorData: InstructorData) => {
    const response = await api.post('/admin/instructors', instructorData);
    return response.data;
  },
  updateInstructor: async (id: number, instructorData: InstructorData) => {
    const response = await api.put(`/admin/instructors/${id}`, instructorData);
    return response.data;
  },
  deleteInstructor: async (id: number) => {
    const response = await api.delete(`/admin/instructors/${id}`);
    return response.data;
  },

  // Course Management
  getCourses: async () => {
    const response = await api.get('/admin/courses');
    return response.data;
  },
  createCourse: async (courseData: CourseData) => {
    const response = await api.post('/admin/courses', courseData);
    return response.data;
  },
  updateCourse: async (id: number, courseData: CourseData) => {
    const response = await api.put(`/admin/courses/${id}`, courseData);
    return response.data;
  },
  deleteCourse: async (id: number) => {
    const response = await api.delete(`/admin/courses/${id}`);
    return response.data;
  },
  getCourseStudents: async (courseId: number) => {
    const response = await api.get(`/courses/${courseId}/students`);
    return response.data;
  },

  // Vendor Invoice Approval
  getVendorInvoices: async () => {
    const response = await api.get('/admin/vendor-invoices');
    return response.data;
  },
  approveVendorInvoice: async (invoiceId: number, action: 'approve' | 'reject', notes: string) => {
    const response = await api.post(`/admin/vendor-invoices/${invoiceId}/approve`, {
      action,
      notes
    });
    return response.data;
  },
  downloadVendorInvoice: async (invoiceId: number) => {
    const response = await api.get(`/admin/vendor-invoices/${invoiceId}/download`, {
      responseType: 'blob'
    });
    return response;
  },
  updateVendorInvoiceNotes: async (invoiceId: number, notes: string) => {
    const response = await api.put(`/admin/vendor-invoices/${invoiceId}/notes`, {
      notes
    });
    return response.data;
  },

  // Accounting Vendor Invoice Management
  getAccountingVendorInvoices: async () => {
    const response = await api.get('/accounting/vendor-invoices');
    return response.data;
  },
  getAccountingVendorInvoiceDetails: async (invoiceId: number) => {
    const response = await api.get(`/accounting/vendor-invoices/${invoiceId}`);
    return response.data;
  },
  processVendorPayment: async (invoiceId: number, paymentData: PaymentData) => {
    const response = await api.post(`/accounting/vendor-invoices/${invoiceId}/payments`, paymentData);
    return response.data;
  },
  getVendorPaymentHistory: async () => {
    const response = await api.get('/accounting/vendor-payments');
    return response.data;
  },

  // Email Templates
  getEmailTemplates: async () => {
    const response = await api.get('/admin/email-templates');
    return response.data;
  },
  createEmailTemplate: async (templateData: EmailTemplateData) => {
    const response = await api.post('/admin/email-templates', templateData);
    return response.data;
  },
  updateEmailTemplate: async (id: number, templateData: EmailTemplateData) => {
    const response = await api.put(`/admin/email-templates/${id}`, templateData);
    return response.data;
  },
  deleteEmailTemplate: async (id: number) => {
    const response = await api.delete(`/admin/email-templates/${id}`);
    return response.data;
  },
};

// Email Template endpoints
export const emailTemplateApi = {
  getAll: (params?: Record<string, string>) => {
    devLog('[emailTemplateApi.getAll] Called with params:', params);
    const queryString = params
      ? `?${new URLSearchParams(params).toString()}`
      : '';
    const url = `/email-templates${queryString}`;
    devLog('[emailTemplateApi.getAll] Making request to:', url);
    return api.get(url);
  },
  getById: (id: number) => api.get(`/email-templates/${id}`),
  create: (data: EmailTemplateData) => api.post('/email-templates', data),
  update: (id: number, data: EmailTemplateData) =>
    api.put(`/email-templates/${id}`, data),
  delete: (id: number) => api.delete(`/email-templates/${id}`),
  preview: (id: number, variables: Record<string, unknown>) =>
    api.post(`/email-templates/${id}/preview`, { variables }),
  sendTest: (id: number, recipientEmail: string, variables: Record<string, unknown>) =>
    api.post(`/email-templates/${id}/test-send`, {
      recipientEmail,
      variables,
    }),
  clone: (id: number, newName: string) =>
    api.post(`/email-templates/${id}/clone`, { name: newName }),
  getEventTriggers: () =>
    api.get('/email-templates/meta/event-triggers'),
  getTemplateVariables: () => api.get('/email-templates/meta/variables'),
};

// Course Admin Dashboard endpoints
export const fetchCourseAdminDashboardData = async (month: string) => {
  devLog('[Debug] api.ts - Fetching course admin dashboard data for month:', month);
  try {
    const [statsResponse, summaryResponse] = await Promise.all([
      api.get<ApiResponse<Record<string, unknown>>>(`/admin/instructor-stats?month=${month}`),
      api.get<ApiResponse<Record<string, unknown>>>(`/admin/dashboard-summary?month=${month}`)
    ]);

    const data: { instructorStats: unknown; dashboardSummary: unknown } = {
      instructorStats: extractLegacyData(statsResponse) || [],
      dashboardSummary: extractLegacyData(summaryResponse) || null
    };

    devLog('[Debug] api.ts - Course admin dashboard data received:', data);
    return data;
  } catch (error) {
    devLog('[Debug] api.ts - Error fetching course admin dashboard data:', error);
    if (axios.isAxiosError(error)) {
      devLog('[Debug] api.ts - Response status:', error.response?.status);
      devLog('[Debug] api.ts - Response data:', error.response?.data);
    }
    throw error;
  }
};

// Instructor Workload Report endpoint
export const getInstructorWorkloadReport = async (startDate: string, endDate: string): Promise<unknown[]> => {
  devLog('[Debug] api.ts - Fetching instructor workload report for:', { startDate, endDate });
  try {
    const response = await api.get<ApiResponse<Record<string, unknown>[]>>('/admin/instructor-workload-report', {
      params: { startDate, endDate }
    });
    const data = extractLegacyData(response);

    devLog('[Debug] api.ts - Instructor workload report data received:', data);
    return data || [];
  } catch (error) {
    devLog('[Debug] api.ts - Error fetching instructor workload report:', error);
    if (axios.isAxiosError(error)) {
      devLog('[Debug] api.ts - Response status:', error.response?.status);
      devLog('[Debug] api.ts - Response data:', error.response?.data);
    }
    throw error;
  }
};

// Accounting Dashboard endpoints
export const fetchAccountingDashboardData = async () => {
  devLog('[Debug] api.ts - Fetching accounting dashboard data');
  try {
    const response = await api.get<ApiResponse<Record<string, unknown>>>('/accounting/dashboard');
    const data = extractLegacyData(response);

    devLog('[Debug] api.ts - Accounting dashboard data received:', data);
    return data;
  } catch (error) {
    devLog('[Debug] api.ts - Error fetching accounting dashboard data:', error);
    if (axios.isAxiosError(error)) {
      devLog('[Debug] api.ts - Response status:', error.response?.status);
      devLog('[Debug] api.ts - Response data:', error.response?.data);
    }
    throw error;
  }
};

// Vendor API functions
export const vendorApi = {
  // Dashboard
  getDashboard: async () => {
    const response = await api.get('/vendor/dashboard');
    return response.data;
  },

  // Profile
  getProfile: async () => {
    const response = await api.get('/vendor/profile');
    return response.data;
  },
  updateProfile: async (profileData: Record<string, unknown>) => {
    const response = await api.put('/vendor/profile', profileData);
    return response.data;
  },

  // Get all vendors for dropdown selection
  getVendors: async () => {
    const response = await api.get('/vendor/vendors');
    return response.data;
  },

  // Invoices
  getInvoices: async (params?: { status?: string; search?: string }) => {
    const response = await api.get('/vendor/invoices', { params });
    return response.data;
  },
  uploadInvoice: async (formData: FormData) => {
    devLog('🚀 [VENDOR API] uploadInvoice called with FormData:', formData);
    devLog('📁 [VENDOR API] FormData entries:');
    for (const [key, value] of formData.entries()) {
      devLog(`  ${key}:`, value instanceof File ? `File(${value.name}, ${value.size} bytes)` : value);
    }

    const response = await api.post('/vendor/invoices', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    devLog('✅ [VENDOR API] uploadInvoice response:', response.data);
    return response.data;
  },
  getInvoice: async (invoiceId: number) => {
    const response = await api.get(`/vendor/invoices/${invoiceId}`);
    return response.data;
  },
  downloadInvoice: async (invoiceId: number) => {
    const response = await api.get(`/vendor/invoices/${invoiceId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // OCR functions
  scanInvoice: async (file: File) => {
    const formData = new FormData();
    formData.append('invoice_pdf', file);

    const response = await api.post('/vendor/invoices/scan', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Workflow functions
  submitToAdmin: async (invoiceId: number) => {
    const response = await api.post(`/vendor/invoices/${invoiceId}/submit-to-admin`);
    return response.data;
  },

  resendToAdmin: async (invoiceId: number, notes: string) => {
    const response = await api.post(`/vendor/invoices/${invoiceId}/resend-to-admin`, { notes });
    return response.data;
  },

  getInvoicePaymentHistory: async (invoiceId: number) => {
    const response = await api.get(`/vendor/invoices/${invoiceId}/payments`);
    return response.data;
  },

  getInvoiceDetailsWithPayments: async (invoiceId: number) => {
    const response = await api.get(`/vendor/invoices/${invoiceId}/details`);
    return response.data;
  },
};

// Notification API methods
export const getNotifications = async (limit = 50, offset = 0, unreadOnly = false) => {
  try {
    const response = await api.get('/notifications', {
      params: { limit, offset, unread_only: unreadOnly }
    });
    return extractData(response);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    throw error;
  }
};

export const getUnreadNotificationCount = async () => {
  try {
    const response = await api.get('/notifications/unread-count');
    return extractData(response);
  } catch (error) {
    console.error('Error fetching unread notification count:', error);
    throw error;
  }
};

export const markNotificationAsRead = async (notificationId: number) => {
  try {
    const response = await api.post(`/notifications/${notificationId}/read`);
    return extractData(response);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

export const markAllNotificationsAsRead = async () => {
  try {
    const response = await api.post('/notifications/mark-all-read');
    return extractData(response);
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

export const deleteNotification = async (notificationId: number) => {
  try {
    const response = await api.delete(`/notifications/${notificationId}`);
    return extractData(response);
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
};

export const getNotificationPreferences = async () => {
  try {
    const response = await api.get('/notifications/preferences');
    return extractData(response);
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    throw error;
  }
};

export const updateNotificationPreferences = async (type: string, preferences: NotificationPreferences) => {
  try {
    const response = await api.put(`/notifications/preferences/${type}`, preferences);
    return extractData(response);
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    throw error;
  }
};

// Colleges API
export const collegesApi = {
  getAll: () => api.get('/colleges'),
  getAllAdmin: () => api.get('/colleges/all'),
  create: (name: string) => api.post('/colleges', { name }),
  update: (id: number, data: { name?: string; isActive?: boolean }) => api.put(`/colleges/${id}`, data),
  delete: (id: number) => api.delete(`/colleges/${id}`),
};

// =============================================================================
// Top-level convenience exports for components using `import * as api`
// =============================================================================

// Organization Management (wraps sysAdminApi methods)
export const updateOrganization = sysAdminApi.updateOrganization;
export const addOrganization = sysAdminApi.createOrganization;
export const deleteOrganization = sysAdminApi.deleteOrganization;

// Organization Locations (wraps sysAdminApi methods)
export const getOrganizationLocations = sysAdminApi.getOrganizationLocations;
export const getOrganizationLocation = sysAdminApi.getOrganizationLocation;
export const createOrganizationLocation = sysAdminApi.createOrganizationLocation;
export const updateOrganizationLocation = sysAdminApi.updateOrganizationLocation;
export const deleteOrganizationLocation = sysAdminApi.deleteOrganizationLocation;

// User Management (wraps sysAdminApi methods)
export const getUsers = sysAdminApi.getUsers;
export const deleteUser = async (userId: number) => {
  const response = await api.delete(`/sysadmin/users/${userId}`);
  return response.data;
};

// Pricing Rules (wraps organization pricing methods)
export const getPricingRules = getOrganizationPricing;
export const deletePricingRule = deleteOrganizationPricing;
export const updatePricingRule = updateOrganizationPricing;
export const addPricingRule = createOrganizationPricing;

// Course Types
export const getCourseTypes = async () => {
  const response = await api.get('/course-types');
  return response.data.data || [];
};

// Instructor Management
export const getAllInstructors = async () => {
  const response = await api.get('/courseadmin/instructors');
  return response.data.data || response.data || [];
};

// Course Scheduling (Admin)
export const scheduleCourseAdmin = async (courseId: number, scheduleData: { instructorId: number; dateScheduled: string }) => {
  const response = await api.post(`/courseadmin/courses/${courseId}/schedule`, scheduleData);
  return response.data;
};

// Organization Details (Admin view)
export const getOrganizationDetails = async (orgId: number) => {
  const response = await api.get(`/sysadmin/organizations/${orgId}`);
  return response.data.data || response.data;
};

export const getOrganizationCoursesAdmin = async (orgId: number) => {
  const response = await api.get(`/sysadmin/organizations/${orgId}/courses`);
  return response.data.data || response.data || [];
};

export const getOrganizationInvoices = async (orgId: number) => {
  const response = await api.get(`/sysadmin/organizations/${orgId}/invoices`);
  return response.data.data || response.data || [];
};

export const getOrganizationFinancialSummary = async (orgId: number) => {
  const response = await api.get(`/sysadmin/organizations/${orgId}/financial-summary`);
  return response.data.data || response.data;
};

// AR Aging Report
export const getArAgingReport = async (params?: { organizationId?: number; asOfDate?: string }) => {
  const queryParams = new URLSearchParams();
  if (params?.organizationId) queryParams.append('organization_id', params.organizationId.toString());
  if (params?.asOfDate) queryParams.append('as_of_date', params.asOfDate);
  const queryString = queryParams.toString();
  const response = await api.get(`/accounting/reports/ar-aging${queryString ? `?${queryString}` : ''}`);
  return response.data.data || response.data;
};

export default api;

devLog('[Debug] api.ts - API service initialized');
