import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { auth } from '@/server/auth';
import { isAdmin } from '@/server/admin';
import { db, schema } from '@/server/db';

import { Header } from './_components/header';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user?.id) {
    redirect('/login');
  }

  // Source-of-truth read for `role` and `require_password_change`. We can't
  // trust the session-attached values because better-auth caches the session
  // payload in an encrypted cookie for up to 5 minutes (see
  // server/auth.ts → session.cookieCache). When the user just finished a
  // password reset, the cookie still says require_password_change=true even
  // though the DB row is false — without this DB hop they get bounced right
  // back to /change-password.
  const [row] = await db
    .select({
      role: schema.users.role,
      requirePasswordChange: schema.users.requirePasswordChange,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!row) {
    // Session points at a user that no longer exists (workspace cascade, etc).
    redirect('/login');
  }

  if (row.requirePasswordChange) {
    redirect('/change-password');
  }

  const showAdminLink = isAdmin({
    email: session.user.email,
    role: row.role,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        userName={session.user.name ?? session.user.email}
        userEmail={session.user.email}
        showAdminLink={showAdminLink}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
