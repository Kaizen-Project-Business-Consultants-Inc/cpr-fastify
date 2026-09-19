import { api } from './api';

export interface Timesheet {
  id: number;
  instructorId: number;
  instructorName?: string;
  instructorEmail?: string;
  weekStartDate: string;
  totalHours: number;
  coursesTaught: number;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  hrComment?: string;
  createdAt: string;
  updatedAt: string;
  travelTime?: number;
  prepTime?: number;
  teachingHours?: number;
  isLate?: boolean;
  courseDetails?: {
    courseId: number;
    courseType: string;
    date: string;
    hours: number;
    startTime?: string;
    endTime?: string;
    organizationName?: string;
    location?: string;
    studentCount?: number;
    status?: string;
  }[];
}

export interface TimesheetStats {
  pendingTimesheets: number;
  approvedThisMonth: number;
  totalHoursThisMonth: number;
  instructorsWithPending: number;
}

export interface TimesheetSummary {
  totalTimesheets: number;
  approvedTimesheets: number;
  pendingTimesheets: number;
  rejectedTimesheets: number;
  totalApprovedHours: number;
  totalCoursesTaught: number;
  lastSubmissionDate: string;
}

export interface TimesheetFilters {
  page?: number;
  limit?: number;
  status?: string;
  instructorId?: string;
  month?: string;
}

export interface TimesheetSubmission {
  weekStartDate: string;
  totalHours?: number;
  coursesTaught?: number;
  notes?: string;
  travelTime?: number;
  prepTime?: number;
  isLate?: boolean;
}

export interface WeekCourses {
  weekStartDate: string;
  weekEndDate: string;
  courses: Array<{
    id: number;
    date: string;
    startTime: string;
    endTime: string;
    status: string;
    location: string;
    courseType: string;
    organizationName: string;
    studentCount: number;
  }>;
  totalCourses: number;
}

export interface TimesheetUpdate {
  totalHours: number;
  coursesTaught?: number;
  notes?: string;
}

export interface TimesheetApproval {
  action: 'approve' | 'reject';
  comment?: string;
}

export interface TimesheetNote {
  id: number;
  timesheetId: number;
  userId: number;
  userRole: string;
  noteText: string;
  noteType: 'instructor' | 'hr' | 'accounting' | 'general';
  createdAt: string;
  updatedAt: string;
  addedBy: string;
  addedByEmail: string;
}

export interface TimesheetNoteSubmission {
  noteText: string;
  noteType?: 'instructor' | 'hr' | 'accounting' | 'general';
}

class TimesheetService {
  // Get timesheet statistics (HR only)
  async getStats(): Promise<TimesheetStats> {
    const response = await api.get('/timesheet/stats');
    return response.data.data;
  }

  // Get timesheets with filtering
  async getTimesheets(filters: TimesheetFilters = {}): Promise<{
    timesheets: Timesheet[];
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
    if (filters.instructorId) params.append('instructor_id', filters.instructorId);
    if (filters.month) params.append('month', filters.month);

    const response = await api.get(`/timesheet?${params.toString()}`);
    return response.data.data;
  }

  // Get timesheet details
  async getTimesheet(timesheetId: number): Promise<Timesheet> {
    const response = await api.get(`/timesheet/${timesheetId}`);
    return response.data.data;
  }

  // Submit new timesheet (Instructors only)
  async submitTimesheet(data: TimesheetSubmission): Promise<Timesheet> {
    const response = await api.post('/timesheet', data);
    return response.data.data;
  }

  // Update timesheet (Instructors only)
  async updateTimesheet(timesheetId: number, data: TimesheetUpdate): Promise<Timesheet> {
    const response = await api.put(`/timesheet/${timesheetId}`, data);
    return response.data.data;
  }

  // Approve/reject timesheet (HR only)
  async approveTimesheet(timesheetId: number, data: TimesheetApproval): Promise<void> {
    await api.post(`/timesheet/${timesheetId}/approve`, data);
  }

  // Get instructor timesheet summary
  async getInstructorSummary(instructorId: number): Promise<{
    summary: TimesheetSummary;
    recentTimesheets: Timesheet[];
  }> {
    const response = await api.get(`/timesheet/instructor/${instructorId}/summary`);
    return response.data.data;
  }

  // Get courses for a specific week (Monday to Sunday)
  async getWeekCourses(weekStartDate: string): Promise<WeekCourses> {
    const response = await api.get(`/timesheet/week/${weekStartDate}/courses`);
    return response.data.data;
  }

  // Get timesheet notes
  async getTimesheetNotes(timesheetId: number): Promise<TimesheetNote[]> {
    const response = await api.get(`/timesheet/${timesheetId}/notes`);
    return response.data.data;
  }

  // Add note to timesheet
  async addTimesheetNote(timesheetId: number, data: TimesheetNoteSubmission): Promise<TimesheetNote> {
    // POST /timesheet/:id/notes requires snake_case (note_text/note_type);
    // this form's own fields are camelCase and were sent as-is, so
    // note_text always came through undefined (required, min length 1) and
    // the request always 400'd. Adding a timesheet note has never worked.
    const response = await api.post(`/timesheet/${timesheetId}/notes`, {
      note_text: data.noteText,
      note_type: data.noteType,
    });
    return response.data.data;
  }

  // Delete timesheet note
  async deleteTimesheetNote(timesheetId: number, noteId: number): Promise<void> {
    await api.delete(`/timesheet/${timesheetId}/notes/${noteId}`);
  }

  // Get instructors pending timesheet submission (HR only)
  async getPendingReminders(): Promise<{
    weekStartDate: string;
    instructorsWithoutTimesheet: Array<{
      id: number;
      username: string;
      email: string;
      completed_courses: number;
    }>;
  }> {
    const response = await api.get('/timesheet/reminders/pending');
    return response.data.data;
  }

  // Send reminder notifications to instructors (HR only)
  async sendReminders(instructorIds: number[]): Promise<{ sentCount: number; weekStartDate: string }> {
    const response = await api.post('/timesheet/reminders/send', { instructorIds });
    return response.data.data;
  }

  // Get my payment requests (Instructor only)
  async getMyPayments(page = 1, limit = 10): Promise<{
    payments: Array<{
      id: number;
      amount: number;
      status: 'pending' | 'approved' | 'paid' | 'rejected';
      payment_method?: string;
      processed_at?: string;
      notes?: string;
      created_at: string;
      week_start_date: string;
      total_hours: number;
      courses_taught: number;
      teaching_hours?: number;
      travel_time?: number;
      prep_time?: number;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    const response = await api.get(`/payment-requests/my-payments?page=${page}&limit=${limit}`);
    return response.data.data;
  }
}

export const timesheetService = new TimesheetService(); 