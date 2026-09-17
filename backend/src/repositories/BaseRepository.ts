import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../config/database.js';

/**
 * Base repository with optional org-scoping for multi-tenancy.
 *
 * Tables with an `organization_id` column should use `forOrg(orgId)` to
 * scope all queries. This is enforced at the service layer — org-bound
 * users always call forOrg(); sysadmin/admin can call without it.
 *
 * Usage:
 *   const courses = await courseRepo.forOrg(orgId).findAll();   // scoped
 *   const courses = await courseRepo.findAll();                  // unscoped (admin)
 */
export class BaseRepository<T> {
  private orgId: number | null = null;

  constructor(
    protected readonly table: string,
    private readonly orgColumn: string | null = 'organization_id',
    private readonly hasSoftDelete: boolean = true
  ) {}

  /** Returns a scoped copy — all queries filter by this org. */
  forOrg(orgId: number): this {
    const scoped = Object.create(this) as this;
    scoped.orgId = orgId;
    return scoped;
  }

  // --- Query helpers ---

  private get orgFilter(): string {
    if (this.orgId === null || this.orgColumn === null) return '';
    return `AND \`${this.orgColumn}\` = ?`;
  }

  private get orgParams(): unknown[] {
    if (this.orgId === null || this.orgColumn === null) return [];
    return [this.orgId];
  }

  private get softDeleteFilter(): string {
    return this.hasSoftDelete ? 'AND deleted_at IS NULL' : '';
  }

  // --- CRUD ---

  async findById(id: number): Promise<T | null> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT * FROM ${this.table} WHERE id = ? ${this.softDeleteFilter} ${this.orgFilter}`,
      [id, ...this.orgParams]
    );
    return (rows[0] as T) ?? null;
  }

  async findAll(options?: { limit?: number; offset?: number }): Promise<T[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT * FROM ${this.table} WHERE 1=1 ${this.softDeleteFilter} ${this.orgFilter} LIMIT ? OFFSET ?`,
      [...this.orgParams, limit, offset]
    );
    return rows as T[];
  }

  async create(data: Partial<T>): Promise<number> {
    // Auto-inject org_id if scoped and column exists
    const record = { ...data } as Record<string, unknown>;
    if (this.orgId !== null && this.orgColumn !== null && !(this.orgColumn in record)) {
      record[this.orgColumn] = this.orgId;
    }

    const keys = Object.keys(record);
    const values = Object.values(record);
    const placeholders = keys.map(() => '?').join(', ');
    const columns = keys.map((k) => `\`${k}\``).join(', ');

    const [result] = await getPool().query<ResultSetHeader>(
      `INSERT INTO ${this.table} (${columns}) VALUES (${placeholders})`,
      values
    );
    return result.insertId;
  }

  async update(id: number, data: Partial<T>): Promise<boolean> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');

    const [result] = await getPool().query<ResultSetHeader>(
      `UPDATE ${this.table} SET ${setClause} WHERE id = ? ${this.softDeleteFilter} ${this.orgFilter}`,
      [...values, id, ...this.orgParams]
    );
    return result.affectedRows > 0;
  }

  async softDelete(id: number): Promise<boolean> {
    const [result] = await getPool().query<ResultSetHeader>(
      `UPDATE ${this.table} SET deleted_at = NOW() WHERE id = ? ${this.softDeleteFilter} ${this.orgFilter}`,
      [id, ...this.orgParams]
    );
    return result.affectedRows > 0;
  }

  // --- Raw query escape hatch (not org-scoped — caller is responsible) ---

  async query<R = T>(sql: string, params?: unknown[]): Promise<R[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(sql, params);
    return rows as R[];
  }

  async execute(sql: string, params?: unknown[]): Promise<ResultSetHeader> {
    const [result] = await getPool().query<ResultSetHeader>(sql, params);
    return result;
  }
}
