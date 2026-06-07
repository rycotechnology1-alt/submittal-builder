// Integration tests for the super-admin gate + admin/users API routes.
// Hits the real Neon dev branch (no mocks). Same pattern as
// auth.integration.test.ts: call route handlers directly with synthetic
// Requests and route headers through a small CookieJar.

import '@/env';
import { afterEach, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { POST as signupPOST } from '@/app/api/v1/auth/signup/route';
import {
  GET as adminUsersGET,
  POST as adminUsersPOST,
} from '@/app/api/v1/admin/users/route';
import { POST as resetPasswordPOST } from '@/app/api/v1/admin/users/[id]/reset-password/route';
import { POST as sendResetEmailPOST } from '@/app/api/v1/admin/users/[id]/send-reset-email/route';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';
import { withAdminFromHeaders } from '@/server/admin';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'admin-test-pass-1234';

function fakeReq(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

async function signupAndSignIn(opts: {
  email: string;
  password?: string;
  name: string;
  role?: 'user' | 'admin';
}): Promise<CookieJar> {
  const password = opts.password ?? PASSWORD;
  const res = await signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: opts.email,
        password,
        name: opts.name,
        workspace_name: `${opts.name}'s WS`,
        sub_company_name: `${opts.name} Sub`,
      }),
    }),
  );
  expect(res.status).toBe(200);

  await db
    .update(schema.users)
    .set({ emailVerified: true, role: opts.role ?? 'user' })
    .where(eq(schema.users.email, opts.email));

  const jar = new CookieJar();
  const signin = (await auth.api.signInEmail({
    body: { email: opts.email, password },
    asResponse: true,
  })) as Response;
  expect(signin.status).toBe(200);
  jar.ingest(signin);
  return jar;
}

describe('withAdminFromHeaders gate', () => {
  const emails: string[] = [];
  afterEach(async () => {
    while (emails.length > 0) {
      const e = emails.pop();
      if (e) await deleteUserByEmail(e);
    }
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await withAdminFromHeaders(new Headers(), async () => {
      throw new Error('handler should not run');
    });
    expect(res instanceof Response).toBe(true);
    expect((res as Response).status).toBe(401);
  });

  it('returns 404 when authed user is not admin and not in allowlist', async () => {
    const email = `vitest-noadmin-${randomUUID()}@example.test`;
    emails.push(email);
    const jar = await signupAndSignIn({ email, name: 'Plain User' });

    const res = await withAdminFromHeaders(
      new Headers({ cookie: jar.header() }),
      async () => {
        throw new Error('handler should not run');
      },
    );
    expect(res instanceof Response).toBe(true);
    expect((res as Response).status).toBe(404);
  });

  it('runs the handler when role is admin', async () => {
    const email = `vitest-admin-${randomUUID()}@example.test`;
    emails.push(email);
    const jar = await signupAndSignIn({ email, name: 'Admin User', role: 'admin' });

    const result = await withAdminFromHeaders(
      new Headers({ cookie: jar.header() }),
      async (ctx) => ({ ranAs: ctx.email }),
    );
    expect(result instanceof Response).toBe(false);
    expect((result as { ranAs: string }).ranAs).toBe(email);
  });
});

describe('POST /api/v1/admin/users (create user + workspace)', () => {
  const emails: string[] = [];
  afterEach(async () => {
    while (emails.length > 0) {
      const e = emails.pop();
      if (e) await deleteUserByEmail(e);
    }
  });

  it('creates a workspace + user + returns temp password ONCE; no Set-Cookie forwarded', async () => {
    const adminEmail = `vitest-admin-${randomUUID()}@example.test`;
    emails.push(adminEmail);
    const adminJar = await signupAndSignIn({
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
    });

    const targetEmail = `vitest-created-${randomUUID()}@example.test`;
    emails.push(targetEmail);

    const res = await adminUsersPOST(
      fakeReq('/api/v1/admin/users', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminJar.header(),
        },
        body: JSON.stringify({
          email: targetEmail,
          name: 'Created User',
          workspace_name: 'Created WS',
          sub_company_name: 'Created Sub',
        }),
      }),
    );
    expect(res.status).toBe(201);

    // Critical: the admin must not have been signed in as the new user.
    // Our route returns NextResponse.json which adds a content-type header but
    // never forwards better-auth's Set-Cookie. Inspect the cookie list.
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const sessionCookies = setCookies.filter((c) => /session/i.test(c));
    expect(sessionCookies.length).toBe(0);

    const body = (await res.json()) as {
      user: { id: string; email: string };
      tempPassword: string;
    };
    expect(body.user.email).toBe(targetEmail);
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(8);

    // emailVerified=true and requirePasswordChange=true should be set.
    const [created] = await db
      .select({
        emailVerified: schema.users.emailVerified,
        requirePasswordChange: schema.users.requirePasswordChange,
      })
      .from(schema.users)
      .where(eq(schema.users.email, targetEmail))
      .limit(1);
    expect(created?.emailVerified).toBe(true);
    expect(created?.requirePasswordChange).toBe(true);

    // Audit row written.
    const [audit] = await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'user.create'),
          eq(schema.adminAuditLog.targetId, body.user.id),
        ),
      )
      .orderBy(desc(schema.adminAuditLog.createdAt))
      .limit(1);
    expect(audit?.action).toBe('user.create');
  });

  it('returns 409 on duplicate email', async () => {
    const adminEmail = `vitest-admin-${randomUUID()}@example.test`;
    emails.push(adminEmail);
    const adminJar = await signupAndSignIn({
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
    });

    const targetEmail = `vitest-dup-${randomUUID()}@example.test`;
    emails.push(targetEmail);

    const body = JSON.stringify({
      email: targetEmail,
      name: 'X',
      workspace_name: 'X',
      sub_company_name: 'X',
    });
    const headers = {
      'content-type': 'application/json',
      cookie: adminJar.header(),
    };

    const first = await adminUsersPOST(
      fakeReq('/api/v1/admin/users', { method: 'POST', headers, body }),
    );
    expect(first.status).toBe(201);

    const second = await adminUsersPOST(
      fakeReq('/api/v1/admin/users', { method: 'POST', headers, body }),
    );
    expect(second.status).toBe(409);
    const env = (await second.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('email_in_use');
  });

  it('returns 404 to non-admins', async () => {
    const userEmail = `vitest-user-${randomUUID()}@example.test`;
    emails.push(userEmail);
    const userJar = await signupAndSignIn({ email: userEmail, name: 'Plain' });

    const res = await adminUsersGET(
      fakeReq('/api/v1/admin/users', { headers: { cookie: userJar.header() } }),
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/users/[id]/reset-password', () => {
  const emails: string[] = [];
  afterEach(async () => {
    while (emails.length > 0) {
      const e = emails.pop();
      if (e) await deleteUserByEmail(e);
    }
  });

  it('sets a new temp password, flips requirePasswordChange, revokes sessions, audits', async () => {
    const adminEmail = `vitest-admin-${randomUUID()}@example.test`;
    emails.push(adminEmail);
    const adminJar = await signupAndSignIn({
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
    });

    const targetEmail = `vitest-reset-${randomUUID()}@example.test`;
    emails.push(targetEmail);
    const targetJar = await signupAndSignIn({ email: targetEmail, name: 'Target' });

    // Target now has a live session — count it.
    const [target] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, targetEmail))
      .limit(1);
    expect(target).toBeDefined();
    const sessionsBefore = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, target!.id));
    expect(sessionsBefore.length).toBeGreaterThan(0);
    void targetJar; // jar isn't reused, but we already have it from sign-in

    const res = await resetPasswordPOST(
      fakeReq(`/api/v1/admin/users/${target!.id}/reset-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminJar.header(),
        },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: target!.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tempPassword: string;
      sessionsRevoked: number;
    };
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(8);
    expect(body.sessionsRevoked).toBeGreaterThan(0);

    const [after] = await db
      .select({ requirePasswordChange: schema.users.requirePasswordChange })
      .from(schema.users)
      .where(eq(schema.users.id, target!.id))
      .limit(1);
    expect(after?.requirePasswordChange).toBe(true);

    const sessionsAfter = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, target!.id));
    expect(sessionsAfter.length).toBe(0);

    // The new temp password actually authenticates.
    const signin = (await auth.api.signInEmail({
      body: { email: targetEmail, password: body.tempPassword },
      asResponse: true,
    })) as Response;
    expect(signin.status).toBe(200);

    const [audit] = await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'user.reset_password'),
          eq(schema.adminAuditLog.targetId, target!.id),
        ),
      )
      .orderBy(desc(schema.adminAuditLog.createdAt))
      .limit(1);
    expect(audit?.action).toBe('user.reset_password');
  });
});

describe('POST /api/v1/admin/users/[id]/send-reset-email', () => {
  const emails: string[] = [];
  afterEach(async () => {
    while (emails.length > 0) {
      const e = emails.pop();
      if (e) await deleteUserByEmail(e);
    }
  });

  it('succeeds and writes audit row regardless of email service availability', async () => {
    const adminEmail = `vitest-admin-${randomUUID()}@example.test`;
    emails.push(adminEmail);
    const adminJar = await signupAndSignIn({
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
    });

    const targetEmail = `vitest-target-${randomUUID()}@example.test`;
    emails.push(targetEmail);
    await signupAndSignIn({ email: targetEmail, name: 'Target' });

    const [target] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, targetEmail))
      .limit(1);
    expect(target).toBeDefined();

    const res = await sendResetEmailPOST(
      fakeReq(`/api/v1/admin/users/${target!.id}/send-reset-email`, {
        method: 'POST',
        headers: { cookie: adminJar.header() },
      }),
      { params: Promise.resolve({ id: target!.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emailDelivery: string };
    expect(['sent', 'queued_no_email']).toContain(body.emailDelivery);

    const [audit] = await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'user.send_reset_email'),
          eq(schema.adminAuditLog.targetId, target!.id),
        ),
      )
      .orderBy(desc(schema.adminAuditLog.createdAt))
      .limit(1);
    expect(audit?.action).toBe('user.send_reset_email');
  });
});
