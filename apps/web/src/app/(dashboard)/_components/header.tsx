import Link from 'next/link';

import { UserMenu } from './user-menu';

export function Header({ userName, userEmail }: { userName: string; userEmail: string }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Submittal Builder
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Projects
          </Link>
          <Link href="/saved-items" className="hover:text-foreground">
            Saved items
          </Link>
          <UserMenu name={userName} email={userEmail} />
        </nav>
      </div>
    </header>
  );
}
