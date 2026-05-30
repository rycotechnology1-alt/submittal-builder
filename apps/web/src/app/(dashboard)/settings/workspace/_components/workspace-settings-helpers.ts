import type { UpdateWorkspaceRequest, WorkspaceResponse } from '@submittal/shared/api';

export type WorkspaceEditField =
  | 'name'
  | 'sub_company_name'
  | 'address_street'
  | 'address_city'
  | 'address_state'
  | 'address_zip'
  | 'contact_phone'
  | 'contact_email'
  | 'contact_website';

export const WORKSPACE_FIELD_LABELS: Record<WorkspaceEditField, string> = {
  name: 'Organization name',
  sub_company_name: 'Sub-company name',
  address_street: 'Street',
  address_city: 'City',
  address_state: 'State',
  address_zip: 'ZIP',
  contact_phone: 'Phone',
  contact_email: 'Email',
  contact_website: 'Website',
};

/** Fields that may be left blank (cleared to null) without an error. */
export const OPTIONAL_WORKSPACE_FIELDS = new Set<WorkspaceEditField>([
  'address_street',
  'address_city',
  'address_state',
  'address_zip',
  'contact_phone',
  'contact_email',
  'contact_website',
]);

export function isOptionalWorkspaceField(field: WorkspaceEditField): boolean {
  return OPTIONAL_WORKSPACE_FIELDS.has(field);
}

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
  const normalized = normalizeWorkspaceFieldValue(value);
  // Optional fields clear to null when blank; required fields always send the
  // (non-empty) string.
  if (isOptionalWorkspaceField(field) && normalized === '') {
    return { [field]: null } as UpdateWorkspaceRequest;
  }
  return { [field]: normalized } as UpdateWorkspaceRequest;
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
