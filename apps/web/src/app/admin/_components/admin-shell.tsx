'use client';

import { FileWarning, Flag, LayoutGrid, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  disabled?: boolean;
};

const NAV: NavItem[] = [
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Workspaces', href: '/admin/workspaces', icon: LayoutGrid, disabled: true },
  { label: 'Audit log', href: '/admin/audit-log', icon: FileWarning, disabled: true },
  { label: 'Feature flags', href: '/admin/feature-flags', icon: Flag, disabled: true },
];

export function AdminShell({
  name,
  email,
  children,
}: {
  name: string;
  email: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  async function handleSignOut() {
    await authClient.signOut();
    window.location.assign('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="border-b bg-background">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin/users" className="font-semibold tracking-tight">
              Submittal Builder
            </Link>
            <Badge variant="secondary" className="uppercase tracking-wide">
              Admin
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground"
              title="Exit admin and return to your workspace"
            >
              Exit admin
            </Link>
            <div className="hidden flex-col text-right leading-tight sm:flex">
              <span className="font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r bg-background md:block">
          <nav className="flex flex-col gap-1 p-3">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              if (item.disabled) {
                return (
                  <span
                    key={item.href}
                    className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
                    title="Coming soon"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ' +
                    (active
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground')
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
