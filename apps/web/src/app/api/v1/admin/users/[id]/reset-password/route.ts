// Admin-initiated password reset.
//
// Writes a new argon2id hash directly to the user's `credential` account row
// (the same column better-auth writes to internally), flips
// users.require_password_change=true, and revokes all active sessions for the
// user so any stale browser cookie loses access immediately.
//
// The new temp password is returned ONCE in the response body. It is never
// logged and never written to the audit row.

import { hash as argon2Hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAdminFromHeaders } from '@/server/admin';
import { logAdminAction } from '@/server/audit';
import { db, schema } from '@/server/db';
import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { generateTempPassword } from '@/server/temp-password';

const Body = z.object({
  password: z.string().min(8).optional(),
});

export type AdminResetPasswordResponse = {
  tempPassword: string;
  sessionsRevoked: number;
};

export async function POST(
  req: Request,
  context: RouteContext<{ id: string }>,
): Promise<Response> {
  return withAdminFromHeaders(req.headers, async (ctx) => {
    const userId = await uuidParam(context, 'id');
    if (userId instanceof Response) return userId;

    const parsed = await parseJson(req, Body);
    if (parsed instanceof Response) return parsed;

    // Confirm the user exists. 404 (not 403/401) per envelope convention.
    const [target] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!target) {
      return jsonError(404, 'not_found', 'Not found');
    }

    const tempPassword = parsed.password ?? generateTempPassword();
    const hashed = await argon2Hash(tempPassword, { algorithm: 2 /* argon2id */ });

    // Update the credential account row. better-auth stores the hash on
    // accounts.password where provider_id='credential'.
    const updated = await db
      .update(schema.accounts)
      .set({ password: hashed, updatedAt: new Date() })
      .where(
        and(
          eq(schema.accounts.userId, userId),
          eq(schema.accounts.providerId, 'credential'),
        ),
      )
      .returning({ id: schema.accounts.id });
    if (updated.length === 0) {
      return jsonError(
        409,
        'no_credential_account',
        'User has no password-based account to reset',
      );
    }

    await db
      .update(schema.users)
      .set({ requirePasswordChange: true, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));

    // Revoke all sessions for this user. Cookies on other devices become
    // unauthenticated on next request.
    const revoked = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .returning({ id: schema.sessions.id });

    await logAdminAction({
      actorUserId: ctx.userId,
      action: 'user.reset_password',
      targetType: 'user',
      targetId: userId,
      metadata: { email: target.email, sessionsRevoked: revoked.length },
    });

    const body: AdminResetPasswordResponse = {
      tempPassword,
      sessionsRevoked: revoked.length,
    };
    return NextResponse.json(body);
  });
}
