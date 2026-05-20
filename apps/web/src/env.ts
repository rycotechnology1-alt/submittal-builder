// Centralized env access. Validated at import time so a missing var fails fast
// during boot rather than at first request.
//
// In dev we also load repo-root .env.local because Phase 0 put the env matrix
// at the repo root, not per-app. Next.js's built-in .env loading runs from the
// app dir, so the explicit load below is the bridge.

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

// Idempotent; later .env files do not override earlier ones.
loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // DB — pooled URL is preferred at runtime; fall back to direct in dev.
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_POOLED_DEV: z.string().url().optional(),
  DATABASE_URL_DIRECT_DEV: z.string().url().optional(),

  // better-auth
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  // Resend
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().optional(),

  // Sentry
  SENTRY_DSN_WEB: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

const e = parsed.data;

export const env = {
  ...e,
  // Effective DB URL: explicit DATABASE_URL > pooled-dev > direct-dev.
  // The web app uses pooled in prod; in dev we accept the direct URL too.
  databaseUrl:
    e.DATABASE_URL ?? e.DATABASE_URL_POOLED_DEV ?? e.DATABASE_URL_DIRECT_DEV ?? '',
};

if (!env.databaseUrl) {
  throw new Error(
    'Missing database URL — set DATABASE_URL or DATABASE_URL_POOLED_DEV in .env.local',
  );
}
