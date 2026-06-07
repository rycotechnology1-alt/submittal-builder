// Admin-triggered "send password reset email". Delegates to better-auth's
// built-in forgetPassword flow, which creates a verification row and calls
// our Resend-backed sendResetPassword hook in server/auth.ts.
//
// While RESEND_API_KEY is unset (e.g. on vercel.app pre-launch) the hook
// logs and returns ok:false; better-auth still returns 200 because the email
// failure is decoupled. We surface that to the admin via emailDelivery: 'sent'
// vs 'queued_no_email' so the UI can show "sent" vs "email service offline".

import { NextResponse } from 'next/server';

import { withAdminFromHeaders } from '@/server/admin';
import { logAdminAction } from '@/server/audit';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';
import { jsonError, type RouteContext, uuidParam } from '@/server/api';
import { emailEnabled } from '@/env';
import { eq } from 'drizzle-orm';

export type AdminSendResetEmailResponse = {
  emailDelivery: 'sent' | 'queued_no_email';
};

export async function POST(
  req: Request,
  context: RouteContext<{ id: string }>,
): Promise<Response> {
  return withAdminFromHeaders(req.headers, async (ctx) => {
    const userId = await uuidParam(context, 'id');
    if (userId instanceof Response) return userId;

    const [target] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!target) {
      return jsonError(404, 'not_found', 'Not found');
    }

    try {
      await auth.api.requestPasswordReset({
        body: { email: target.email },
        headers: req.headers,
      });
    } catch (err) {
      // requestPasswordReset should not throw on unknown emails (better-auth
      // treats it as success to avoid leaks). If it does throw, log and 500.
      console.error('admin send-reset-email: requestPasswordReset threw', err);
      return jsonError(500, 'send_reset_failed', 'Could not initiate password reset');
    }

    const delivery: AdminSendResetEmailResponse['emailDelivery'] = emailEnabled
      ? 'sent'
      : 'queued_no_email';

    await logAdminAction({
      actorUserId: ctx.userId,
      action: 'user.send_reset_email',
      targetType: 'user',
      targetId: userId,
      metadata: { email: target.email, delivery },
    });

    const body: AdminSendResetEmailResponse = { emailDelivery: delivery };
    return NextResponse.json(body);
  });
}
