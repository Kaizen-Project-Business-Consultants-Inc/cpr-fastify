import { BaseRepository } from './BaseRepository.js';

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  full_name: string;
  first_name: string;
  last_name: string;
  role: string;
  organization_id: number | null;
  status: string;
  phone: string | null;
  mobile: string | null;
  created_at: Date;
  updated_at: Date;
}

// Users table has no deleted_at — uses status column instead
export class UserRepository extends BaseRepository<User> {
  constructor() {
    super('users', 'organization_id', false);
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await this.query<User>(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return rows[0] ?? null;
  }

  async updatePassword(id: number, passwordHash: string): Promise<boolean> {
    return this.update(id, { password_hash: passwordHash } as Partial<User>);
  }
}
