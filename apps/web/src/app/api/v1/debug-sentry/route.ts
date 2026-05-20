// Temporary endpoint used during Phase 1 verification to confirm Sentry is
// wired. Calls captureException directly + flushes, then throws so Next.js's
// onRequestError also gets a chance. Remove once verified.

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: { code: 'disabled_in_prod', message: 'Debug endpoint disabled' } },
      { status: 404 },
    );
  }
  const err = new Error('Sentry smoke-test: deliberate throw from /api/v1/debug-sentry');
  const eventId = Sentry.captureException(err);
  console.log(`[debug-sentry] captured exception, eventId=${eventId}`);
  await Sentry.flush(5_000);
  console.log('[debug-sentry] flushed');
  throw err;
}
