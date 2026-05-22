import type { UpdatePackageRequest } from '@submittal/shared/api';

export type CoverSheetField =
  | 'submittal_number'
  | 'spec_section'
  | 'revision'
  | 'submittal_date'
  | 'title';

const REQUIRED_FIELDS: ReadonlySet<CoverSheetField> = new Set([
  'submittal_number',
  'spec_section',
  'revision',
]);

const NULLABLE_FIELDS: ReadonlySet<CoverSheetField> = new Set([
  'submittal_date',
  'title',
]);

export function isEmptyRequiredField(field: CoverSheetField, value: string): boolean {
  return REQUIRED_FIELDS.has(field) && value.trim() === '';
}

// Returns null when the user cleared a nullable field; the caller treats this
// as "send null". Returns the trimmed string otherwise. Required fields with
// empty values should be filtered out by `isEmptyRequiredField` first.
export function normalizeFieldValue(
  field: CoverSheetField,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed === '' && NULLABLE_FIELDS.has(field)) return null;
  return trimmed;
}

export function buildPackagePatch(
  field: CoverSheetField,
  value: string,
): UpdatePackageRequest {
  const normalized = normalizeFieldValue(field, value);
  return { [field]: normalized } as UpdatePackageRequest;
}

export function hasChanged(
  field: CoverSheetField,
  draft: string,
  current: string | null,
): boolean {
  const normalized = normalizeFieldValue(field, draft);
  return normalized !== (current ?? (NULLABLE_FIELDS.has(field) ? null : ''));
}
