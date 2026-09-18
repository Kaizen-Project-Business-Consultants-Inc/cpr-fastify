/**
 * Portable, idempotent schema helpers for migrations.
 *
 * MySQL 8 does not support `ADD COLUMN IF NOT EXISTS` / `ADD INDEX IF NOT EXISTS`
 * (MariaDB does), so migrations check INFORMATION_SCHEMA first and only issue the
 * DDL when needed. Every helper is safe to re-run.
 */
import type { Pool, RowDataPacket } from 'mysql2/promise';

export async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

export async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

export async function indexExists(pool: Pool, table: string, index: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

export async function constraintExists(pool: Pool, table: string, constraint: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
    [table, constraint]
  );
  return rows.length > 0;
}

/** `definition` is everything after the column name, e.g. "INT DEFAULT NULL". */
export async function addColumnIfMissing(pool: Pool, table: string, column: string, definition: string): Promise<boolean> {
  if (await columnExists(pool, table, column)) return false;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  return true;
}

/**
 * Adds an index only when the table and every listed column exist.
 * `columns` may include a length/direction suffix, e.g. "email(191)".
 */
export async function addIndexIfMissing(
  pool: Pool,
  table: string,
  index: string,
  columns: string[],
  opts: { unique?: boolean } = {}
): Promise<boolean> {
  if (!(await tableExists(pool, table))) return false;
  if (await indexExists(pool, table, index)) return false;
  for (const c of columns) {
    const bare = c.replace(/\(.*\)$/, '').replace(/\s+(ASC|DESC)$/i, '').trim();
    if (!(await columnExists(pool, table, bare))) return false;
  }
  const cols = columns.map((c) => (c.includes('(') || /\s/.test(c) ? c : `\`${c}\``)).join(', ');
  await pool.query(`ALTER TABLE \`${table}\` ADD ${opts.unique ? 'UNIQUE ' : ''}INDEX \`${index}\` (${cols})`);
  return true;
}

export async function addForeignKeyIfMissing(
  pool: Pool,
  table: string,
  constraint: string,
  column: string,
  refTable: string,
  refColumn: string,
  onDelete = 'SET NULL'
): Promise<boolean> {
  if (await constraintExists(pool, table, constraint)) return false;
  if (!(await columnExists(pool, table, column)) || !(await tableExists(pool, refTable))) return false;
  await pool.query(
    `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` FOREIGN KEY (\`${column}\`)
     REFERENCES \`${refTable}\`(\`${refColumn}\`) ON DELETE ${onDelete}`
  );
  return true;
}
