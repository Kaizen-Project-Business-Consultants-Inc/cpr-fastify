import axios from 'axios';
import { tokenService } from './tokenService';
import type {
  ApiResponse,
  CourseData,
  OrganizationData,
  VendorData,
  StudentData,
  PricingData,
  PaymentData,
  InvoicePaymentData,
  EmailTemplateData,
} from '../types/api';
import { API_URL } from '../config';

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
      params: config.params,
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
      url: response.config?.url,
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

// SYSADMIN endpoints
export const sysadminApi = {
  getConfigurations: () => api.get('/sysadmin/configurations'),
  updateConfiguration: (key: string, value: string) =>
    api.put(`/sysadmin/configurations/${key}`, { value }),
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

// Instructor endpoints
export const instructorApi = {
  // Basic instructor data
  getAvailability: () => api.get('/instructor/availability'),

  // Classes and courses
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
  updateStudentAttendance: (courseId: number, studentId: string, attended: boolean) =>
    api.put(`/instructor/classes/${courseId}/students/${studentId}/attendance`, { attended }),
  addStudent: (courseId: number, studentData: StudentData) =>
    api.post(`/instructor/classes/${courseId}/students`, studentData),
  markReady: (courseId: number, location: { lat: number; lng: number; accuracy: number }) =>
    api.post(`/instructor/classes/${courseId}/ready`, { location }),

  // Availability management
  removeAvailability: (date: string) => api.delete(`/instructor/availability/${date}`),
  /** Several days in one save. Dates the server can't change come back in `skipped`. */
  saveAvailabilityBatch: (changes: { add: string[]; remove: string[] }) =>
    api.post<AvailabilityBatchResult>('/instructor/availability/batch', changes),
};

export interface AvailabilityBatchResult {
  success: boolean;
  added: string[];
  removed: string[];
  skipped: { date: string; reason: string }[];
}

// Export the api instance for use in other services
export { api };

// Accounting and Course Pricing API functions
export const getCoursePricing = async () => {
  const response = await api.get('/accounting/course-pricing');
  return response.data.data || [];
};

/** PUT /accounting/course-pricing/:id: changes one course price. */
export const updateCoursePrice = async (pricingId: number, data: PricingData) => {
  const response = await api.put(
    `/accounting/course-pricing/${pricingId}`,
    data
  );
  return response.data;
};

/** POST /accounting/course-pricing: adds a course price. */
export const createCoursePricing = async (data: PricingData): Promise<ApiResponse<Record<string, unknown>>> => {
  const response = await api.post('/accounting/course-pricing', data);
  return response.data;
};

/** DELETE /accounting/course-pricing/:id: removes one course price. */
export const deleteCoursePricing = async (id: number) => {
  const response = await api.delete(`/accounting/course-pricing/${id}`);
  return response.data;
};

/** GET /accounting/organizations: the organizations accounting can bill. Returns an empty list if there are none. */
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

/** POST /organization-pricing/admin: sets a price for one organization and course type. */
export const createOrganizationPricing = async (data: PricingData) => {
  const response = await api.post('/organization-pricing/admin', data);
  return response.data.data;
};

/** PUT /organization-pricing/admin/:id: changes one organization price. */
export const updateOrganizationPricing = async (id: number, data: PricingData) => {
  const response = await api.put(`/organization-pricing/admin/${id}`, data);
  return response.data.data;
};

/** DELETE /organization-pricing/admin/:id: removes one organization price. */
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

/** POST /accounting/invoices: creates an invoice for a course that was sent to billing. */
export const createInvoice = async (courseId: number) => {
  const response = await api.post('/accounting/invoices', { courseId });
  return response.data;
};

/**
 * GET /accounting/invoices — this endpoint ALWAYS paginates (default 25 rows per
 * page, `limit` capped at 200 by the backend), unlike most of the API where
 * paging is opt-in. Callers must pass `{ page, limit }` and read the returned
 * `pagination` block ({ page, limit, total, pages }); a caller that needs every
 * invoice has to walk the pages (see TransactionHistoryView / AccountingPortal).
 *
 * Calling it with no params returns only the FIRST PAGE's rows (25 invoices)
 * as a bare array — kept for backwards compatibility, but never treat that
 * array as the complete set.
 */
export const getInvoices = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get('/accounting/invoices', { params });
  return params ? response.data : (response.data.data || []);
};

/** GET /accounting/invoices/pending-approval: invoices waiting for approval. Returns the whole response when paged, otherwise just the list. */
export const getPendingApprovals = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get('/accounting/invoices/pending-approval', { params });
  return params ? response.data : (response.data.data || []);
};

/** PUT /accounting/invoices/:id/approval: approves a pending invoice. */
export const approveInvoice = async (invoiceId: number) => {
  // PUT /accounting/invoices/:id/approval requires camelCase approvalStatus;
  // this sent approval_status and always 400'd, so approving an invoice
  // through this screen has never worked.
  const response = await api.put(`/accounting/invoices/${invoiceId}/approval`, {
    approvalStatus: 'approved',
  });
  return response.data;
};

/** PUT /accounting/invoices/:id/approval: rejects a pending invoice, with the reason as the note. */
export const rejectInvoice = async (invoiceId: number, reason: string) => {
  const response = await api.put(`/accounting/invoices/${invoiceId}/approval`, {
    approvalStatus: 'rejected',
    notes: reason,
  });
  return response.data;
};

/** GET /accounting/invoices/rejected: rejected invoices. Returns the whole response when paged, otherwise just the list. */
export const getRejectedInvoices = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get('/accounting/invoices/rejected', { params });
  return params ? response.data : (response.data.data || []);
};

/** PUT /accounting/invoices/:id/resubmit: puts a rejected invoice back to pending. */
export const resubmitInvoice = async (invoiceId: number) => {
  const response = await api.put(`/accounting/invoices/${invoiceId}/resubmit`);
  return response.data;
};

/** GET /accounting/invoices/:id: one invoice with its details. */
export const getInvoiceDetails = async (invoiceId: number) => {
  const response = await api.get(`/accounting/invoices/${invoiceId}`);
  return extractData(response);
};

/** PUT /accounting/invoices/:id/post-to-org: shows the invoice to its organization and emails it. */
export const postInvoiceToOrganization = async (invoiceId: number) => {
  const response = await api.put(
    `/accounting/invoices/${invoiceId}/post-to-org`
  );
  return response.data;
};

/** POST /accounting/invoices/:id/resend-email: emails a posted invoice again. The server refuses a second send within a minute. */
export const resendInvoiceEmail = async (invoiceId: number) => {
  const response = await api.post(
    `/accounting/invoices/${invoiceId}/resend-email`
  );
  return response.data;
};

/** GET /accounting/invoices/:id/payments: the payments recorded on one invoice. */
export const getInvoicePayments = async (invoiceId: number) => {
  const response = await api.get(
    `/accounting/invoices/${invoiceId}/payments`
  );
  return response.data;
};

/** POST /accounting/invoices/:id/payments: records a payment on one invoice. The server refuses more than the balance still owed. */
export const recordInvoicePayment = async (
  invoiceId: number,
  paymentData: InvoicePaymentData
) => {
  const response = await api.post(
    `/accounting/invoices/${invoiceId}/payments`,
    paymentData
  );
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
  /** Emails the user a one-hour password reset link. */
  sendPasswordResetLink: async (id: number) => {
    const response = await api.post(`/sysadmin/users/${id}/reset-password`);
    return response.data as { success: boolean; message: string };
  },
  /** Privacy-law erasure: blanks the person's details and blocks sign-in. Cannot be undone. */
  erasePersonalData: async (id: number) => {
    const response = await api.delete(`/sysadmin/users/${id}/personal-data`);
    return response.data as { success: boolean; message: string };
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

// Admin endpoints
export const adminApi = {
  getCourseStudents: async (courseId: number) => {
    const response = await api.get(`/courses/${courseId}/students`);
    return response.data;
  },
  approveVendorInvoice: async (invoiceId: number, action: 'approve' | 'reject', notes: string) => {
    const response = await api.post(`/admin/vendor-invoices/${invoiceId}/approve`, {
      action,
      notes
    });
    return response.data;
  },
  // The PDF route lives with the vendor routes; it lets staff download any invoice.
  downloadVendorInvoice: async (invoiceId: number) => {
    const response = await api.get(`/vendor/invoices/${invoiceId}/download`, {
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
  getAccountingVendorInvoiceDetails: async (invoiceId: number) => {
    const response = await api.get(`/accounting/vendor-invoices/${invoiceId}`);
    return response.data;
  },
  processVendorPayment: async (invoiceId: number, paymentData: PaymentData) => {
    const response = await api.post(`/accounting/vendor-invoices/${invoiceId}/payments`, paymentData);
    return response.data;
  },
  /** Accounting sends an unpaid vendor invoice back to the vendor with a reason. */
  rejectVendorInvoiceAsAccounting: async (invoiceId: number, notes: string) => {
    const response = await api.post(`/accounting/vendor-invoices/${invoiceId}/reject`, { notes });
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
  create: (data: EmailTemplateData) => api.post('/email-templates', data),
  update: (id: number, data: EmailTemplateData) =>
    api.put(`/email-templates/${id}`, data),
  delete: (id: number) => api.delete(`/email-templates/${id}`),
  // The server's testSendSchema takes only `to`; it fills the template with
  // sample values itself, so the preview variables are not sent.
  sendTest: (id: number, recipientEmail: string) =>
    api.post(`/email-templates/${id}/test-send`, { to: recipientEmail }),
  clone: (id: number, newName: string) =>
    api.post(`/email-templates/${id}/clone`, { name: newName }),
  getTemplateVariables: () => api.get('/email-templates/meta/variables'),
};

// Course Admin Dashboard endpoints
export const fetchCourseAdminDashboardData = async (month: string) => {
  devLog('[Debug] api.ts - Fetching course admin dashboard data for month:', month);
  try {
    const statsResponse = await api.get<ApiResponse<{ stats: unknown[]; summary: unknown }>>('/admin/instructor-stats', { params: { month } });
    const { stats, summary } = extractLegacyData(statsResponse);

    const data: { instructorStats: unknown; dashboardSummary: unknown } = {
      instructorStats: stats || [],
      dashboardSummary: summary || null
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
  /** Send a rejected invoice back to admin, saying what was changed. */
  resendToAdmin: async (invoiceId: number, notes: string) => {
    const response = await api.post(`/vendor/invoices/${invoiceId}/resend-to-admin`, { notes });
    return response.data;
  },
  submitToAdmin: async (invoiceId: number) => {
    const response = await api.post(`/vendor/invoices/${invoiceId}/submit-to-admin`);
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

// Organization Locations (wraps sysAdminApi methods)
export const getOrganizationLocations = sysAdminApi.getOrganizationLocations;
export const createOrganizationLocation = sysAdminApi.createOrganizationLocation;
export const deleteOrganizationLocation = sysAdminApi.deleteOrganizationLocation;

// Course Types
export const getCourseTypes = async () => {
  const response = await api.get('/course-types');
  return response.data.data || [];
};

export default api;

devLog('[Debug] api.ts - API service initialized');
