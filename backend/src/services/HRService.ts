import { getPool } from '../config/database.js';
import { ProfileChangeRepository, ProfileChange } from '../repositories/ProfileChangeRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import type { RowDataPacket } from 'mysql2/promise';

// Safe column mapping — prevents SQL injection even if profile_changes table is compromised
const PROFILE_CHANGE_COLUMN_MAP: Record<string, string> = {
  first_name: 'first_name',
  last_name: 'last_name',
  full_name: 'full_name',
  email: 'email',
  phone: 'phone',
  mobile: 'mobile',
  address: 'address',
  date_onboarded: 'date_onboarded',
  date_offboarded: 'date_offboarded',
  emergency_contact_name: 'emergency_contact_name',
  emergency_contact_phone: 'emergency_contact_phone',
  user_comments: 'user_comments',
} as const;

const SAFE_COLUMN_RE = /^[a-z][a-z0-9_]{0,63}$/;

function getSafeColumn(fieldName: string): string {
  const col = PROFILE_CHANGE_COLUMN_MAP[fieldName];
  if (!col || !SAFE_COLUMN_RE.test(col)) {
    throw new HRError(`Field '${fieldName}' is not permitted for profile changes`);
  }
  return col;
}

export class HRError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'HRError';
  }
}

export class HRService {
  constructor(
    private profileChangeRepo: ProfileChangeRepository,
    private userRepo: UserRepository,
  ) {}

  async getDashboardStats() {
    const pool = getPool();

    const [[pending], [activeInstructors], [orgs], [expiring], recentChanges, pendingList] = await Promise.all([
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM profile_changes WHERE status = 'pending'`),
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM users WHERE role = 'instructor' AND id IN (
           SELECT DISTINCT instructor_id FROM course_requests
           WHERE status IN ('confirmed', 'completed')
           AND created_at >= NOW() - INTERVAL 30 DAY
         )`
      ),
      pool.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM organizations`),
      pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM certifications
         WHERE expiration_date BETWEEN NOW() AND NOW() + INTERVAL 30 DAY`
      ),
      this.profileChangeRepo.findRecentWithUsers(5),
      this.profileChangeRepo.findAllPendingWithUsers(),
    ]);

    return {
      pendingApprovals: Number(pending[0]?.count ?? 0),
      activeInstructors: Number(activeInstructors[0]?.count ?? 0),
      organizations: Number(orgs[0]?.count ?? 0),
      expiringCertifications: Number(expiring[0]?.count ?? 0),
      recentChanges,
      pendingApprovalsList: pendingList,
    };
  }

  async getInstructors(options: { search?: string; page: number; limit: number }) {
    const pool = getPool();
    const safeLimit = Math.min(options.limit, 100);
    const offset = (options.page - 1) * safeLimit;
    const params: unknown[] = [];
    let searchClause = '';

    if (options.search) {
      searchClause = 'AND (u.username LIKE ? OR u.email LIKE ?)';
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.phone, u.created_at, u.updated_at,
              COUNT(DISTINCT cr.id) as total_courses,
              COUNT(DISTINCT CASE WHEN cr.status = 'completed' THEN cr.id END) as completed_courses,
              COUNT(DISTINCT CASE WHEN cr.status = 'confirmed' THEN cr.id END) as active_courses,
              MAX(cr.completed_at) as last_course_date
       FROM users u
       LEFT JOIN course_requests cr ON u.id = cr.instructor_id
       WHERE u.role = 'instructor' AND u.status = 'active' ${searchClause}
       GROUP BY u.id, u.username, u.email, u.phone, u.created_at, u.updated_at
       ORDER BY u.username
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users WHERE role = 'instructor' AND status = 'active' ${searchClause}`,
      params
    );

    return {
      instructors: rows,
      pagination: { page: options.page, limit: safeLimit, total: Number(countRows[0]?.total ?? 0), pages: Math.ceil(Number(countRows[0]?.total ?? 0) / safeLimit) },
    };
  }

  async getPendingChanges(options: { page: number; limit: number }) {
    const safeLimit = Math.min(options.limit, 100);
    const { rows, total } = await this.profileChangeRepo.findPendingWithUsers({ limit: safeLimit, offset: (options.page - 1) * safeLimit });
    return {
      pendingChanges: rows,
      pagination: { page: options.page, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
  }

  async approveOrRejectChange(changeId: number, action: 'approve' | 'reject', comment?: string) {
    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [changeRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM profile_changes WHERE id = ? AND status = 'pending'`,
        [changeId]
      );

      if (changeRows.length === 0) {
        throw new HRError('Profile change not found or already processed', 404);
      }

      const change = changeRows[0];
      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      await conn.query(
        `UPDATE profile_changes SET status = ?, hr_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newStatus, comment ?? null, changeId]
      );

      if (action === 'approve') {
        const safeColumn = getSafeColumn(change.field_name);
        await conn.query(
          `UPDATE users SET \`${safeColumn}\` = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [change.new_value, change.user_id]
        );
      }

      await conn.commit();
      return { message: `Profile change ${action === 'approve' ? 'approved' : 'rejected'} successfully` };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getUserProfile(userId: number) {
    const pool = getPool();

    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT u.*, o.name as organization_name
       FROM users u LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = ?`,
      [userId]
    );

    if (userRows.length === 0) throw new HRError('User not found', 404);
    const user = userRows[0];

    const profileChanges = await this.profileChangeRepo.findByUserId(userId);

    let courseHistory: RowDataPacket[] = [];
    if (user.role === 'instructor') {
      const [courses] = await pool.query<RowDataPacket[]>(
        `SELECT cr.*, ct.name as course_type_name, o.name as organization_name
         FROM course_requests cr
         LEFT JOIN class_types ct ON cr.course_type_id = ct.id
         LEFT JOIN organizations o ON cr.organization_id = o.id
         WHERE cr.instructor_id = ?
         ORDER BY cr.created_at DESC LIMIT 10`,
        [userId]
      );
      courseHistory = courses;
    }

    return { user, profileChanges, courseHistory };
  }

  async getReturnedPaymentRequests(options: { page: number; limit: number }) {
    const pool = getPool();
    const safeLimit = Math.min(options.limit, 100);
    const offset = (options.page - 1) * safeLimit;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pr.*, u.username as instructor_name, u.email as instructor_email,
              t.week_start_date, t.total_hours, t.courses_taught, t.hr_comment as timesheet_comment,
              COALESCE(ipr.hourly_rate, 25.00) as hourly_rate,
              COALESCE(ipr.course_bonus, 50.00) as course_bonus,
              (t.total_hours * COALESCE(ipr.hourly_rate, 25.00)) as base_amount,
              (t.courses_taught * COALESCE(ipr.course_bonus, 50.00)) as bonus_amount,
              COALESCE(prt.name, 'Default') as tier_name
       FROM payment_requests pr
       JOIN users u ON pr.instructor_id = u.id
       JOIN timesheets t ON pr.timesheet_id = t.id
       LEFT JOIN instructor_pay_rates ipr ON ipr.instructor_id = pr.instructor_id
         AND ipr.is_active = true AND ipr.effective_date <= t.week_start_date
       LEFT JOIN pay_rate_tiers prt ON ipr.tier_id = prt.id
       WHERE pr.status = 'returned_to_hr'
       ORDER BY pr.updated_at DESC
       LIMIT ? OFFSET ?`,
      [safeLimit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM payment_requests WHERE status = 'returned_to_hr'`
    );

    return {
      requests: rows,
      pagination: { page: options.page, limit: safeLimit, total: Number(countRows[0]?.total ?? 0), pages: Math.ceil(Number(countRows[0]?.total ?? 0) / safeLimit) },
    };
  }

  async processReturnedPaymentRequest(requestId: number, action: 'override_approve' | 'final_reject', notes: string) {
    if (!notes?.trim()) throw new HRError('Notes are required when processing returned payment request');

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [requestRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM payment_requests WHERE id = ? AND status = 'returned_to_hr'`,
        [requestId]
      );

      if (requestRows.length === 0) {
        throw new HRError('Returned payment request not found or already processed', 404);
      }

      const newStatus = action === 'override_approve' ? 'approved' : 'rejected';
      const hrNotes = `HR Decision (${action === 'override_approve' ? 'Override' : 'Final Reject'}): ${notes}`;

      await conn.query(
        `UPDATE payment_requests SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newStatus, hrNotes, requestId]
      );

      if (action === 'override_approve') {
        await conn.query(
          `UPDATE payroll_payments SET status = 'completed', updated_at = CURRENT_TIMESTAMP
           WHERE id = (
             SELECT id FROM payroll_payments
             WHERE instructor_id = ? AND amount = ? AND status = 'pending'
             ORDER BY created_at DESC LIMIT 1
           )`,
          [requestRows[0].instructor_id, requestRows[0].amount]
        );
      }

      await conn.commit();
      return { message: `Payment request ${action === 'override_approve' ? 'approved by HR override' : 'finally rejected by HR'} successfully` };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // --- Profile change submission (by any user) ---

  async submitProfileChange(userId: number, userRole: string, data: { fieldName: string; newValue: string; changeType: string; targetUserId?: number }) {
    getSafeColumn(data.fieldName);

    if (!['instructor', 'organization'].includes(data.changeType)) {
      throw new HRError('change_type must be "instructor" or "organization"');
    }

    let targetUserId = userId;
    if (data.targetUserId && userRole === 'hr') {
      targetUserId = data.targetUserId;
    } else if (userRole === 'hr' && !data.targetUserId) {
      throw new HRError('HR users must specify target_user_id when submitting profile changes');
    }

    const existing = await this.profileChangeRepo.findPendingForField(targetUserId, data.fieldName);
    if (existing) {
      throw new HRError('A pending change request already exists for this field');
    }

    const id = await this.profileChangeRepo.create({
      user_id: targetUserId,
      change_type: data.changeType,
      field_name: data.fieldName,
      old_value: null,
      new_value: data.newValue,
      status: 'pending',
    } as Partial<ProfileChange>);

    const change = await this.profileChangeRepo.findById(id);
    return change!;
  }

  async getMyProfileChanges(userId: number): Promise<ProfileChange[]> {
    return this.profileChangeRepo.findByUserId(userId);
  }
}
