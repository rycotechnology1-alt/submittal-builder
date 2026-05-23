import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { WorkspaceSettingsForm } from './_components/workspace-settings-form';

export default function WorkspaceSettingsPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to projects
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Defaults that appear on every package&apos;s cover sheet.
      </p>
      <div className="mt-8">
        <WorkspaceSettingsForm />
      </div>
    </section>
  );
}
