'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type { PackageDetailResponse, ProjectDetailResponse } from '@submittal/shared/api';

import { PackageHeader } from './_components/package-header';
import { UploadProcessingPanel } from './_components/upload-processing-panel';

export default function PackageDetailPage() {
  const params = useParams<{ id: string }>();
  const packageId = params.id;

  const packageQuery = useQuery({
    queryKey: ['package', packageId],
    queryFn: () => api.get<PackageDetailResponse>(`/api/v1/packages/${packageId}`),
    enabled: Boolean(packageId),
  });

  const projectQuery = useQuery({
    queryKey: ['project', packageQuery.data?.project_id],
    queryFn: () =>
      api.get<ProjectDetailResponse>(`/api/v1/projects/${packageQuery.data!.project_id}`),
    enabled: Boolean(packageQuery.data?.project_id),
  });

  if (packageQuery.error) {
    const notFound = packageQuery.error instanceof ApiError && packageQuery.error.status === 404;
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <BackLink />
        <div className="mt-6">
          {notFound ? (
            <NotFoundState />
          ) : (
            <ErrorState
              message={
                packageQuery.error instanceof ApiError
                  ? packageQuery.error.message
                  : 'Could not load package.'
              }
            />
          )}
        </div>
      </div>
    );
  }

  if (packageQuery.isLoading || !packageQuery.data) {
    return <PackageSkeleton />;
  }

  const pkg = packageQuery.data;
  const project = projectQuery.data?.project ?? null;

  return (
    <>
      <PackageHeader pkg={pkg} project={project} />
      {pkg.status === 'draft' || pkg.status === 'processing' ? (
        <UploadProcessingPanel
          packageId={pkg.id}
          packageStatus={pkg.status}
          sourcePdfCount={pkg.source_pdf_count}
        />
      ) : pkg.status === 'ready' ? (
        <ReadyPlaceholder pkg={pkg} />
      ) : (
        <ExportedPlaceholder pkg={pkg} />
      )}
    </>
  );
}

function PackageSkeleton() {
  return (
    <div>
      <div className="border-b bg-background">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-8 w-72" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Skeleton className="h-56 rounded-lg" />
        <div className="mt-8 space-y-3 rounded-lg border bg-card p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadyPlaceholder({ pkg }: { pkg: PackageDetailResponse }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="rounded-lg border border-dashed bg-card p-10 text-center">
        <h2 className="text-lg font-semibold tracking-tight">Package editor coming next</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {pkg.item_count} items and {pkg.source_pdf_count} source PDFs are ready for review.
        </p>
      </div>
    </main>
  );
}

function ExportedPlaceholder({ pkg }: { pkg: PackageDetailResponse }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="rounded-lg border bg-card p-10 text-center">
        <h2 className="text-lg font-semibold tracking-tight">Package exported</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The read-only editor lands in the next UI phase.
        </p>
        {pkg.latest_export ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Last export: {pkg.latest_export.status} on{' '}
            {new Date(pkg.latest_export.created_at).toLocaleDateString()}
          </p>
        ) : null}
      </div>
    </main>
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
      <h3 className="text-base font-medium">Package not found</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        This package may have been deleted, or you may not have access.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/">
          <Button variant="outline">Back to projects</Button>
        </Link>
      </div>
    </div>
  );
}
