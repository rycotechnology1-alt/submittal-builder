// Phase 1 integration test for the signup → verify → sign-in → /me → sign-out
// flow. Hits the real Neon dev branch (no mocks) but does NOT spawn a Next.js
// server — route handlers are async functions and we call them directly with
// synthetic Request objects. Cookies move through a small jar (helpers/).
//
// CI does NOT run this yet (no secrets in CI); see step-8-phase-1-handoff.md.

import '@/env';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { POST as signupPOST } from '@/app/api/v1/auth/signup/route';
import { GET as meGET } from '@/app/api/v1/me/route';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'phase-1-test-pass-1234';

function fakeReq(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

async function flipEmailVerified(email: string): Promise<void> {
  await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
}

describe('signup → /me → logout', () => {
  const emails: string[] = [];

  beforeAll(() => {
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not set — signup will throw inside the email hook');
    }
  });

  afterEach(async () => {
    while (emails.length > 0) {
      const e = emails.pop();
      if (e) await deleteUserByEmail(e);
    }
  });

  it('creates a workspace + user atomically and returns 200', async () => {
    const email = `vitest-${randomUUID()}@example.test`;
    emails.push(email);

    const res = await signupPOST(
      fakeReq('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: PASSWORD,
          name: 'Vitest User',
          workspace_name: 'Vitest Workspace',
          sub_company_name: 'Vitest Sub Co.',
        }),
      }),
    );
    if (res.status !== 200) {
      console.error('signup failed:', res.status, await res.clone().text());
    }
    expect(res.status).toBe(200);

    const [user] = await db
      .select({ id: schema.users.id, workspaceId: schema.users.workspaceId })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    expect(user).toBeDefined();
    expect(user?.workspaceId).toBeTruthy();
  });

  it('rejects duplicate signups with 409', async () => {
    const email = `vitest-${randomUUID()}@example.test`;
    emails.push(email);
    const body = JSON.stringify({
      email,
      password: PASSWORD,
      name: 'Vitest',
      workspace_name: 'WS',
      sub_company_name: 'Sub',
    });
    const first = await signupPOST(
      fakeReq('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(first.status).toBe(200);
    const second = await signupPOST(
      fakeReq('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(second.status).toBe(409);
    const env = (await second.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('email_in_use');
  });

  it('rejects malformed payload with 422', async () => {
    const res = await signupPOST(
      fakeReq('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it('full flow: signup → verify → sign-in → /me → sign-out', async () => {
    const email = `vitest-${randomUUID()}@example.test`;
    emails.push(email);
    const jar = new CookieJar();

    // 1. signup
    const signup = await signupPOST(
      fakeReq('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: PASSWORD,
          name: 'Flow User',
          workspace_name: 'Flow WS',
          sub_company_name: 'Flow Sub',
        }),
      }),
    );
    expect(signup.status).toBe(200);

    // 2. /me before sign-in → 401 (signup does not auto-sign-in when
    //    requireEmailVerification: true).
    const preMe = await meGET(fakeReq('/api/v1/me'));
    expect(preMe.status).toBe(401);

    // 3. Simulate clicking the verification email by flipping
    //    `users.email_verified=true` directly.
    await flipEmailVerified(email);

    // 4. Sign in via better-auth's server API. Returns a Response with
    //    Set-Cookie headers we move into the jar.
    const signin = (await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    })) as Response;
    expect(signin.status).toBe(200);
    jar.ingest(signin);
    expect(jar.header()).toMatch(/session/i);

    // 5. /me with the session cookie
    const me = await meGET(fakeReq('/api/v1/me', { headers: { cookie: jar.header() } }));
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      user: { email: string; name: string };
      workspace: { name: string; subCompanyName: string };
    };
    expect(meBody.user.email).toBe(email);
    expect(meBody.workspace.name).toBe('Flow WS');
    expect(meBody.workspace.subCompanyName).toBe('Flow Sub');

    // 6. Sign out
    const signout = (await auth.api.signOut({
      headers: new Headers({ cookie: jar.header() }),
      asResponse: true,
    })) as Response;
    expect(signout.status).toBe(200);
    jar.ingest(signout);

    // 7. /me after sign-out → 401
    const meAfter = await meGET(
      fakeReq('/api/v1/me', { headers: { cookie: jar.header() } }),
    );
    expect(meAfter.status).toBe(401);
  });
});

describe('tenancy', () => {
  it('withWorkspace returns 401 when no session cookie present', async () => {
    const res = await meGET(fakeReq('/api/v1/me'));
    expect(res.status).toBe(401);
    const env = (await res.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('unauthorized');
  });
});
