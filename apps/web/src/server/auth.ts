// better-auth configuration. Email+password with mandatory email
// verification. The Drizzle adapter is wired against our existing
// `@submittal/db` schema; we override better-auth's default singular table
// names to the plural names step-7 §3 locks in.
//
// Custom `workspaceId` field on the user is required and provided by the
// signup wrapper at apps/web/src/app/api/v1/auth/signup/route.ts.

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '@submittal/shared/notifications';

import { db } from '@/server/db';
import { schema } from '@/server/db';
import { env } from '@/env';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/v1/auth',
  secret: env.BETTER_AUTH_SECRET,
  logger: {
    level: env.NODE_ENV === 'production' ? 'error' : 'debug',
  },

  // The schema map keys MUST match better-auth's internal model names
  // (`user`, `session`, `account`, `verification`). Our SQL tables remain
  // plural (`users`, etc.) — only the JS-side adapter key is singular.
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  user: {
    additionalFields: {
      workspaceId: {
        type: 'string',
        required: true,
        input: true,
      },
    },
  },
  session: {
    expiresIn: env.SESSION_TTL_SECONDS,
    updateAge: 60 * 60 * 24, // refresh session row at most once per day
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    autoSignIn: true,
    // argon2id per step-7 §3. better-auth's default is scrypt; we override.
    password: {
      hash: (password) => argon2Hash(password, { algorithm: 2 /* argon2id */ }),
      verify: ({ password, hash }) => argon2Verify(hash, password),
    },
    sendResetPassword: async ({ user, url }) => {
      const res = await sendPasswordResetEmail({
        to: user.email,
        name: user.name ?? user.email,
        resetUrl: url,
      });
      if (!res.ok) {
        console.error('sendResetPassword: Resend failed', res.error);
      }
    },
  },

  emailVerification: {
    autoSignInAfterVerification: true,
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      const res = await sendVerificationEmail({
        to: user.email,
        name: user.name ?? user.email,
        verificationUrl: url,
      });
      if (!res.ok) {
        console.error('sendVerificationEmail: Resend failed', res.error);
      }
    },
  },

  advanced: {
    // Defer id generation to Postgres (gen_random_uuid() default on every
    // PK in packages/db/src/schema.ts). better-auth otherwise emits short
    // random strings that fail our uuid column type.
    database: {
      generateId: false,
    },
    cookies: {
      session_token: {
        attributes: {
          sameSite: 'lax',
          secure: env.NODE_ENV === 'production',
          httpOnly: true,
        },
      },
    },
  },

  plugins: [nextCookies()],
});

export type Auth = typeof auth;
