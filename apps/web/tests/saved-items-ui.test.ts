import { describe, expect, it } from 'vitest';

import { saveCommonDisabledReason } from '@/app/(dashboard)/packages/[id]/_components/editor/saved-items-helpers';
import type { PackageItemResponse } from '@submittal/shared/api';

function itemWithSources(sourcePdfs: PackageItemResponse['source_pdfs']): PackageItemResponse {
  return {
    item: {
      id: crypto.randomUUID(),
      package_id: crypto.randomUUID(),
      doc_type: 'product_data',
      doc_type_confidence: null,
      doc_type_original_ai_value: null,
      sort_order: 0,
      title: 'PVC conduit',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    attributes: [],
    source_pdfs: sourcePdfs,
    variants: [],
    selected_part_numbers: [],
  };
}

describe('saveCommonDisabledReason', () => {
  it('allows exactly one extracted source PDF with a hash', () => {
    expect(
      saveCommonDisabledReason(
        itemWithSources([
          {
            id: crypto.randomUUID(),
            original_filename: 'pvc.pdf',
            page_count: 2,
            processing_status: 'extracted',
            sha256: 'a'.repeat(64),
          },
        ]),
      ),
    ).toBeNull();
  });

  it('blocks unsupported v1 source shapes', () => {
    expect(saveCommonDisabledReason(itemWithSources([]))).toBe('No source PDF to save');
    expect(
      saveCommonDisabledReason(
        itemWithSources([
          {
            id: crypto.randomUUID(),
            original_filename: 'a.pdf',
            page_count: 1,
            processing_status: 'extracted',
            sha256: 'a'.repeat(64),
          },
          {
            id: crypto.randomUUID(),
            original_filename: 'b.pdf',
            page_count: 1,
            processing_status: 'extracted',
            sha256: 'b'.repeat(64),
          },
        ]),
      ),
    ).toBe('Only one source PDF can be saved in v1');
  });

  it('blocks unprocessed or unhashed source PDFs', () => {
    expect(
      saveCommonDisabledReason(
        itemWithSources([
          {
            id: crypto.randomUUID(),
            original_filename: 'pvc.pdf',
            page_count: 2,
            processing_status: 'extracting',
            sha256: 'a'.repeat(64),
          },
        ]),
      ),
    ).toBe('Processing must finish before saving');

    expect(
      saveCommonDisabledReason(
        itemWithSources([
          {
            id: crypto.randomUUID(),
            original_filename: 'pvc.pdf',
            page_count: 2,
            processing_status: 'extracted',
            sha256: null,
          },
        ]),
      ),
    ).toBe('Source PDF hash is missing');
  });
});
