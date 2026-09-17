import { FastifyInstance } from 'fastify';
import { getPool } from '../config/database.js';

export async function healthRoutes(app: FastifyInstance) {

  app.get('/', async () => {
    let dbStatus: 'UP' | 'DOWN';
    try {
      const conn = await getPool().getConnection();
      conn.release();
      dbStatus = 'UP';
    } catch {
      dbStatus = 'DOWN';
    }

    return {
      status: dbStatus === 'UP' ? 'UP' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      services: {
        database: { status: dbStatus, critical: true },
      },
    };
  });
}
