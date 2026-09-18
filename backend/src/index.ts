import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, closeDatabaseConnections, getPool } from './config/database.js';
import { runMigrations } from './config/migrations.js';
import { initTaxConfig } from './utils/taxConfig.js';
import { CertReminderService } from './services/CertReminderService.js';
import { RetentionService } from './services/RetentionService.js';

// Initialize Sentry (optional — gracefully skipped if package not installed)
if (env.SENTRY_DSN) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
    logger.info('Sentry initialized');
  } catch {
    logger.warn('Sentry DSN configured but @sentry/node not installed — skipping');
  }
}

const HOUR = 60 * 60 * 1000;

/** Run a job on a timer without holding the process open on shutdown. */
function schedule(name: string, fn: () => Promise<unknown>, intervalMs: number, initialDelayMs: number) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'Scheduled job failed');
    }
  };
  setTimeout(run, initialDelayMs).unref();
  setInterval(run, intervalMs).unref();
}

async function start() {
  await connectDatabase();
  await runMigrations();
  await initTaxConfig();

  // Daily certification-expiry reminders. Safe across Passenger workers: the service
  // takes a MySQL named lock and claims each reminder before sending.
  const certReminders = new CertReminderService();
  schedule('cert-reminders', () => certReminders.sendReminders(), 24 * HOUR, 60_000);

  // PIPEDA data retention: anonymise PII on accounts closed more than 2 years ago.
  // Dry run (logs only) unless RETENTION_ENFORCE=true. First run 15 minutes after
  // startup so it never competes with boot; the service takes a named lock.
  const retention = new RetentionService();
  schedule('data-retention', () => retention.run(), 24 * HOUR, 15 * 60_000);

  // Housekeeping: login_attempts only matter for the 15-minute lockout window.
  schedule(
    'login-attempts-cleanup',
    () => getPool().query('DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL 1 HOUR'),
    HOUR,
    5 * 60_000
  );

  // Expired / revoked refresh tokens can be pruned after their lifetime.
  schedule(
    'refresh-tokens-cleanup',
    () => getPool().query('DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL 7 DAY'),
    6 * HOUR,
    10 * 60_000
  );

  const app = await buildApp();
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`Server listening on ${address}`);

  // Graceful shutdown with timeout
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);

    // Force exit after 10 seconds if graceful shutdown hangs
    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    try {
      await app.close();
      await closeDatabaseConnections();
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
}

start().catch((err) => {
  logger.fatal(err, 'Failed to start server');
  process.exit(1);
});
