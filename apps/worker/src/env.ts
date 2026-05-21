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
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  s3Bucket: process.env.S3_BUCKET ?? process.env.S3_BUCKET_DEV ?? process.env.S3_BUCKET_PROD ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicClassifyModel: process.env.ANTHROPIC_CLASSIFY_MODEL ?? 'claude-sonnet-4-6',
  anthropicExtractModel: process.env.ANTHROPIC_EXTRACT_MODEL ?? 'claude-sonnet-4-6',
  concurrency: {
    ocr: Number.parseInt(process.env.PGBOSS_CONCURRENCY_OCR ?? '4', 10),
    classify: Number.parseInt(process.env.PGBOSS_CONCURRENCY_CLASSIFY ?? '8', 10),
    extract: Number.parseInt(process.env.PGBOSS_CONCURRENCY_EXTRACT ?? '8', 10),
  },
};
