// End-to-end check for the bug where users stayed stuck on /change-password
// after a successful password change. The dashboard layout is a React server
// component (not a request handler) so we can't unit-test the redirect itself
// without spinning up Next. Instead this test pins the invariants the layout
// relies on:
//
//   1. POST /api/v1/me/change-password updates users.require_password_change
//      to false in the DB.
//   2. The response carries a refreshed session Set-Cookie so any subsequent
//      request reading session.user.requirePasswordChange sees false.
//   3. The new password actually authenticates.
//
// Pattern matches auth.integration.test.ts / admin.integration.test.ts.

import '@/env';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { POST as adminUsersPOST } from '@/app/api/v1/admin/users/route';
import { POST as changePasswordPOST } from '@/app/api/v1/me/change-password/route';
import { POST as signupPOST } from '@/app/api/v1/auth/signup/route';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const NEW_PASSWORD = 'brand-new-pass-9876';

function fakeReq(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

async function makeAdminAndSignIn(emails: string[]): Promise<CookieJar> {
  const adminEmail = `vitest-admin-${randomUUID()}@example.test`;
  emails.push(adminEmail);
  const signup = await signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: 'admin-pass-1234',
        name: 'Admin',
        workspace_name: 'Admin WS',
        sub_company_name: 'Admin Sub',
      }),
    }),
  );
  expect(signup.status).toBe(200);
  await db
    .update(schema.users)
    .set({ emailVerified: true, role: 'admin' })
    .where(eq(schema.users.email, adminEmail));
  const jar = new CookieJar();
  const signin = (await auth.api.signInEmail({
    body: { email: adminEmail, password: 'admin-pass-1234' },
    asResponse: true,
  })) as Response;
  expect(signin.status).toBe(200);
  jar.ingest(signin);
  return jar;
}

describe('POST /api/v1/me/change-password', () => {
  const emails: string[] = [];
  afterEach(async () => {
    while (emails.length > 0) {
      const e = emails.pop();
      if (e) await deleteUserByEmail(e);
    }
  });

  it('clears require_password_change, refreshes the session cookie, and the new password authenticates', async () => {
    // Admin creates a user — this gives us the temp password.
    const adminJar = await makeAdminAndSignIn(emails);
    const userEmail = `vitest-cp-${randomUUID()}@example.test`;
    emails.push(userEmail);

    const createRes = await adminUsersPOST(
      fakeReq('/api/v1/admin/users', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminJar.header(),
        },
        body: JSON.stringify({
          email: userEmail,
          name: 'Temp User',
          workspace_name: 'Temp WS',
          sub_company_name: 'Temp Sub',
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { tempPassword: string };

    // Sanity: the new row really does have require_password_change=true.
    const [before] = await db
      .select({ requirePasswordChange: schema.users.requirePasswordChange })
      .from(schema.users)
      .where(eq(schema.users.email, userEmail))
      .limit(1);
    expect(before?.requirePasswordChange).toBe(true);

    // Sign in as the new user with the temp password.
    const userJar = new CookieJar();
    const signin = (await auth.api.signInEmail({
      body: { email: userEmail, password: created.tempPassword },
      asResponse: true,
    })) as Response;
    expect(signin.status).toBe(200);
    userJar.ingest(signin);

    // Change the password.
    const changeRes = await changePasswordPOST(
      fakeReq('/api/v1/me/change-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: userJar.header(),
        },
        body: JSON.stringify({
          currentPassword: created.tempPassword,
          newPassword: NEW_PASSWORD,
        }),
      }),
    );
    expect(changeRes.status).toBe(200);

    // Cookie cache MUST be refreshed — without this the dashboard layout
    // would still see requirePasswordChange=true for up to 5 minutes.
    const setCookies = changeRes.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => /session/i.test(c))).toBe(true);

    // DB flag flipped.
    const [after] = await db
      .select({ requirePasswordChange: schema.users.requirePasswordChange })
      .from(schema.users)
      .where(eq(schema.users.email, userEmail))
      .limit(1);
    expect(after?.requirePasswordChange).toBe(false);

    // The new password actually authenticates.
    const reSignin = (await auth.api.signInEmail({
      body: { email: userEmail, password: NEW_PASSWORD },
      asResponse: true,
    })) as Response;
    expect(reSignin.status).toBe(200);

    // And the old temp password no longer works.
    const oldSignin = (await auth.api
      .signInEmail({
        body: { email: userEmail, password: created.tempPassword },
        asResponse: true,
      })
      .catch((err: unknown) => err)) as Response | Error;
    if (oldSignin instanceof Response) {
      expect(oldSignin.status).not.toBe(200);
    } else {
      // better-auth throws an APIError on bad credentials — that's also a pass.
      expect(oldSignin).toBeInstanceOf(Error);
    }
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await changePasswordPOST(
      fakeReq('/api/v1/me/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'x',
          newPassword: 'new-password-1234',
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects when newPassword equals currentPassword', async () => {
    const adminJar = await makeAdminAndSignIn(emails);
    const res = await changePasswordPOST(
      fakeReq('/api/v1/me/change-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminJar.header(),
        },
        body: JSON.stringify({
          currentPassword: 'same-pass-1234',
          newPassword: 'same-pass-1234',
        }),
      }),
    );
    expect(res.status).toBe(422);
    const env = (await res.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('password_unchanged');
  });
});
