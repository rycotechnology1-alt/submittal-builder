import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { ChangePasswordForm } from './_components/change-password-form';

export default async function ChangePasswordPage() {
  // The layout already gates on a session; this redundant check is cheap and
  // means the page is safe to import in isolation (e.g., from tests).
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect('/login');
  }

  // DB read for the truth of `require_password_change`. If the user wasn't
  // forced here, we still let them change their password — we just give them
  // an escape hatch back to the dashboard.
  const [row] = await db
    .select({ requirePasswordChange: schema.users.requirePasswordChange })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);

  const forced = row?.requirePasswordChange ?? false;

  return <ChangePasswordForm forced={forced} />;
}
