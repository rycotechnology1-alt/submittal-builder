// Catch-all handler for better-auth's built-in endpoints under
// /api/v1/auth/*  (sign-in, sign-out, callback, verify-email, etc.).
//
// /api/v1/auth/signup is intentionally NOT routed here — see
// app/api/v1/auth/signup/route.ts. Next.js prefers the more specific route.
//
// SECURITY: better-auth's built-in `POST /sign-up/email` endpoint accepts a
// `workspaceId` field directly from the request body (because our schema
// declares it as an `input: true` additionalField on the user model). Without
// this guard a caller could land a brand-new user into ANY existing workspace
// they can guess the UUID for — a tenant-takeover. We can't use better-auth's
// `disableSignUp` config to close this hole because that flag is checked
// inside the same handler that our custom `/auth/signup` wrapper invokes via
// `auth.api.signUpEmail`. Block the HTTP path here instead; server-internal
// calls bypass this route entirely.

import { NextResponse } from 'next/server';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';

const BLOCKED_PATHS = new Set<string>(['/api/v1/auth/sign-up/email']);

function notFound(): Response {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'Not Found' } },
    { status: 404 },
  );
}

function isBlocked(request: Request): boolean {
  try {
    const { pathname } = new URL(request.url);
    return BLOCKED_PATHS.has(pathname);
  } catch {
    return false;
  }
}

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth);

export async function GET(request: Request): Promise<Response> {
  if (isBlocked(request)) return notFound();
  return betterAuthGET(request);
}

export async function POST(request: Request): Promise<Response> {
  if (isBlocked(request)) return notFound();
  return betterAuthPOST(request);
}
