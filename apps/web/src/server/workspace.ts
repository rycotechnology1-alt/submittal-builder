// Tenancy helper. Every authed request resolves `workspace_id` from the
// session-attached user; route handlers receive a context bundle and never
// touch the session directly.
//
// Per step-5 §Conventions: cross-workspace IDs in URL/body must return 404,
// never 403 — use `notFound()` at the call site to keep that intent visible.
//
// The handler signature takes a `Headers` object explicitly (rather than
// calling `next/headers` internally) so the function is unit-testable
// outside a live Next.js request context.

import { eq } from 'drizzle-orm';
import { headers as nextHeaders } from 'next/headers';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  email: string;
  name: string;
};

type Handler<T> = (ctx: WorkspaceContext) => Promise<T>;

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function withWorkspaceFromHeaders<T>(
  headers: Headers,
  handler: Handler<T>,
): Promise<T | Response> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    return jsonError(401, 'unauthorized', 'Sign in required');
  }

  const [row] = await db
    .select({
      workspaceId: schema.users.workspaceId,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);

  if (!row) {
    return jsonError(401, 'unauthorized', 'Session user not found');
  }

  return handler({
    userId: session.user.id,
    workspaceId: row.workspaceId,
    email: row.email,
    name: row.name,
  });
}

/** Convenience wrapper for App Router route handlers. */
export async function withWorkspace<T>(handler: Handler<T>): Promise<T | Response> {
  const h = await nextHeaders();
  return withWorkspaceFromHeaders(h, handler);
}

/** Build a 404 in the contract envelope — for cross-workspace ID mismatches. */
export function notFound(message = 'Not found'): Response {
  return jsonError(404, 'not_found', message);
}
