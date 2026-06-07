// Shared list-query logic used by both the admin users API GET handler and the
// server-rendered admin users page. Keeping it in one place stops the cursor
// encoding from drifting between the two surfaces.

import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';

import { db, schema } from '@/server/db';

export type AdminUserListItem = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  workspace: { id: string; name: string };
  emailVerified: boolean;
  requirePasswordChange: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

export type AdminUserListResult = {
  users: AdminUserListItem[];
  nextCursor: string | null;
};

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

type CursorPayload = { createdAt: string; id: string };

export function encodeCursor(c: CursorPayload): string {
  return Buffer.from(`${c.createdAt}|${c.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const [createdAt, id] = decoded.split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function listAdminUsers(opts: {
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AdminUserListResult> {
  const q = opts.q?.trim() ?? '';
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = decodeCursor(opts.cursor ?? null);

  const conditions = [];
  if (q.length > 0) {
    const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const cond = or(
      ilike(schema.users.email, pattern),
      ilike(schema.users.name, pattern),
    );
    if (cond) conditions.push(cond);
  }
  if (cursor) {
    conditions.push(
      or(
        lt(schema.users.createdAt, new Date(cursor.createdAt)),
        and(
          eq(schema.users.createdAt, new Date(cursor.createdAt)),
          lt(schema.users.id, cursor.id),
        ),
      )!,
    );
  }

  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      emailVerified: schema.users.emailVerified,
      requirePasswordChange: schema.users.requirePasswordChange,
      createdAt: schema.users.createdAt,
      lastSignInAt: schema.users.lastSignInAt,
      workspaceId: schema.workspaces.id,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.users)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.users.workspaceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.users.createdAt), desc(schema.users.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    users: items.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role as 'user' | 'admin',
      workspace: { id: r.workspaceId, name: r.workspaceName },
      emailVerified: r.emailVerified,
      requirePasswordChange: r.requirePasswordChange,
      createdAt: r.createdAt.toISOString(),
      lastSignInAt: r.lastSignInAt?.toISOString() ?? null,
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}
