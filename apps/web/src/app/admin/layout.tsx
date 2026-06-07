// Super-admin route group. Mirrors withAdmin (server/admin.ts) but uses
// notFound() / redirect() because layouts return React, not Responses.

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/server/auth';
import { adminEmails } from '@/env';
import { isAdmin } from '@/server/admin';
import { db, schema } from '@/server/db';

import { AdminShell } from './_components/admin-shell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user?.id) {
    redirect('/login');
  }

  const [row] = await db
    .select({
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      requirePasswordChange: schema.users.requirePasswordChange,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!row) notFound();

  if (!isAdmin(row)) notFound();

  if (row.requirePasswordChange) {
    redirect('/change-password');
  }

  // Self-heal the durable role row if the user got in via the email allowlist.
  if (row.role !== 'admin' && adminEmails.has(row.email.toLowerCase())) {
    await db
      .update(schema.users)
      .set({ role: 'admin' })
      .where(eq(schema.users.id, session.user.id));
  }

  return (
    <AdminShell name={row.name} email={row.email}>
      {children}
    </AdminShell>
  );
}
