export interface User {
  id: number;
  username: string;
  email?: string;
  role: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  organizationId?: number;
  createdAt?: string;
  updatedAt?: string;
  // Allow additional properties
  [key: string]: unknown;
}

export interface Class {
  id: number;
  courseId: number;
  instructorId: number;
  startTime: string;
  endTime: string;
  status: string;
  location: string;
  maxStudents: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  courseName: string;
  courseTypeName?: string;
  organizationName?: string;
  notes: string;
  studentCount?: number;
  studentsAttendance?: number;
  date?: string;
  type?: string;
  // Legacy snake_case aliases for backward compatibility
  coursetypename?: string;
  organizationname?: string;
  studentcount?: number;
  studentsattendance?: number;
}

export interface Availability {
  id: string;
  instructorId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'available' | 'booked' | 'unavailable';
}

export interface DashboardMetrics {
  upcomingClasses: number;
  totalStudents: number;
  completedClasses: number;
  nextClass?: {
    date: string;
    time: string;
    location: string;
    type: string;
  };
  recentClasses: Array<{
    id: string;
    date: string;
    type: string;
    students: number;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string | { code?: string; message?: string };
  meta?: Record<string, unknown>;
  status?: number;
  message?: string;
}

// Common data types for API requests/responses
export interface CourseData {
  id?: number;
  name?: string;
  description?: string;
  courseTypeId?: number;
  durationHours?: number;
  maxStudents?: number;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface InstructorData {
  id?: number;
  userId?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface OrganizationData {
  id?: number;
  name?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface VendorData {
  id?: number;
  name?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface StudentData {
  id?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  attended?: boolean;
  [key: string]: unknown;
}

export interface PricingData {
  id?: number;
  organizationId?: number | string;
  courseTypeId?: number | string;
  price?: number;
  pricePerStudent?: number;
  effectiveDate?: string;
  [key: string]: unknown;
}

/**
 * Body accepted by POST /accounting/invoices/:id/payments.
 * Mirrors the backend zod schema exactly (billing.ts `paymentSchema`).
 * Any other key is stripped by the server, so do not invent fields here.
 */
export interface InvoicePaymentData {
  amount: number;
  paymentMethod: string;
  reference?: string;
  /** YYYY-MM-DD. Omitted means the server stamps CURRENT_DATE. */
  paymentDate?: string;
  notes?: string;
}

/** Body accepted by POST /accounting/vendor-invoices/:id/payments (snake_case). */
export interface PaymentData {
  amount: number | string;
  paymentDate?: string;
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface EmailTemplateData {
  id?: number;
  name?: string;
  key?: string;
  subject?: string;
  body?: string;
  category?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface NotificationPreferences {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  [key: string]: unknown;
}
