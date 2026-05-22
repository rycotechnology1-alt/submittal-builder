import type { ProjectResponse, UpdateProjectRequest } from '@submittal/shared/api';

export type ProjectEditField =
  | 'name'
  | 'project_number'
  | 'gc_name'
  | 'architect_name';

const REQUIRED_FIELDS: ReadonlySet<ProjectEditField> = new Set(['name']);

export function isEmptyRequiredField(field: ProjectEditField, value: string): boolean {
  return REQUIRED_FIELDS.has(field) && value.trim() === '';
}

export function normalizeFieldValue(
  field: ProjectEditField,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed === '' && !REQUIRED_FIELDS.has(field)) return null;
  return trimmed;
}

export function buildProjectPatch(
  field: ProjectEditField,
  value: string,
): UpdateProjectRequest {
  const normalized = normalizeFieldValue(field, value);
  return { [field]: normalized } as UpdateProjectRequest;
}

export function hasChanged(
  field: ProjectEditField,
  draft: string,
  current: string | null,
): boolean {
  const normalized = normalizeFieldValue(field, draft);
  const baseline = current ?? (REQUIRED_FIELDS.has(field) ? '' : null);
  return normalized !== baseline;
}

export function currentValue(
  project: ProjectResponse,
  field: ProjectEditField,
): string | null {
  return project[field] ?? null;
}
