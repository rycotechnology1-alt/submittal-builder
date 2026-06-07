// Admin user-management list + create.
//
// GET   /api/v1/admin/users          → search-and-paginate user list
// POST  /api/v1/admin/users          → create user + workspace + temp password
//
// Both routes are gated by withAdmin. Writes record one row in admin_audit_log.
// Create reuses the compensating-delete pattern from the public signup route
// (better-auth opens its own connection so a single SQL tx isn't possible).
//
// IMPORTANT: this route DELIBERATELY discards better-auth's Set-Cookie headers
// after signUpEmail. An admin must not be signed in as the user they create.

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAdminFromHeaders } from '@/server/admin';
import { logAdminAction } from '@/server/audit';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';
import { jsonError, parseJson } from '@/server/api';
import { generateTempPassword } from '@/server/temp-password';
import { listAdminUsers, type AdminUserListResult } from '@/server/admin-users';

// ---- GET --------------------------------------------------------------------

export type AdminUserListResponse = AdminUserListResult;

export async function GET(req: Request): Promise<Response> {
  return withAdminFromHeaders(req.headers, async () => {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const body = await listAdminUsers({
      q: url.searchParams.get('q') ?? undefined,
      cursor: url.searchParams.get('cursor'),
      limit: limitParam ? Number(limitParam) : undefined,
    });
    return NextResponse.json(body);
  });
}

// ---- POST -------------------------------------------------------------------

const CreateBody = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
  workspace_name: z.string().trim().min(1),
  sub_company_name: z.string().trim().min(1),
  // Optional — server generates when omitted.
  password: z.string().min(8).optional(),
});

export type AdminCreateUserResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    workspaceId: string;
  };
  tempPassword: string;
};

export async function POST(req: Request): Promise<Response> {
  return withAdminFromHeaders(req.headers, async (ctx) => {
    const parsed = await parseJson(req, CreateBody);
    if (parsed instanceof Response) return parsed;
    const { email, name, workspace_name, sub_company_name } = parsed;
    const normalizedEmail = email.toLowerCase();
    const tempPassword = parsed.password ?? generateTempPassword();

    // Up-front duplicate guard — mirrors the public signup route.
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail))
      .limit(1);
    if (existing.length > 0) {
      return jsonError(409, 'email_in_use', 'An account with that email already exists');
    }

    // 1. Workspace.
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: workspace_name, subCompanyName: sub_company_name })
      .returning({ id: schema.workspaces.id });
    if (!ws) {
      return jsonError(500, 'workspace_create_failed', 'Could not create workspace');
    }

    try {
      // 2. better-auth signup. We pass the new workspaceId as an additionalField
      //    — same call path as the public signup route.
      const response = await auth.api.signUpEmail({
        body: {
          email: normalizedEmail,
          password: tempPassword,
          name,
          workspaceId: ws.id,
        } as never,
        asResponse: true,
        headers: req.headers,
      });

      if (!response.ok) {
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
        const text = await response.text();
        return jsonError(response.status, 'signup_failed', 'Could not create user', text);
      }

      // 3. Look up the created user to get the id.
      const [created] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, normalizedEmail))
        .limit(1);
      if (!created) {
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
        return jsonError(500, 'user_lookup_failed', 'User vanished after signup');
      }

      // 4. Admin-created accounts skip email verification entirely and are
      //    forced to change the password on first sign-in.
      await db
        .update(schema.users)
        .set({ emailVerified: true, requirePasswordChange: true })
        .where(eq(schema.users.id, created.id));

      // 5. Audit. Never store the temp password.
      await logAdminAction({
        actorUserId: ctx.userId,
        action: 'user.create',
        targetType: 'user',
        targetId: created.id,
        metadata: { email: normalizedEmail, workspaceId: ws.id },
      });

      // 6. Critical: do NOT forward better-auth's Set-Cookie headers. The
      //    admin must not be signed in as the new user.
      const body: AdminCreateUserResponse = {
        user: { id: created.id, email: normalizedEmail, name, workspaceId: ws.id },
        tempPassword,
      };
      return NextResponse.json(body, { status: 201 });
    } catch (e) {
      // Compensating delete — only roll back the workspace if better-auth
      // failed before linking the user. If a user row exists, the cascade
      // from workspace delete still cleans it up.
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
      const message = e instanceof Error ? e.message : 'Unknown error';
      return jsonError(500, 'create_user_error', message);
    }
  });
}
