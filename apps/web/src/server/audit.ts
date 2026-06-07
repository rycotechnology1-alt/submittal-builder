// Append-only audit log for super-admin actions. Every mutating /api/v1/admin
// route writes one row before returning. Never store secrets in metadata —
// log the *fact* of a password reset, not the password.

import { db, schema } from '@/server/db';

export type AdminAction = 'user.create' | 'user.reset_password' | 'user.send_reset_email';
export type AdminTargetType = 'user';

export async function logAdminAction(opts: {
  actorUserId: string;
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(schema.adminAuditLog).values({
    actorUserId: opts.actorUserId,
    action: opts.action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    metadata: opts.metadata ?? {},
  });
}
