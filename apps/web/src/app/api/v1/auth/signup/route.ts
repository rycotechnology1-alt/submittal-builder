// Custom signup wrapper. Step-5 §1 says signup atomically creates the
// workspace + first user. better-auth's built-in signup only knows about the
// user table, so we:
//
//   1. validate the request body (Zod, mirrors step-5)
//   2. insert the workspace row
//   3. call better-auth.api.signUpEmail with the new workspaceId as an
//      additionalField, which creates the user + accounts(credential) rows
//      and triggers our Resend verification email hook
//   4. on any failure after step 2 we roll back the workspace row
//
// Note: better-auth uses its own connection so we cannot share a SQL
// transaction across steps 2–3. The compensating delete is the rollback.

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  workspace_name: z.string().min(1),
  sub_company_name: z.string().min(1),
});

function err(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof SignupBody>;
  try {
    const json = await req.json();
    const r = SignupBody.safeParse(json);
    if (!r.success) {
      return err(422, 'validation_failed', 'Invalid signup payload', r.error.flatten());
    }
    parsed = r.data;
  } catch {
    return err(400, 'bad_request', 'Body must be valid JSON');
  }

  const { email, password, name, workspace_name, sub_company_name } = parsed;

  // Reject duplicate signups up front for a cleaner error envelope; better-auth
  // would otherwise surface a generic conflict.
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) {
    return err(409, 'email_in_use', 'An account with that email already exists');
  }

  // Step 2: workspace.
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: workspace_name, subCompanyName: sub_company_name })
    .returning({ id: schema.workspaces.id });
  if (!ws) return err(500, 'workspace_create_failed', 'Could not create workspace');

  // Step 3: better-auth signup. `workspaceId` flows in as an additionalField.
  try {
    const response = await auth.api.signUpEmail({
      body: {
        email: email.toLowerCase(),
        password,
        name,
        // additionalFields:
        workspaceId: ws.id,
      } as never, // additionalFields aren't reflected in the static type
      asResponse: true,
      headers: req.headers,
    });

    if (!response.ok) {
      // Rollback the workspace if better-auth rejected the user.
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
      const text = await response.text();
      return err(response.status, 'signup_failed', 'Signup failed', text);
    }

    // Forward better-auth's body and Set-Cookie headers. The user is NOT
    // signed in yet — `requireEmailVerification: true` blocks auto-sign-in
    // until they click the link in the Resend email.
    return new NextResponse(response.body, {
      status: 200,
      headers: response.headers,
    });
  } catch (e) {
    // Compensating delete on any thrown error.
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
    const message = e instanceof Error ? e.message : 'Unknown error';
    return err(500, 'signup_error', message);
  }
}
