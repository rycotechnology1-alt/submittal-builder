import type { PackageItemResponse } from '@submittal/shared/api';

export function saveCommonDisabledReason(item: PackageItemResponse): string | null {
  if (item.source_pdfs.length === 0) return 'No source PDF to save';
  if (item.source_pdfs.length > 1) return 'Only one source PDF can be saved in v1';

  const source = item.source_pdfs[0]!;
  if (source.processing_status !== 'extracted') return 'Processing must finish before saving';
  if (!source.sha256) return 'Source PDF hash is missing';
  return null;
}
