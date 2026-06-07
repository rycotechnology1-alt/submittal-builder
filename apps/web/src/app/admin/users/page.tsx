// Admin → Users. Server component: queries the user list directly via the
// shared listAdminUsers helper. Search and pagination state lives in the URL
// (?q=, ?cursor=) so it survives back-button and refresh, and re-renders flow
// through the normal Next.js navigation path. Mutations are owned by the
// client UsersPanel via TanStack Query.
//
// The (admin) layout already enforces super-admin access; this page does not
// re-gate. The admin API routes do their own check, so direct fetches from a
// hostile session can't bypass via this surface.

import { emailEnabled } from '@/env';
import { listAdminUsers } from '@/server/admin-users';

import { UsersPanel } from './_components/users-panel';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? '';
  const cursor = sp.cursor ?? null;

  const result = await listAdminUsers({ q, cursor });

  return (
    <UsersPanel
      initialUsers={result.users}
      nextCursor={result.nextCursor}
      currentQuery={q}
      currentCursor={cursor}
      emailEnabled={emailEnabled}
    />
  );
}
