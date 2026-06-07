'use client';

import { Key, MailWarning, MoreHorizontal, Plus, ShieldCheck, ShieldX } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { CreateUserDialog } from './create-user-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';
import { SendResetEmailDialog } from './send-reset-email-dialog';
import type { AdminUserListItem } from './shared-types';

type Props = {
  initialUsers: AdminUserListItem[];
  nextCursor: string | null;
  currentQuery: string;
  currentCursor: string | null;
  emailEnabled: boolean;
};

export function UsersPanel({
  initialUsers,
  nextCursor,
  currentQuery,
  currentCursor,
  emailEnabled,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(currentQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUserListItem | null>(null);
  const [sendResetTarget, setSendResetTarget] = useState<AdminUserListItem | null>(null);

  // Debounced URL sync: typing in the search box updates ?q= without thrashing
  // the server with one request per keystroke.
  useEffect(() => {
    if (searchInput === currentQuery) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (searchInput) {
        next.set('q', searchInput);
      } else {
        next.delete('q');
      }
      next.delete('cursor');
      startTransition(() => {
        router.replace(`/admin/users?${next.toString()}`);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput, currentQuery, params, router]);

  function goToNextPage() {
    if (!nextCursor) return;
    const next = new URLSearchParams(params.toString());
    next.set('cursor', nextCursor);
    router.push(`/admin/users?${next.toString()}`);
  }

  function goToFirstPage() {
    const next = new URLSearchParams(params.toString());
    next.delete('cursor');
    router.push(`/admin/users?${next.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Create accounts, reset passwords, and trigger reset emails.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New user
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by email or name…"
          className="max-w-md"
        />
        {currentCursor !== null && (
          <Button variant="ghost" size="sm" onClick={goToFirstPage}>
            First page
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Email</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Workspace</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Last sign-in</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  No users match.
                </td>
              </tr>
            )}
            {initialUsers.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-2 align-middle">{u.email}</td>
                <td className="px-4 py-2 align-middle">{u.name}</td>
                <td className="px-4 py-2 align-middle">{u.workspace.name}</td>
                <td className="px-4 py-2 align-middle">
                  {u.role === 'admin' ? (
                    <Badge variant="default" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Admin
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <ShieldX className="h-3 w-3" />
                      User
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2 align-middle">
                  {u.requirePasswordChange ? (
                    <Badge variant="secondary">Pending pw change</Badge>
                  ) : u.emailVerified ? (
                    <Badge variant="outline">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Unverified</Badge>
                  )}
                </td>
                <td className="px-4 py-2 align-middle text-muted-foreground">
                  {u.lastSignInAt
                    ? new Date(u.lastSignInAt).toLocaleString()
                    : 'Never'}
                </td>
                <td className="px-4 py-2 text-right align-middle">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label="User actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => setResetTarget(u)}>
                        <Key className="mr-2 h-4 w-4" />
                        Reset password (set temp)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!emailEnabled}
                        onSelect={() => emailEnabled && setSendResetTarget(u)}
                        title={
                          emailEnabled
                            ? undefined
                            : 'Email service offline — set RESEND_API_KEY to enable'
                        }
                      >
                        <MailWarning className="mr-2 h-4 w-4" />
                        Send password reset email
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        {nextCursor && (
          <Button variant="outline" size="sm" onClick={goToNextPage}>
            Next page →
          </Button>
        )}
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => router.refresh()}
      />
      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          open
          onOpenChange={(next) => !next && setResetTarget(null)}
          onResetComplete={() => router.refresh()}
        />
      )}
      {sendResetTarget && (
        <SendResetEmailDialog
          user={sendResetTarget}
          open
          onOpenChange={(next) => !next && setSendResetTarget(null)}
        />
      )}
    </div>
  );
}
