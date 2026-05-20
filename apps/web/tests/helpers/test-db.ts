// Test fixture cleanup: deletes the workspace + cascades for an email.

import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/server/db';

export async function deleteUserByEmail(email: string): Promise<void> {
  const rows = await db
    .select({ workspaceId: schema.users.workspaceId })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (rows.length === 0) return;
  const workspaceIds = rows.map((r) => r.workspaceId);
  await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds));
}
