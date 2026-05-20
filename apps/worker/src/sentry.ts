// Initialize Sentry for the Node worker. No-ops if SENTRY_DSN_WORKER is unset.

import * as Sentry from '@sentry/node';
import { env } from './env.js';

let initialized = false;

export function initSentry(): void {
  if (initialized || !env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  initialized = true;
}

export { Sentry };
