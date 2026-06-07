// Super-admin guard for /api/v1/admin/* routes and the (admin) route group.
// Modeled on server/workspace.ts. Two-source admin check:
//
//   1. users.role === 'admin' (durable, the source of truth)
//   2. email matches ADMIN_EMAILS env allowlist (bootstrap; self-heals to 1.)
//
// Non-admins get 404 (not 403) so the admin surface is unenumerable — same
// convention as the existing cross-workspace 404 in workspace.ts.

import { eq } from 'drizzle-orm';
import { headers as nextHeaders } from 'next/headers';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';
import { adminEmails } from '@/env';

export type AdminContext = {
  userId: string;
  email: string;
  name: string;
};

type Handler<T> = (ctx: AdminContext) => Promise<T>;

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Pure predicate so the layout and the API gate stay in lockstep. */
export function isAdmin(row: { email: string; role: string }): boolean {
  if (row.role === 'admin') return true;
  return adminEmails.has(row.email.toLowerCase());
}

export async function withAdminFromHeaders<T>(
  headers: Headers,
  handler: Handler<T>,
): Promise<T | Response> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    return jsonError(401, 'unauthorized', 'Sign in required');
  }

  const [row] = await db
    .select({
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!row) {
    return jsonError(401, 'unauthorized', 'Session user not found');
  }

  if (!isAdmin(row)) {
    return jsonError(404, 'not_found', 'Not found');
  }

  // Self-heal: durable role row should match the allowlist verdict so the
  // dashboard top-nav and other UI surfaces don't need to read the env on
  // every render.
  if (row.role !== 'admin') {
    await db
      .update(schema.users)
      .set({ role: 'admin' })
      .where(eq(schema.users.id, session.user.id));
  }

  return handler({
    userId: session.user.id,
    email: row.email,
    name: row.name,
  });
}

/** App Router convenience wrapper. */
export async function withAdmin<T>(handler: Handler<T>): Promise<T | Response> {
  const h = await nextHeaders();
  return withAdminFromHeaders(h, handler);
}
