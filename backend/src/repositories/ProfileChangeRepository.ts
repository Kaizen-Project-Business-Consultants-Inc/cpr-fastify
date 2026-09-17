import { BaseRepository } from './BaseRepository.js';

export interface ProfileChange {
  id: number;
  user_id: number;
  change_type: string;
  field_name: string;
  old_value: string | null;
  new_value: string;
  status: string;
  hr_comment: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProfileChangeWithUser extends ProfileChange {
  username: string;
  email: string;
  role: string;
  organization_name: string | null;
}

export class ProfileChangeRepository extends BaseRepository<ProfileChange> {
  constructor() {
    super('profile_changes', null, false);
  }

  async findPendingWithUsers(options: { limit: number; offset: number }): Promise<{ rows: ProfileChangeWithUser[]; total: number }> {
    const rows = await this.query<ProfileChangeWithUser>(
      `SELECT pc.*, u.username, u.email, u.role, o.name as organization_name
       FROM profile_changes pc
       JOIN users u ON pc.user_id = u.id
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE pc.status = 'pending'
       ORDER BY pc.created_at ASC
       LIMIT ? OFFSET ?`,
      [options.limit, options.offset]
    );

    const [{ total }] = await this.query<{ total: number }>(
      `SELECT COUNT(*) as total FROM profile_changes WHERE status = 'pending'`
    );

    return { rows, total };
  }

  async findByUserId(userId: number): Promise<ProfileChange[]> {
    return this.query<ProfileChange>(
      `SELECT id, change_type, field_name, old_value, new_value, status, hr_comment, created_at, updated_at
       FROM profile_changes WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }

  async findPendingForField(userId: number, fieldName: string): Promise<ProfileChange | null> {
    const rows = await this.query<ProfileChange>(
      `SELECT id FROM profile_changes WHERE user_id = ? AND field_name = ? AND status = 'pending'`,
      [userId, fieldName]
    );
    return rows[0] ?? null;
  }

  async findRecentWithUsers(limit: number): Promise<ProfileChangeWithUser[]> {
    return this.query<ProfileChangeWithUser>(
      `SELECT pc.*, u.username, u.email, u.role
       FROM profile_changes pc
       JOIN users u ON pc.user_id = u.id
       ORDER BY pc.created_at DESC
       LIMIT ?`,
      [limit]
    );
  }

  async findAllPendingWithUsers(): Promise<ProfileChangeWithUser[]> {
    return this.query<ProfileChangeWithUser>(
      `SELECT pc.*, u.username, u.email, u.role
       FROM profile_changes pc
       JOIN users u ON pc.user_id = u.id
       WHERE pc.status = 'pending'
       ORDER BY pc.created_at ASC`
    );
  }

}
