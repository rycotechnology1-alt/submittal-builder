import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import type { PackageDetailResponse, ProjectDetailResponse } from '@submittal/shared/api';

const statusLabels: Record<PackageDetailResponse['status'], string> = {
  draft: 'Draft',
  processing: 'Processing',
  ready: 'Ready',
  exported: 'Exported',
};

const statusVariants: Record<
  PackageDetailResponse['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'outline',
  processing: 'secondary',
  ready: 'default',
  exported: 'secondary',
};

export function PackageHeader({
  pkg,
  project,
}: {
  pkg: PackageDetailResponse;
  project: ProjectDetailResponse['project'] | null;
}) {
  const title = pkg.title ?? 'Untitled package';
  const backHref = project ? `/projects/${project.id}` : '/';
  const backLabel = project?.name ?? 'Project';

  return (
    <header className="border-b bg-background">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {pkg.submittal_number} {pkg.revision}
              </h1>
              <Badge variant={statusVariants[pkg.status]}>{statusLabels[pkg.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">Spec section {pkg.spec_section}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
