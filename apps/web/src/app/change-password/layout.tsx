// Top-level layout for /change-password. Sits OUTSIDE the (auth) and
// (dashboard) groups because (auth) would redirect logged-in users away and
// (dashboard) would redirect them right back here in an infinite loop. Only
// guard: a session must exist.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/server/auth';

export default async function ChangePasswordLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect('/login');
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
