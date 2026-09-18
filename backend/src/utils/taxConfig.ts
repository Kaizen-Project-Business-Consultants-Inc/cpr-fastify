/**
 * Tax configuration.
 * Primary source: system_config table in the database.
 * Fallback: HST_RATE env var, then default 13% (Ontario HST).
 *
 * Call initTaxConfig() once at startup (after DB is ready) to load from DB.
 * All consumers use getHSTRate() / getHSTLabel() which always reflect the
 * current DB value.
 */
import { env } from '../config/env.js';
import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';
import type { RowDataPacket } from 'mysql2/promise';

let _rate: number = env.HST_RATE ?? 0.13;

export function getHSTRate(): number {
  return _rate;
}

export function getHSTLabel(): string {
  const pct = _rate * 100;
  return `HST (${pct % 1 === 0 ? pct.toFixed(0) : pct}%)`;
}

/** Load tax rate from system_config table. Call once at startup after DB pool is ready. */
export async function initTaxConfig(): Promise<void> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT config_value FROM system_config WHERE config_key = 'tax_rate'`
    );
    if (rows.length > 0) {
      const dbRate = parseFloat(rows[0].config_value);
      if (!isNaN(dbRate) && dbRate >= 0 && dbRate <= 1) {
        _rate = dbRate;
        logger.info({ taxRate: _rate, source: 'database' }, 'Tax rate loaded from system_config');
        return;
      }
    }
  } catch {
    // system_config table may not exist yet (pre-migration). Fall through to default.
  }
  logger.info({ taxRate: _rate, source: 'env/default' }, 'Tax rate using env/default');
}
