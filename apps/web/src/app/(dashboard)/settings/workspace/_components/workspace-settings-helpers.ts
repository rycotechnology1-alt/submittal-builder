import type { UpdateWorkspaceRequest, WorkspaceResponse } from '@submittal/shared/api';

export type WorkspaceEditField = 'name' | 'sub_company_name';

export const WORKSPACE_FIELD_LABELS: Record<WorkspaceEditField, string> = {
  name: 'Workspace name',
  sub_company_name: 'Sub-company name',
};

export const ALLOWED_LOGO_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export type LogoContentType = (typeof ALLOWED_LOGO_CONTENT_TYPES)[number];

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export function isValidLogoContentType(type: string): type is LogoContentType {
  return (ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(type);
}

export function isWithinLogoSizeLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_LOGO_BYTES;
}

export function normalizeWorkspaceFieldValue(value: string): string {
  return value.trim();
}

export function isEmptyWorkspaceField(value: string): boolean {
  return normalizeWorkspaceFieldValue(value) === '';
}

export function buildWorkspacePatch(
  field: WorkspaceEditField,
  value: string,
): UpdateWorkspaceRequest {
  return { [field]: normalizeWorkspaceFieldValue(value) } as UpdateWorkspaceRequest;
}

export function hasWorkspaceChanged(draft: string, current: string): boolean {
  return normalizeWorkspaceFieldValue(draft) !== current;
}

export function currentWorkspaceValue(
  workspace: WorkspaceResponse,
  field: WorkspaceEditField,
): string {
  return workspace[field] ?? '';
}
