import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * The process refuses to boot with a broken configuration. A server that starts
 * without a database URL only fails later, on a request, where the cause is
 * harder to see.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Comma-separated list of origins allowed to call the API with credentials. */
  CORS_ORIGINS: z.string().default('http://localhost:5175'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detalhe = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration -> ${detalhe}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0),
} as const;

export type Env = typeof env;
