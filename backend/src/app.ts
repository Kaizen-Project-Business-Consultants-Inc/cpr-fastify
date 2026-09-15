import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { getPool } from './config/database.js';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './plugins/errorHandler.js';
import { registerMetrics } from './plugins/metrics.js';

export async function buildApp() {
  const app = Fastify({
    logger: false, // We use our own pino logger
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  // Plugins
  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", env.FRONTEND_URL],
      },
    } : false,
  });
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // CSRF defense-in-depth: verify Origin header on state-changing requests
  app.addHook('onRequest', (request, reply, done) => {
    const method = request.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const origin = request.headers.origin;
      // Allow requests with no Origin header (non-browser clients, same-origin navigations)
      if (origin && origin !== env.FRONTEND_URL) {
        logger.warn({ origin, url: request.url, method }, 'CSRF: rejected cross-origin state-changing request');
        return reply.status(403).send({ error: 'Cross-origin request blocked' });
      }
    }
    done();
  });

  // Return request ID in response headers for client-side tracing
  app.addHook('onSend', (request, reply, _payload, done) => {
    reply.header('x-request-id', request.id);
    done();
  });

  // HTTP access logging with correlation ID
  app.addHook('onResponse', (request, reply, done) => {
    const duration = reply.elapsedTime;
    const logData = {
      reqId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: Math.round(duration),
      userId: (request as any).userId || undefined,
    };
    if (reply.statusCode >= 400) {
      logger.warn(logData, 'HTTP request');
    } else {
      logger.info(logData, 'HTTP request');
    }
    done();
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Performance metrics collection + /metrics endpoint
  registerMetrics(app);

  // Routes (includes OpenAPI docs at /api/v1/docs)
  await app.register(registerRoutes, { prefix: '/api/v1' });

  // Health check (outside /api/v1) — verifies DB connectivity
  app.get('/health', async (_request, reply) => {
    let dbStatus = 'UP';
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
    } catch {
      dbStatus = 'DOWN';
    }
    const status = dbStatus === 'UP' ? 'UP' : 'DEGRADED';
    const httpStatus = dbStatus === 'UP' ? 200 : 503;
    return reply.status(httpStatus).send({ status, database: dbStatus, timestamp: new Date().toISOString() });
  });

  // Serve frontend static files from ../public
  const publicDir = resolve(process.cwd(), '../public');
  const indexPath = resolve(publicDir, 'index.html');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      decorateReply: false,
    });
  }

  // SPA fallback: serve index.html for non-API routes (frontend routing)
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, 'utf-8');
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      reply.type('text/html').send(indexHtml);
    });
  }

  return app;
}
