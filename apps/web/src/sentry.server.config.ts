// Server-side Sentry config. Loaded by instrumentation.ts under the Node
// runtime. DSN is optional — Phase 1 ships the wiring; if SENTRY_DSN_WEB
// isn't set we just no-op (Sentry SDK does nothing without a DSN).

// Loads the repo-root .env.local — apps/web's env.ts does the same on its
// first import. Sentry initializes via instrumentation.ts before any route
// runs, so we need the env loaded here too.
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/nextjs';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname_, '..', '..', '..');
loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });

const dsn = process.env.SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    debug: process.env.NODE_ENV !== 'production',
  });
  console.log(`[sentry.server] initialized — env=${process.env.SENTRY_ENVIRONMENT ?? 'development'}, host=${new URL(dsn).host}`);
} else {
  console.log('[sentry.server] SENTRY_DSN_WEB not set, Sentry disabled');
}
