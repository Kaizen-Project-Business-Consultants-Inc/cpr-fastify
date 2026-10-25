import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { safeHtml, raw } from '../utils/html.js';


// Dates here are calendar days (YYYY-MM-DD), read as UTC midnight; format
// them in UTC so a server in another zone can't show the day before.
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

/** "09:30:00" or "09:30" → "9:30 AM"; anything else unchanged. */
function formatClockTime(value: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!m) return value ?? '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** What happened to an instructor's class. */
export type InstructorNoticeKind = 'booked' | 'rescheduled' | 'cancelled' | 'removed';

export interface InstructorNoticeData {
  instructorName: string;
  courseName: string;
  organizationName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string;
  reason?: string;
  scheduleUrl: string;
}

const INSTRUCTOR_NOTICE: Record<InstructorNoticeKind, { subject: (d: InstructorNoticeData) => string; heading: string; intro: string; color: string }> = {
  booked: {
    subject: (d) => `You're booked: ${d.courseName} on ${formatDate(d.date)}`,
    heading: "You're booked for a class", intro: "You've been booked to teach this class:", color: '#28a745',
  },
  rescheduled: {
    subject: (d) => `Class changed: ${d.courseName} is now on ${formatDate(d.date)}`,
    heading: 'Your class has changed', intro: 'One of your classes has new details:', color: '#007bff',
  },
  cancelled: {
    subject: (d) => `Class cancelled: ${d.courseName} on ${formatDate(d.date)}`,
    heading: 'Your class is cancelled', intro: 'This class has been cancelled, so you no longer need to teach it:', color: '#d32f2f',
  },
  removed: {
    subject: (d) => `You're no longer teaching ${d.courseName} on ${formatDate(d.date)}`,
    heading: 'Another instructor is teaching this class', intro: 'This class has been given to another instructor, so you no longer need to teach it:', color: '#6c757d',
  },
};

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
  /** Where a person can report a request they did not make (the address on the public login page). */
  private static readonly SUPPORT_ADDRESS = 'admin@kpbc.ca';

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
    attachments?: { filename: string; content: Buffer }[],
    cc?: string[]
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

      if (cc?.length) body.cc = cc;

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

  /** Tells the user who requested a course that it arrived. The organization's admins are copied. */
  async sendCourseRequestReceivedEmail(
    to: string,
    cc: string[],
    data: {
      requesterName: string; organizationName: string; courseName: string; date: string; location: string;
      students: number; portalUrl: string;
      /** The request came in as an email. The sender's address is not proven, so say so and leave out their free text. */
      viaEmail?: boolean;
    }
  ): Promise<boolean> {
    const details = data.viaEmail
      ? safeHtml`
        <p><strong>Course:</strong> ${data.courseName}</p>
        <p><strong>Requested date:</strong> ${formatDate(data.date)}</p>
        <p><strong>Students:</strong> ${data.students > 0 ? String(data.students) : 'To be confirmed'}</p>`
      : safeHtml`
        <p><strong>Course:</strong> ${data.courseName}</p>
        <p><strong>Requested date:</strong> ${formatDate(data.date)}</p>
        <p><strong>Location:</strong> ${data.location}</p>
        <p><strong>Students:</strong> ${data.students > 0 ? String(data.students) : 'To be confirmed'}</p>`;
    const intro = data.viaEmail
      ? safeHtml`<p>We received an email asking for a course for ${data.organizationName}. If that was you, there is nothing more to do. Course Admin will review it, assign an instructor, and email you when it is confirmed.</p>`
      : safeHtml`<p>Your request for ${data.organizationName} is in. Course Admin will review it, assign an instructor, and email you when it is confirmed.</p>`;
    const outro = data.viaEmail
      ? safeHtml`<p>Follow it under <strong>My Courses</strong>: <a href="${data.portalUrl}">${data.portalUrl}</a></p>
        <p><strong>Was this not you?</strong> Please tell us at ${EmailService.SUPPORT_ADDRESS} so we can look into it.</p>`
      : safeHtml`<p>Follow it under <strong>My Courses</strong>: <a href="${data.portalUrl}">${data.portalUrl}</a></p>`;
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">${data.viaEmail ? 'We received an email asking for a course' : 'We received your course request'}</h2>
        <p>Hi ${data.requesterName},</p>
        ${raw(intro)}
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          ${raw(details)}
        </div>
        ${raw(outro)}
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `;
    const subject = `${data.viaEmail ? 'Course request received by email' : 'Request received'}: ${data.courseName} on ${formatDate(data.date)}`;
    return this.sendEmail(to, subject, html, undefined, cc);
  }

  /** Tells an instructor they were booked, or that their class changed or was cancelled. */
  async sendInstructorCourseEmail(to: string, kind: InstructorNoticeKind, d: InstructorNoticeData): Promise<boolean> {
    const n = INSTRUCTOR_NOTICE[kind];
    const time = d.startTime && d.endTime ? `${formatClockTime(d.startTime)} - ${formatClockTime(d.endTime)}` : 'To be confirmed';
    const reasonLine = d.reason ? safeHtml`<p><strong>Reason:</strong> ${d.reason}</p>` : '';
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${n.color};">${n.heading}</h2>
        <p>Hi ${d.instructorName},</p>
        <p>${n.intro}</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Course:</strong> ${d.courseName}</p>
          <p><strong>Organization:</strong> ${d.organizationName}</p>
          <p><strong>Date:</strong> ${formatDate(d.date)}</p>
          <p><strong>Time:</strong> ${time}</p>
          <p><strong>Location:</strong> ${d.location || 'To be confirmed'}</p>
          ${raw(reasonLine)}
        </div>
        <p>See all your classes in <a href="${d.scheduleUrl}">My Schedule</a>.</p>
        <p style="color: #6c757d; font-size: 0.9em;">This is an automated message, please do not reply.</p>
      </div>
    `;
    return this.sendEmail(to, n.subject(d), html);
  }

  /** Tells an organization a new invoice is in its portal (sent when accounting posts it). */
  async sendInvoicePostedEmail(
    to: string,
    data: { invoiceNumber: string; organizationName: string; amount: string; dueDate: string; portalUrl: string }
  ): Promise<boolean> {
    const html = safeHtml`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">New invoice ${data.invoiceNumber}</h2>
        <p>Hello ${data.organizationName},</p>
        <p>A new invoice is ready in your CPR Training Portal.</p>
        <p><strong>Amount:</strong> ${data.amount}<br><strong>Due:</strong> ${data.dueDate}</p>
        <p>Sign in and open <strong>Bills Payable</strong> to view and pay it:</p>
        <p><a href="${data.portalUrl}">${data.portalUrl}</a></p>
      </div>
    `;
    return this.sendEmail(to, `CPR Training Portal - Invoice ${data.invoiceNumber}`, html);
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
          <p>Your <strong>${courseName}</strong> certification (${certNumber}) expires on <strong>${new Date(expiresAt).toLocaleDateString('en-CA', { timeZone: 'UTC' })}</strong> — that's <strong>${daysUntilExpiry} days</strong> from now.</p>
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
