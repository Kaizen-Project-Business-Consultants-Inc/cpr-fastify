import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import type { PoolConnection } from 'mysql2/promise';

/** Who made a change, for services that write their own audit entry inside a transaction. */
export interface AuditActor {
  userId: number;
  ipAddress?: string;
}

export interface AuditLogParams {
  userId?: number;
  username?: string;
  action: string;
  entityType?: string;
  entityId?: number;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Fire-and-forget audit log entry. Failures are logged but never thrown.
 */
export function logAudit(params: AuditLogParams): void {
  const pool = getPool();
  pool.query(
    `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId ?? null,
      params.username ?? null,
      params.action,
      params.entityType ?? null,
      params.entityId ?? null,
      params.details ? JSON.stringify(params.details) : null,
      params.ipAddress ?? null,
    ]
  ).catch((err) => {
    logger.warn({ err, action: params.action }, 'Failed to write audit log');
  });
}

/**
 * Transaction-aware audit write. `logAudit` is deliberately fire-and-forget on
 * the pool, which would leave an audit row behind after a rollback; inside a
 * transaction we write through the same connection so the audit trail commits
 * or rolls back with the change it describes.
 */
export async function writeAudit(conn: PoolConnection, entry: AuditLogParams): Promise<void> {
  await conn.query(
    `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.userId ?? null,
      entry.username ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ipAddress ?? null,
    ]
  );
}
