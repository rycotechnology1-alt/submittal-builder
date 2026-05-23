'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type { ProjectDetailResponse } from '@submittal/shared/api';

import { EditableProjectMetadata } from './_components/editable-project-metadata';
import { NewPackageDialog } from './_components/new-package-dialog';
import { ProjectDangerZone } from './_components/project-danger-zone';

type PackageSummary = ProjectDetailResponse['packages'][number];

const statusLabels: Record<PackageSummary['status'], string> = {
  draft: 'Draft',
  processing: 'Processing',
  ready: 'Ready',
  exported: 'Exported',
};

const statusVariants: Record<
  PackageSummary['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'outline',
  processing: 'secondary',
  ready: 'default',
  exported: 'secondary',
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [query, setQuery] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetailResponse>(`/api/v1/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  const filteredPackages = useMemo(() => {
    const packages = data?.packages ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(
      (p) =>
        p.submittal_number.toLowerCase().includes(q) ||
        p.revision.toLowerCase().includes(q),
    );
  }, [data, query]);

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <BackLink />
        <div className="mt-6">
          {notFound ? (
            <NotFoundState />
          ) : (
            <ErrorState
              message={error instanceof ApiError ? error.message : 'Could not load project.'}
            />
          )}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <BackLink />
        <HeaderSkeleton />
        <PackagesSkeleton />
      </div>
    );
  }

  const { project, packages } = data;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <BackLink />
      <div className="mb-8 mt-2 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <EditableProjectMetadata project={project} />
      </div>

      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Packages</h2>
        <NewPackageDialog
          projectId={projectId}
          trigger={
            <Button>
              <Plus className="h-4 w-4" />
              New package
            </Button>
          }
        />
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search by submittal number or revision…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
      </div>

      {filteredPackages.length === 0 ? (
        packages.length === 0 ? (
          <EmptyState projectId={projectId} />
        ) : (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No packages match &ldquo;{query}&rdquo;.
          </p>
        )
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {filteredPackages.map((pkg) => (
            <li key={pkg.id}>
              <Link
                href={`/packages/${pkg.id}`}
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="truncate font-medium">{pkg.submittal_number}</p>
                    <span className="text-xs text-muted-foreground">{pkg.revision}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    Last updated {formatRelative(pkg.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant={statusVariants[pkg.status]}>{statusLabels[pkg.status]}</Badge>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ProjectDangerZone projectId={project.id} projectName={project.name} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      Projects
    </Link>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-8 mt-2 space-y-2">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}

function PackagesSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ projectId }: { projectId: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-10 text-center">
      <h3 className="text-base font-medium">No packages yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a package to start uploading submittal docs.
      </p>
      <div className="mt-6 flex justify-center">
        <NewPackageDialog
          projectId={projectId}
          trigger={
            <Button>
              <Plus className="h-4 w-4" />
              New package
            </Button>
          }
        />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {message}
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-10 text-center">
      <h3 className="text-base font-medium">Project not found</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        This project may have been deleted, or you may not have access.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/">
          <Button variant="outline">Back to projects</Button>
        </Link>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
