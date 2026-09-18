// Instructor Portal Type Definitions

// User and Authentication
export interface InstructorUser {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'instructor';
  phone?: string;
  certificationNumber?: string;
  certificationExpiry?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Course Types
export interface Course {
  id: number;
  courseId: number;
  courseType: string;
  courseTypeId: number;
  organizationId: number;
  organizationName: string;
  locationId: number;
  locationName: string;
  address?: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  maxStudents: number;
  currentStudents: number;
  price: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  instructorId?: number;
  instructorName?: string;
  createdAt?: string;
  updatedAt?: string;
  students?: Student[];
}

// Student Types
export interface Student {
  id: number;
  studentId: number;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  attendance?: AttendanceStatus;
  paymentStatus?: 'paid' | 'pending' | 'partial';
  enrolledAt?: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | null;

// Availability Types
export interface AvailabilitySlot {
  id: number;
  instructorId: number;
  date: string;
  isAvailable: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Course Request Types
export interface CourseRequest {
  id: number;
  organizationId: number;
  organizationName: string;
  courseType: string;
  requestSubmittedDate: string; // When organization submitted the request
  scheduledDate: string; // Organization's preferred date
  location: string;
  estimatedStudents: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  notes?: string;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Form Types
export interface AttendanceFormData {
  studentId: number;
  attendance: AttendanceStatus;
  courseId: number;
}

export interface CourseCompletionData {
  courseId: number;
  completionDate: string;
  studentsCompleted: number;
  notes?: string;
}

// State Types for useInstructorData hook
export interface InstructorDataState {
  instructorData: InstructorUser | null;
  myClasses: Course[];
  completedClasses: Course[];
  availability: AvailabilitySlot[];
  courseRequests: CourseRequest[];
  loading: boolean;
  error: string | null;
}

// Navigation Types
export type InstructorView =
  | 'dashboard'
  | 'my-classes'
  | 'attendance'
  | 'availability'
  | 'schedule'
  | 'archive'
  | 'help';

// Calendar Event Types
export interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resource?: {
    type: 'class' | 'availability' | 'request';
    data: Course | AvailabilitySlot | CourseRequest;
  };
}

// Combined Schedule Item for My Classes View
export interface CombinedScheduleItem {
  key?: string;
  type: 'class' | 'availability';
  displayDate: string;
  organizationName?: string;
  location?: string;
  courseNumber?: string;
  courseTypeName?: string;
  studentsRegistered?: number;
  studentsAttendance?: number;
  notes?: string;
  status: string;
  // Original data
  courseId?: number;
  originalData?: Course | AvailabilitySlot | { id: number; date: string; status?: string };
}

export interface ScheduledClass {
  id: number;
  courseId: number;
  instructorId: number;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string;
  maxStudents: number;
  currentStudents: number;
  courseType: string;
  organizationName: string;
  notes?: string;
  registeredStudents: number;
  studentsAttended?: number;
}
