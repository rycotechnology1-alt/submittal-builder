'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  isOptionalWorkspaceField,
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
          Organization name and logo appear on the exported cover sheet header.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Company address
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <EditableRow workspace={workspace} field="address_street" className="sm:col-span-2" />
          <EditableRow workspace={workspace} field="address_city" />
          <div className="grid grid-cols-2 gap-3">
            <EditableRow workspace={workspace} field="address_state" />
            <EditableRow workspace={workspace} field="address_zip" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Prints on the cover sheet under your organization name. Leave any field blank to omit it.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Contact
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <EditableRow workspace={workspace} field="contact_phone" />
          <EditableRow workspace={workspace} field="contact_email" />
          <EditableRow workspace={workspace} field="contact_website" className="sm:col-span-2" />
        </div>
        <p className="text-xs text-muted-foreground">
          Optional. Prints under the address on the cover sheet; blank fields are skipped.
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

const AUTO_SAVE_DELAY_MS = 500;

function EditableRow({
  workspace,
  field,
  className,
}: {
  workspace: WorkspaceResponse;
  field: WorkspaceEditField;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['workspace'] as const;
  const optional = isOptionalWorkspaceField(field);
  const current = currentWorkspaceValue(workspace, field);
  const [draft, setDraft] = useState(current);

  // Refs mirror the latest values so the debounce timer and the unmount flush
  // act on current state rather than a stale render closure.
  const draftRef = useRef(draft);
  const currentRef = useRef(current);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setDraft(current);
  }, [current]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const patchMutation = useMutation({
    mutationFn: (body: UpdateWorkspaceRequest) =>
      api.patch<WorkspaceResponse>('/api/v1/workspace', body),
  });

  // Flush a pending edit when the row unmounts — e.g. the user picks a browser
  // autofill suggestion (which fires onChange but never blurs) and immediately
  // navigates away before the debounce fires. SPA navigation keeps the JS
  // context alive, so this best-effort request still completes.
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      const pendingDraft = draftRef.current;
      const pendingCurrent = currentRef.current;
      if (!hasWorkspaceChanged(pendingDraft, pendingCurrent)) return;
      if (!optional && isEmptyWorkspaceField(pendingDraft)) return;
      void api
        .patch('/api/v1/workspace', buildWorkspacePatch(field, pendingDraft))
        .catch(() => {
          // best-effort on unmount; nothing left to surface
        });
    };
  }, [field, optional]);

  function commit(opts?: { silent?: boolean }) {
    clearTimeout(timerRef.current);
    const silent = opts?.silent ?? false;
    const draftValue = draftRef.current;
    const currentValue = currentRef.current;

    if (!optional && isEmptyWorkspaceField(draftValue)) {
      // Don't nag mid-edit during auto-save; blur/Enter enforces the rule.
      if (silent) return;
      setDraft(currentValue);
      toast.error(`${WORKSPACE_FIELD_LABELS[field]} can't be empty.`);
      return;
    }
    if (!hasWorkspaceChanged(draftValue, currentValue)) return;

    const nextValue = optional && isEmptyWorkspaceField(draftValue) ? null : draftValue.trim();
    const snapshot = queryClient.getQueryData<WorkspaceResponse>(queryKey);
    if (snapshot) {
      queryClient.setQueryData<WorkspaceResponse>(queryKey, {
        ...snapshot,
        [field]: nextValue,
      });
    }

    patchMutation.mutate(buildWorkspacePatch(field, draftValue), {
      onSuccess: (updated) => {
        // Merge only this field so the near-simultaneous saves autofill triggers
        // can't clobber each other's freshly-saved values.
        queryClient.setQueryData<WorkspaceResponse>(queryKey, (prev) =>
          prev ? { ...prev, [field]: updated[field] } : updated,
        );
      },
      onError: (err) => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot);
        setDraft(currentValue);
        toast.error(
          err instanceof ApiError
            ? err.message
            : `Could not save ${WORKSPACE_FIELD_LABELS[field]}.`,
        );
      },
    });
  }

  function handleChange(value: string) {
    setDraft(value);
    draftRef.current = value;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit({ silent: true }), AUTO_SAVE_DELAY_MS);
  }

  return (
    <div className={className ? `space-y-1 ${className}` : 'space-y-1'}>
      <label
        htmlFor={`workspace-${field}`}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {WORKSPACE_FIELD_LABELS[field]}
      </label>
      <input
        id={`workspace-${field}`}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            clearTimeout(timerRef.current);
            setDraft(current);
            draftRef.current = current;
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="—"
        className={inputClass}
      />
    </div>
  );
}
