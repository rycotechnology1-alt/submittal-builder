'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type { UpdateWorkspaceRequest, WorkspaceResponse } from '@submittal/shared/api';

import { WorkspaceLogoUpload } from './workspace-logo-upload';
import {
  WORKSPACE_FIELD_LABELS,
  buildWorkspacePatch,
  currentWorkspaceValue,
  hasWorkspaceChanged,
  isEmptyWorkspaceField,
  type WorkspaceEditField,
} from './workspace-settings-helpers';

const inputClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function WorkspaceSettingsForm() {
  const workspaceQuery = useQuery({
    queryKey: ['workspace'],
    queryFn: () => api.get<WorkspaceResponse | null>('/api/v1/workspace'),
    staleTime: 60_000,
  });

  if (workspaceQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-24 w-full max-w-md" />
      </div>
    );
  }

  if (workspaceQuery.error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {workspaceQuery.error instanceof ApiError
          ? workspaceQuery.error.message
          : 'Could not load workspace.'}
      </div>
    );
  }

  if (!workspaceQuery.data) {
    return <p className="text-sm text-muted-foreground">Workspace not configured.</p>;
  }

  const workspace = workspaceQuery.data;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <EditableRow workspace={workspace} field="name" />
          <EditableRow workspace={workspace} field="sub_company_name" />
        </div>
        <p className="text-xs text-muted-foreground">
          Sub-company name and logo appear on the exported cover sheet.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Logo
        </h2>
        <WorkspaceLogoUpload workspace={workspace} />
      </section>
    </div>
  );
}

function EditableRow({
  workspace,
  field,
}: {
  workspace: WorkspaceResponse;
  field: WorkspaceEditField;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['workspace'] as const;
  const current = currentWorkspaceValue(workspace, field);
  const [draft, setDraft] = useState(current);

  useEffect(() => {
    setDraft(current);
  }, [current]);

  const patchMutation = useMutation({
    mutationFn: (body: UpdateWorkspaceRequest) =>
      api.patch<WorkspaceResponse>('/api/v1/workspace', body),
  });

  function commit() {
    if (isEmptyWorkspaceField(draft)) {
      setDraft(current);
      toast.error(`${WORKSPACE_FIELD_LABELS[field]} can't be empty.`);
      return;
    }
    if (!hasWorkspaceChanged(draft, current)) return;

    const snapshot = queryClient.getQueryData<WorkspaceResponse>(queryKey);
    if (snapshot) {
      queryClient.setQueryData<WorkspaceResponse>(queryKey, {
        ...snapshot,
        [field]: draft.trim(),
      });
    }

    patchMutation.mutate(buildWorkspacePatch(field, draft), {
      onSuccess: (updated) => {
        queryClient.setQueryData<WorkspaceResponse>(queryKey, updated);
      },
      onError: (err) => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot);
        setDraft(current);
        toast.error(
          err instanceof ApiError
            ? err.message
            : `Could not save ${WORKSPACE_FIELD_LABELS[field]}.`,
        );
      },
    });
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor={`workspace-${field}`}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {WORKSPACE_FIELD_LABELS[field]}
      </label>
      <input
        id={`workspace-${field}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setDraft(current);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="—"
        className={inputClass}
      />
    </div>
  );
}
