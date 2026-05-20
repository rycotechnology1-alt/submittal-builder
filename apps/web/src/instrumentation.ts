// Next.js 15 instrumentation hook — runs once per process on boot.
// Lazy-imports the runtime-specific Sentry config so the edge bundle does
// not pull in Node-only Sentry code.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures unhandled errors from server components, route handlers, etc.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
}
