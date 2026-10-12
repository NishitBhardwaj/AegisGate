import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envPath = fileURLToPath(
  new URL('../../.env', import.meta.url)
);

loadDotEnv({ path: envPath, quiet: true });

const envSchema = z.object({
  PORT: z.coerce.number()
    .int()
    .min(1)
    .max(65535)
    .default(8080),

  HOST: z.string().min(1).default('127.0.0.1'),

  CATALOG_UPSTREAM: z.url().default(
    'http://127.0.0.1:3001'
  ),

  ORDERS_UPSTREAM: z.url().default(
    'http://127.0.0.1:8000'
  ),

  DATABASE_URL: z.url().refine(
    (value) =>
      value.startsWith('postgresql://') ||
      value.startsWith('postgres://'),
    { message: 'Expected a PostgreSQL connection URL' }
  )
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.issues
    .map((issue) => issue.path.join('.'))
    .join(', ');

  throw new Error(
    `Invalid or missing AegisGate configuration: ${fields}`
  );
}

export const env = parsed.data;
