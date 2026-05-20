import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`worker: missing required env var ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  databaseUrlDirect: required(
    process.env.DATABASE_URL_DIRECT_DEV
      ? 'DATABASE_URL_DIRECT_DEV'
      : 'DATABASE_URL_DIRECT',
  ),
  healthzPort: Number.parseInt(process.env.WORKER_HEALTHZ_PORT ?? '8080', 10),
  sentryDsn: process.env.SENTRY_DSN_WORKER ?? null,
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? 'development',
};
