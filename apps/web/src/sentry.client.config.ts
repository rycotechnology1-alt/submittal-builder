// Client-side Sentry — loaded automatically by @sentry/nextjs when the
// browser bundle hydrates. Phase 1 does not yet ship interactive UI; this
// file exists so the SDK has a configured entry point.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_WEB ?? process.env.SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: 0.1,
  });
}
