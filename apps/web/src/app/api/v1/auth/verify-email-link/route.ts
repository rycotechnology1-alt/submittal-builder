import { toNextJsHandler } from 'better-auth/next-js';
import { NextResponse } from 'next/server';

import { auth } from '@/server/auth';
import { buildEmailVerificationProxyUrl } from '@/server/auth-verification-links';

const { GET: betterAuthGET } = toNextJsHandler(auth);

export function GET(request: Request): Promise<Response> | Response {
  const proxyUrl = buildEmailVerificationProxyUrl(request.url);
  if (!proxyUrl) {
    return NextResponse.json(
      { message: '[query.t] Invalid input', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  return betterAuthGET(
    new Request(proxyUrl, {
      method: 'GET',
      headers: request.headers,
    }),
  );
}
