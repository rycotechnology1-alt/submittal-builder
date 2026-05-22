'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type {
  ProjectDetailResponse,
  ProjectResponse,
  UpdateProjectRequest,
} from '@submittal/shared/api';

import {
  buildProjectPatch,
  currentValue,
  hasChanged,
  isEmptyRequiredField,
  normalizeFieldValue,
  type ProjectEditField,
} from './project-edit-helpers';

const FIELD_LABELS: Record<ProjectEditField, string> = {
  name: 'Project name',
  project_number: 'Project number',
  gc_name: 'GC',
  architect_name: 'Architect',
};

const inputClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function EditableProjectMetadata({
  project,
}: {
  project: ProjectResponse;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NameField project={project} />
      <NullableField project={project} field="project_number" />
      <NullableField project={project} field="gc_name" />
      <NullableField project={project} field="architect_name" />
    </div>
  );
}

function NameField({ project }: { project: ProjectResponse }) {
  return <EditableRow project={project} field="name" />;
}

function NullableField({
  project,
  field,
}: {
  project: ProjectResponse;
  field: ProjectEditField;
}) {
  return <EditableRow project={project} field={field} />;
}

function EditableRow({
  project,
  field,
}: {
  project: ProjectResponse;
  field: ProjectEditField;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['project', project.id] as const;
  const current = currentValue(project, field);
  const [draft, setDraft] = useState(current ?? '');

  useEffect(() => {
    setDraft(current ?? '');
  }, [current]);

  const patchMutation = useMutation({
    mutationFn: (body: UpdateProjectRequest) =>
      api.patch<ProjectResponse>(`/api/v1/projects/${project.id}`, body),
  });

  function commit() {
    if (isEmptyRequiredField(field, draft)) {
      setDraft(current ?? '');
      toast.error(`${FIELD_LABELS[field]} can't be empty.`);
      return;
    }
    if (!hasChanged(field, draft, current)) return;

    const snapshot = queryClient.getQueryData<ProjectDetailResponse>(queryKey);
    const normalized = normalizeFieldValue(field, draft);
    if (snapshot) {
      queryClient.setQueryData<ProjectDetailResponse>(queryKey, {
        ...snapshot,
        project: { ...snapshot.project, [field]: normalized },
      });
    }

    patchMutation.mutate(buildProjectPatch(field, draft), {
      onSuccess: (updated) => {
        queryClient.setQueryData<ProjectDetailResponse>(queryKey, (prev) =>
          prev ? { ...prev, project: { ...prev.project, ...updated } } : prev,
        );
      },
      onError: (err) => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot);
        setDraft(current ?? '');
        toast.error(
          err instanceof ApiError ? err.message : `Could not save ${FIELD_LABELS[field]}.`,
        );
      },
    });
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor={`project-${field}`}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {FIELD_LABELS[field]}
      </label>
      <input
        id={`project-${field}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setDraft(current ?? '');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="—"
        className={inputClass}
      />
    </div>
  );
}
