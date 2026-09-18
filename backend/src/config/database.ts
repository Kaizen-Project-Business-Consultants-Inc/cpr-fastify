import mysql from 'mysql2/promise';
import { env } from './env.js';
import { logger } from './logger.js';

let pool: mysql.Pool;

// Passenger runs several worker processes, each with its own pool, against a shared
// MySQL with a modest max_connections. Keep the per-process pool small; override
// with DB_POOL_SIZE if the hosting changes.
const POOL_SIZE = Number(process.env.DB_POOL_SIZE) > 0 ? Number(process.env.DB_POOL_SIZE) : 6;

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: POOL_SIZE,
    queueLimit: 100,        // Cap queued requests (was 0 = unlimited)
    connectTimeout: 10000,  // 10s connection timeout
    enableKeepAlive: true,
    timezone: '+00:00',
  });
}

export async function connectDatabase() {
  pool = createPool();

  // Verify connection
  const conn = await pool.getConnection();
  logger.info({ poolSize: POOL_SIZE }, 'Database connected');
  conn.release();
}

/**
 * Create the pool WITHOUT verifying a connection. Only for tooling that needs to
 * build the app (e.g. generating the OpenAPI reference) with no database available.
 * Route modules call getPool() at registration time, so the pool object must exist.
 */
export function initPoolForTooling() {
  pool = createPool();
}

export async function closeDatabaseConnections() {
  if (pool) {
    await pool.end();
    logger.info('Database connections closed');
  }
}

export function getPool(): mysql.Pool {
  if (!pool) throw new Error('Database not initialized — call connectDatabase() first');
  return pool;
}
