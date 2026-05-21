import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { auth } from '@/server/auth';
import { Header } from './_components/header';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        userName={session.user.name ?? session.user.email}
        userEmail={session.user.email}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
