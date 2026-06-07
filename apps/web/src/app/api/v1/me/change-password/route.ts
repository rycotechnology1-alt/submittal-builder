// Authenticated password change. Single atomic endpoint so the change and the
// flag-clear can't drift if the client crashes between two RPCs.
//
// Used by /change-password (forced) and could be reused for a future "settings
// → password" screen. better-auth's changePassword API verifies the current
// password before applying the new one, so this also protects against stolen
// session cookies.

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';
import { jsonError, parseJson } from '@/server/api';

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return jsonError(401, 'unauthorized', 'Sign in required');
  }

  const parsed = await parseJson(req, Body);
  if (parsed instanceof Response) return parsed;

  if (parsed.currentPassword === parsed.newPassword) {
    return jsonError(
      422,
      'password_unchanged',
      'New password must differ from the current password',
    );
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.currentPassword,
        newPassword: parsed.newPassword,
        revokeOtherSessions: true,
      },
      headers: req.headers,
    });
  } catch (err) {
    // better-auth throws an APIError with status on bad current-password etc.
    const message = err instanceof Error ? err.message : 'Password change failed';
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? ((err as { status: number }).status as number)
        : 400;
    return jsonError(status, 'change_password_failed', message);
  }

  await db
    .update(schema.users)
    .set({ requirePasswordChange: false, updatedAt: new Date() })
    .where(eq(schema.users.id, session.user.id));

  // Refresh the better-auth session-cookie cache. The cookie embeds the
  // session-attached user including our `requirePasswordChange` additionalField
  // and caches it for 5 minutes (see server/auth.ts → session.cookieCache).
  // Without a refresh, every subsequent request continues to see a stale
  // `requirePasswordChange=true` and the dashboard layout would bounce the
  // user right back here. Calling getSession with `disableCookieCache=true`
  // forces a DB read and re-signs the cookie; we forward the Set-Cookie
  // header onto our response. Failures are non-fatal — fix #1 (the dashboard
  // layout reading the DB) guarantees correctness even if this no-ops.
  const setCookies: string[] = [];
  try {
    const refreshed = (await auth.api.getSession({
      headers: req.headers,
      query: { disableCookieCache: true },
      asResponse: true,
    })) as Response;
    setCookies.push(...(refreshed.headers.getSetCookie?.() ?? []));
  } catch (err) {
    console.error('change-password: cookie cache refresh failed (non-fatal)', err);
  }

  const res = NextResponse.json({ ok: true });
  for (const cookie of setCookies) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}
