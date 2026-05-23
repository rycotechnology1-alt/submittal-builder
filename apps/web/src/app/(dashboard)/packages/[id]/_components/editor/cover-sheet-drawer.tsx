'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type {
  PackageDetailResponse,
  ProjectResponse,
  UpdatePackageRequest,
  WorkspaceResponse,
} from '@submittal/shared/api';

import {
  DateField,
  EditableTextField,
  ReadOnlyField,
  RevisionSelect,
} from './cover-sheet-fields';
import type { CoverSheetField } from './cover-sheet-helpers';
import { buildPackagePatch } from './cover-sheet-helpers';

export function CoverSheetDrawer({
  open,
  onOpenChange,
  pkg,
  project,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  pkg: PackageDetailResponse;
  project: ProjectResponse | null;
}) {
  const queryClient = useQueryClient();
  const packageKey = ['package', pkg.id] as const;

  const workspaceQuery = useQuery({
    queryKey: ['workspace'],
    queryFn: () => api.get<WorkspaceResponse | null>('/api/v1/workspace'),
    enabled: open,
    staleTime: 60_000,
  });

  const patchMutation = useMutation({
    mutationFn: (body: UpdatePackageRequest) =>
      api.patch<PackageDetailResponse>(`/api/v1/packages/${pkg.id}`, body),
  });

  function savePackageField(field: CoverSheetField, value: string | null) {
    const current = pkg[field] ?? null;
    if (value === current) return;

    const snapshot = queryClient.getQueryData<PackageDetailResponse>(packageKey) ?? pkg;
    const optimistic: PackageDetailResponse = { ...snapshot, [field]: value };
    queryClient.setQueryData<PackageDetailResponse>(packageKey, optimistic);

    const body =
      value === null
        ? ({ [field]: null } as UpdatePackageRequest)
        : buildPackagePatch(field, value);

    patchMutation.mutate(body, {
      onSuccess: (updated) => {
        queryClient.setQueryData<PackageDetailResponse>(packageKey, (prev) =>
          prev ? { ...prev, ...updated } : updated,
        );
      },
      onError: (err) => {
        queryClient.setQueryData(packageKey, snapshot);
        toast.error(err instanceof ApiError ? err.message : 'Could not save cover sheet field.');
      },
    });
  }

  function notifyRequired(label: string) {
    toast.error(`${label} can't be empty.`);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Cover sheet</SheetTitle>
          <SheetDescription>
            Edits save when you tab out of a field.
          </SheetDescription>
        </SheetHeader>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Project
            </h3>
            <Link
              href={`/projects/${pkg.project_id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Edit project metadata
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <ReadOnlyField label="Project name" value={project?.name ?? null} />
          <ReadOnlyField label="Project number" value={project?.project_number ?? null} />
          <ReadOnlyField label="GC" value={project?.gc_name ?? null} />
          <ReadOnlyField label="Architect" value={project?.architect_name ?? null} />
        </section>

        <hr className="border-border" />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Package
          </h3>
          <EditableTextField
            label="Submittal #"
            field="submittal_number"
            value={pkg.submittal_number}
            onCommit={(next) => {
              if (next != null) savePackageField('submittal_number', next);
            }}
            onInvalidEmpty={() => notifyRequired('Submittal #')}
          />
          <EditableTextField
            label="Spec section"
            field="spec_section"
            value={pkg.spec_section}
            onCommit={(next) => {
              if (next != null) savePackageField('spec_section', next);
            }}
            onInvalidEmpty={() => notifyRequired('Spec section')}
          />
          <RevisionSelect
            value={pkg.revision}
            onCommit={(next) => savePackageField('revision', next)}
          />
          <DateField
            label="Date"
            value={pkg.submittal_date}
            onCommit={(next) => savePackageField('submittal_date', next)}
          />
          <EditableTextField
            label="Title"
            field="title"
            value={pkg.title}
            onCommit={(next) => savePackageField('title', next)}
            onInvalidEmpty={() => undefined}
          />
        </section>

        <hr className="border-border" />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Workspace defaults
            </h3>
            <Link
              href="/settings/workspace"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Change in workspace settings
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {workspaceQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : workspaceQuery.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {workspaceQuery.error instanceof ApiError
                ? workspaceQuery.error.message
                : 'Could not load workspace defaults.'}
            </div>
          ) : workspaceQuery.data ? (
            <>
              <ReadOnlyField
                label="Sub company"
                value={workspaceQuery.data.sub_company_name || null}
              />
              <WorkspaceLogoRow logoUrl={workspaceQuery.data.sub_company_logo_url} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Workspace not configured.</p>
          )}
        </section>

        <div className="mt-2 rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Live preview lands with export work.
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WorkspaceLogoRow({ logoUrl }: { logoUrl: string | null }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div className="pt-2 text-sm font-medium text-muted-foreground">Logo</div>
      <div className="min-w-0 pt-1">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Workspace sub-company logo"
            className="h-12 w-auto rounded border bg-background object-contain"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No logo uploaded</span>
        )}
      </div>
    </div>
  );
}
