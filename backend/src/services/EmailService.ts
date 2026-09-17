import { env } from '../config/env.js';
import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { safeHtml } from '../utils/html.js';

const APP_URL = env.FRONTEND_URL;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

interface ClassDetails {
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  organization?: string;
  courseName?: string;
  courseType?: string;
  students: number | string;
}

interface CourseDetails {
  courseName?: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  organization?: string;
  students: number | string;
  instructorName?: string;
}

interface InvoiceData {
  invoiceNumber: string;
  organizationName: string;
  amount: number;
  invoiceDate?: string;
  courseDate?: string;
  courseName?: string;
  courseType?: string;
  location?: string;
  studentsAttended?: number;
  studentsBilled?: number;
  totalStudents?: number;
  dueDate?: string;
  portalUrl?: string;
}

interface InvoiceReminderData {
  organizationName: string;
  invoiceNumber: string;
  dueDate: string;
  amount: number;
  daysUntilDue: number;
  invoiceId: number;
}

const EMAIL_TEMPLATES = {
  COURSE_CONFIRMED: (d: { courseName: string; date: string; location: string; instructorName: string; startTime: string; endTime: string }) => ({
    subject: 'Course Confirmed',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Course Confirmed</h2>
        <p>Your course has been confirmed with the following details:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Course:</strong> ${d.courseName}</p>
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Time:</strong> ${d.startTime} - ${d.endTime}</p>
          <p><strong>Location:</strong> ${d.location}</p>
          <p><strong>Instructor:</strong> ${d.instructorName}</p>
        </div>
        <p>You can view the full details through your organization portal.</p>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

  COURSE_CANCELLED: (d: { courseName: string; date: string; reason: string }) => ({
    subject: 'Course Cancelled',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">Course Cancelled</h2>
        <p>The following course has been cancelled:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Course:</strong> ${d.courseName}</p>
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Reason:</strong> ${d.reason}</p>
        </div>
        <p>If you have any questions, please contact our team.</p>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

  COURSE_COMPLETED: (d: { courseName: string; date: string; studentsAttended: number; totalStudents: number }) => ({
    subject: 'Course Completed',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">Course Completed</h2>
        <p>The following course has been completed:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Course:</strong> ${d.courseName}</p>
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Attendance:</strong> ${d.studentsAttended} of ${d.totalStudents} students attended</p>
        </div>
        <p>You can view the full details and attendance records through your organization portal.</p>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),
};

export class EmailService {
  private apiKey: string | null;
  private fromAddress: string;
  private static instance: EmailService;

  private constructor() {
    this.apiKey = env.RESEND_API_KEY || null;
    this.fromAddress = env.EMAIL_FROM;

    if (this.apiKey) {
      logger.info('Email service: Resend configured');
    } else {
      logger.info('Email service: RESEND_API_KEY not set — mock mode');
    }
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async sendEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: { filename: string; content: Buffer }[]
  ): Promise<boolean> {
    if (!this.apiKey) {
      logger.info({ to, subject }, 'Email mock — no API key configured');
      return false;
    }

    try {
      const body: Record<string, unknown> = {
        from: this.fromAddress,
        to: [to],
        subject,
        html,
      };

      if (attachments?.length) {
        body.attachments = attachments.map(a => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        }));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as { id?: string; name?: string; message?: string };

      if (!response.ok) {
        logger.error({ to, status: response.status, error: data }, 'Resend API error');
        return false;
      }

      logger.info({ to, resendId: data.id }, 'Email sent');
      return true;
    } catch (error) {
      logger.error({ to, error: error instanceof Error ? error.message : 'Unknown error' }, 'Email send failed');
      return false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.apiKey) return false;
    logger.info('Email service: Resend client ready');
    return true;
  }

  // --- Public send methods ---

  async sendCourseConfirmedEmail(
    to: string,
    data: { courseName: string; date: string; location: string; instructorName: string; startTime: string; endTime: string }
  ) {
    const t = EMAIL_TEMPLATES.COURSE_CONFIRMED(data);
    return this.sendEmail(to, t.subject, t.html);
  }

  async sendCourseCancelledEmail(
    to: string,
    data: { courseName: string; date: string; reason: string }
  ) {
    const t = EMAIL_TEMPLATES.COURSE_CANCELLED(data);
    return this.sendEmail(to, t.subject, t.html);
  }

  async sendCourseCompletedEmail(
    to: string,
    data: { courseName: string; date: string; studentsAttended: number; totalStudents: number }
  ) {
    const t = EMAIL_TEMPLATES.COURSE_COMPLETED(data);
    return this.sendEmail(to, t.subject, t.html);
  }

  async sendPasswordResetEmail(userEmail: string, username: string, resetLink: string): Promise<boolean> {
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Password Reset Request</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>We received a request to reset the password for your CPR Training Portal account.</p>
        <p>Click the button below to reset your password. This link will expire in <strong>1 hour</strong>.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-size: 16px;">
            Reset Password
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #6c757d; font-size: 0.9em;">${resetLink}</p>
        <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
        <p style="color: #6c757d; font-size: 0.85em;">If you did not request a password reset, you can safely ignore this email.</p>
      </div>
    `;
    return this.sendEmail(userEmail, 'CPR Training Portal - Password Reset Request', html);
  }

  async sendCertExpiryReminder(
    studentEmail: string,
    firstName: string,
    courseName: string,
    certNumber: string,
    expiresAt: string,
    daysUntilExpiry: number,
  ): Promise<boolean> {
    const subject = `Your ${courseName} certification expires in ${daysUntilExpiry} days`;
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #CC1F1F; padding: 20px; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">GTACPR Certification Reminder</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p>Hi ${firstName},</p>
          <p>Your <strong>${courseName}</strong> certification (${certNumber}) expires on <strong>${new Date(expiresAt).toLocaleDateString('en-CA')}</strong> — that's <strong>${daysUntilExpiry} days</strong> from now.</p>
          <p>To maintain your certification, please schedule a renewal course before your expiry date.</p>
          <p>Contact your organization or visit our website to find upcoming courses.</p>
          <p style="margin-top: 30px; color: #666; font-size: 13px;">— GTACPR Training Management</p>
        </div>
      </div>
    `;
    return this.sendEmail(studentEmail, subject, html);
  }

}

export const emailService = EmailService.getInstance();
