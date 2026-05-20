// Catch-all handler for better-auth's built-in endpoints under
// /api/v1/auth/*  (sign-in, sign-out, callback, verify-email, etc.).
//
// /api/v1/auth/signup is intentionally NOT routed here — see
// app/api/v1/auth/signup/route.ts. Next.js prefers the more specific route.

import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';

export const { GET, POST } = toNextJsHandler(auth);
