import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Database
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_EXPIRY: z.string().regex(/^\d+[smhd]$/, 'Must be like 15m, 1h, 7d').default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().regex(/^\d+[smhd]$/, 'Must be like 15m, 1h, 7d').default('7d'),

  // App
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  // Email (optional — disabled if not set)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@kpbc.ca'),

  // Inbound email -> course request (optional — the webhook route 503s if either is unset)
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Tax
  HST_RATE: z.coerce.number().min(0).max(1).optional(),

  // Sentry (optional — disabled if not set)
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
