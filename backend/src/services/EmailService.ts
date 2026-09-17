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
  AVAILABILITY_CONFIRMATION: (date: string) => ({
    subject: 'Availability Update Confirmation',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Availability Update Confirmation</h2>
        <p>Your availability has been updated for: <strong>${formatDate(date)}</strong></p>
        <p>You can view and manage your schedule anytime through the instructor portal.</p>
        <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
          <p style="margin: 0;"><strong>Note:</strong> You will receive notifications when classes are scheduled during your available times.</p>
        </div>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

  CLASS_SCHEDULED: (d: ClassDetails) => ({
    subject: 'New Class Scheduled',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">New Class Scheduled</h2>
        <p>A new class has been scheduled for you:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Time:</strong> ${d.startTime} - ${d.endTime}</p>
          <p><strong>Location:</strong> ${d.location}</p>
          <p><strong>Organization:</strong> ${d.organization}</p>
          <p><strong>Course Name:</strong> ${d.courseName}</p>
          <p><strong>Students:</strong> ${d.students}</p>
        </div>
        <p>Please review these details in your instructor portal.</p>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

  CLASS_REMINDER: (d: ClassDetails) => ({
    subject: 'Class Reminder',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Class Reminder</h2>
        <p>This is a reminder for your upcoming class:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Time:</strong> ${d.startTime} - ${d.endTime}</p>
          <p><strong>Location:</strong> ${d.location}</p>
          <p><strong>Organization:</strong> ${d.organization}</p>
          <p><strong>Course Name:</strong> ${d.courseName}</p>
          <p><strong>Students:</strong> ${d.students}</p>
        </div>
        <div style="margin: 20px 0; padding: 15px; background-color: #fff3cd; border-radius: 5px;">
          <p style="margin: 0;"><strong>Important:</strong> Please arrive 15 minutes before the class start time.</p>
        </div>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

  COURSE_ASSIGNED_INSTRUCTOR: (d: CourseDetails) => ({
    subject: 'New Course Assignment',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">New Course Assignment</h2>
        <p>You have been assigned to teach a new course:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Course Name:</strong> ${d.courseName}</p>
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Time:</strong> ${d.startTime} - ${d.endTime}</p>
          <p><strong>Location:</strong> ${d.location}</p>
          <p><strong>Organization:</strong> ${d.organization}</p>
          <p><strong>Number of Students:</strong> ${d.students}</p>
        </div>
        <div style="margin: 20px 0; padding: 15px; background-color: #fff3cd; border-radius: 5px;">
          <p style="margin: 0;"><strong>Important:</strong> Please review these details in your instructor portal and arrive 15 minutes before the class start time.</p>
        </div>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

  COURSE_SCHEDULED_ORGANIZATION: (d: CourseDetails) => ({
    subject: 'Course Request Confirmed',
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Course Request Confirmed</h2>
        <p>Your course request has been confirmed and an instructor has been assigned:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Course Name:</strong> ${d.courseName}</p>
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Time:</strong> ${d.startTime} - ${d.endTime}</p>
          <p><strong>Location:</strong> ${d.location}</p>
          <p><strong>Instructor:</strong> ${d.instructorName}</p>
          <p><strong>Number of Students:</strong> ${d.students}</p>
        </div>
        <p>You can view the full details and manage your courses through your organization portal.</p>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `,
  }),

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

  INVOICE_POSTED: (d: InvoiceData) => ({
    subject: `Invoice ${d.invoiceNumber} - Complete with Attendance`,
    html: safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Invoice Delivered</h2>
        <p>Dear ${d.organizationName},</p>
        <p>Your invoice has been generated and is attached to this email. This invoice includes the complete attendance list for your records.</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #007bff; margin-top: 0;">Invoice Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; font-weight: bold;">Invoice Number:</td><td style="padding: 8px 0;">${d.invoiceNumber}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Invoice Date:</td><td style="padding: 8px 0;">${d.invoiceDate}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Due Date:</td><td style="padding: 8px 0; color: #d32f2f;">${d.dueDate}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Amount Due:</td><td style="padding: 8px 0; font-size: 18px; color: #007bff; font-weight: bold;">$${d.amount.toFixed(2)}</td></tr>
          </table>
        </div>
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <h4 style="margin-top: 0; color: #1976d2;">Service Details</h4>
          <p><strong>Course Type:</strong> ${d.courseType}</p>
          <p><strong>Location:</strong> ${d.location}</p>
          <p><strong>Course Date:</strong> ${d.courseDate}</p>
          <p><strong>Students Billed:</strong> ${d.studentsBilled}</p>
        </div>
        <div style="margin: 25px 0; text-align: center;">
          <a href="${d.portalUrl}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
            View in Portal & Pay
          </a>
        </div>
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p style="margin: 0;"><strong>Payment Information:</strong></p>
          <ul style="margin: 10px 0; padding-left: 20px;">
            <li>Payment is due within 30 days of invoice date</li>
            <li>You can submit payment through your organization portal</li>
            <li>A 1.5% monthly service charge may be applied to overdue accounts</li>
            <li>Please reference the invoice number when making payment</li>
          </ul>
        </div>
        <p>If you have any questions about this invoice or need to verify attendance records, please contact our accounting department.</p>
        <p style="color: #6c757d; font-size: 0.9em; margin-top: 30px;">
          This invoice has been automatically generated and delivered. Please do not reply to this email.<br>
          For questions, contact: admin@kpbc.ca
        </p>
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

  async sendAvailabilityConfirmation(email: string, date: string) {
    const t = EMAIL_TEMPLATES.AVAILABILITY_CONFIRMATION(date);
    return this.sendEmail(email, t.subject, t.html);
  }

  async sendClassScheduledNotification(email: string, classDetails: ClassDetails) {
    const t = EMAIL_TEMPLATES.CLASS_SCHEDULED(classDetails);
    return this.sendEmail(email, t.subject, t.html);
  }

  async sendClassReminder(email: string, classDetails: ClassDetails) {
    const t = EMAIL_TEMPLATES.CLASS_REMINDER(classDetails);
    return this.sendEmail(email, t.subject, t.html);
  }

  async sendCourseAssignedNotification(instructorEmail: string, courseDetails: CourseDetails) {
    const t = EMAIL_TEMPLATES.COURSE_ASSIGNED_INSTRUCTOR(courseDetails);
    return this.sendEmail(instructorEmail, t.subject, t.html);
  }

  async sendCourseScheduledToOrganization(orgEmail: string, courseDetails: CourseDetails) {
    const t = EMAIL_TEMPLATES.COURSE_SCHEDULED_ORGANIZATION(courseDetails);
    return this.sendEmail(orgEmail, t.subject, t.html);
  }

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

  async sendInvoicePostedNotification(orgEmail: string, invoiceData: InvoiceData) {
    const t = EMAIL_TEMPLATES.INVOICE_POSTED(invoiceData);
    return this.sendEmail(orgEmail, t.subject, t.html);
  }

  async sendInvoiceWithPDF(orgEmail: string, invoiceData: InvoiceData, pdfBuffer: Buffer, filename: string) {
    const t = EMAIL_TEMPLATES.INVOICE_POSTED(invoiceData);
    return this.sendEmail(orgEmail, `Invoice ${invoiceData.invoiceNumber} - Complete with Attendance`, t.html, [
      { filename, content: pdfBuffer },
    ]);
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

  async sendInvoiceReminder(data: InvoiceReminderData, recipientEmail: string): Promise<boolean> {
    const subject = `Payment Reminder: Invoice ${data.invoiceNumber} Due in ${data.daysUntilDue} Days`;
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #1976d2; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">Payment Reminder</h1>
        </div>
        <div style="background-color: #f5f5f5; padding: 20px; margin-top: 20px;">
          <p>Dear ${data.organizationName},</p>
          <p>This is a friendly reminder that your invoice is due soon.</p>
          <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <h3>Invoice Details:</h3>
            <p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>
            <p><strong>Amount Due:</strong> <span style="font-size: 24px; color: #1976d2; font-weight: bold;">$${data.amount.toFixed(2)}</span></p>
            <p><strong>Due Date:</strong> <span style="color: #d32f2f; font-weight: bold;">${data.dueDate}</span></p>
            <p><strong>Days Until Due:</strong> ${data.daysUntilDue} days</p>
          </div>
          <p>Please ensure payment is made by the due date to avoid any late fees.</p>
          <p><a href="${APP_URL}/organization/billing" style="display: inline-block; padding: 10px 20px; background-color: #1976d2; color: white; text-decoration: none; border-radius: 5px;">View Invoice</a></p>
          <p>If you have already made payment, please disregard this reminder.</p>
        </div>
        <div style="margin-top: 20px; text-align: center; font-size: 12px; color: #666;">
          <p>This is an automated reminder. Please do not reply to this email.</p>
        </div>
      </div>
    `;

    const sent = await this.sendEmail(recipientEmail, subject, html);
    if (sent) {
      await this.logEmailSent(data.invoiceId, recipientEmail, data.daysUntilDue);
    }
    return sent;
  }

  async sendOverdueInvoiceNotification(
    orgEmail: string, orgName: string, invoiceNumber: string, dueDate: string, amount: number
  ): Promise<boolean> {
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #d32f2f; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0;">Overdue Invoice Notice</h2>
        </div>
        <div style="padding: 20px; background-color: #f5f5f5;">
          <p>Dear <strong>${orgName}</strong>,</p>
          <p>Our records show that the following invoice is <strong style="color: #d32f2f;">overdue</strong>:</p>
          <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Invoice Number:</strong> ${invoiceNumber}</p>
            <p><strong>Due Date:</strong> <span style="color: #d32f2f;">${dueDate}</span></p>
            <p><strong>Amount Outstanding:</strong> <span style="font-size: 20px; color: #d32f2f;">$${amount.toFixed(2)}</span></p>
          </div>
          <p>Please arrange payment at your earliest convenience to avoid any disruption to services.</p>
          <p style="color: #6c757d; font-size: 0.85em;">This is an automated message. Please contact your account manager if you have any questions.</p>
        </div>
      </div>
    `;
    return this.sendEmail(orgEmail, `OVERDUE: Invoice ${invoiceNumber} Payment Required`, html);
  }

  async sendCertificateEmail(
    studentEmail: string, firstName: string,
    cert: { courseName: string; certificationNumber: string; issueDate: string; expirationDate: string; instructorName: string },
    pdfBuffer: Buffer
  ): Promise<boolean> {
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2196F3; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 22px;">GTA CPR Training Services</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px;">Certificate of Completion</p>
        </div>
        <div style="background: #f9f9f9; padding: 25px; border: 1px solid #e0e0e0;">
          <p style="font-size: 16px;">Dear ${firstName},</p>
          <p>Congratulations! You have successfully completed <strong>${cert.courseName}</strong>.</p>
          <p>Your certificate is attached to this email as a PDF.</p>
          <div style="background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="color: #666; font-size: 13px; padding: 4px 0;">Certificate No.</td><td style="font-weight: bold; font-size: 13px;">${cert.certificationNumber}</td></tr>
              <tr><td style="color: #666; font-size: 13px; padding: 4px 0;">Course</td><td style="font-weight: bold; font-size: 13px;">${cert.courseName}</td></tr>
              <tr><td style="color: #666; font-size: 13px; padding: 4px 0;">Issue Date</td><td style="font-weight: bold; font-size: 13px;">${cert.issueDate}</td></tr>
              <tr><td style="color: #666; font-size: 13px; padding: 4px 0;">Expiry Date</td><td style="font-weight: bold; font-size: 13px;">${cert.expirationDate}</td></tr>
              <tr><td style="color: #666; font-size: 13px; padding: 4px 0;">Instructor</td><td style="font-weight: bold; font-size: 13px;">${cert.instructorName}</td></tr>
            </table>
          </div>
          <p style="font-size: 13px; color: #666;">Certificate number: <strong>${cert.certificationNumber}</strong>. Keep this email for your records.</p>
          <p>Thank you for training with us!</p>
        </div>
        <div style="text-align: center; padding: 15px; color: #999; font-size: 12px;">
          GTA CPR Training Services
        </div>
      </div>
    `;
    return this.sendEmail(studentEmail, `Your ${cert.courseName} Certificate — ${cert.certificationNumber}`, html, [
      { filename: `Certificate-${cert.certificationNumber}.pdf`, content: pdfBuffer },
    ]);
  }

  async sendMFAVerificationCode(userEmail: string, code: string, expiryMinutes: number): Promise<void> {
    const html = safeHtml`
      <h2>MFA Verification Code</h2>
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>This code will expire in ${expiryMinutes} minutes.</p>
      <p>If you didn't request this code, please ignore this email.</p>
    `;
    await this.sendEmail(userEmail, 'CPR Training System - MFA Verification Code', html);
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

  // --- Reminder logging (MySQL) ---

  private async logEmailSent(invoiceId: number, recipientEmail: string, daysBeforeDue: number): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO email_reminders (invoice_id, recipient_email, reminder_type, days_before_due)
         VALUES (?, ?, 'invoice_due', ?)
         ON DUPLICATE KEY UPDATE sent_at = CURRENT_TIMESTAMP`,
        [invoiceId, recipientEmail, daysBeforeDue]
      );
    } catch (error) {
      logger.error({ error }, 'Error logging email reminder');
    }
  }

  public async hasReminderBeenSent(invoiceId: number, daysBeforeDue: number): Promise<boolean> {
    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        `SELECT COUNT(*) as count FROM email_reminders
         WHERE invoice_id = ? AND days_before_due = ?
         AND sent_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [invoiceId, daysBeforeDue]
      );
      return Number(rows[0]?.count ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

export const emailService = EmailService.getInstance();
