import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveCommonDisabledReason } from '@/app/(dashboard)/packages/[id]/_components/editor/saved-items-helpers';
import {
  savedItemAttributeValue,
  savedItemStatusLabel,
} from '@/app/(dashboard)/saved-items/_components/saved-items-helpers';
import type { PackageItemResponse } from '@submittal/shared/api';
import type { SavedItemSummary } from '@submittal/shared/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const savedItemDetailPagePath = path.join(
  __dirname,
  '..',
  'src',
  'app',
  '(dashboard)',
  'saved-items',
  '[id]',
  'page.tsx',
);

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

function savedSummary(overrides: Partial<SavedItemSummary> = {}): SavedItemSummary {
  return {
    id: crypto.randomUUID(),
    title: 'PVC conduit',
    doc_type: 'product_data',
    doc_type_confidence: null,
    doc_type_original_ai_value: null,
    original_filename: 'pvc.pdf',
    byte_size: 100,
    page_count: 2,
    sha256: 'a'.repeat(64),
    processing_status: 'extracted',
    processing_error: null,
    attributes: [
      {
        key: 'manufacturer',
        current_value: 'CANTEX',
        original_ai_value: 'CANTEX',
        confidence: 0.9,
        saved_item_source_page_id: null,
        edited_by_user_at: null,
      },
    ],
    variant_count: 2,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('saved item UI helpers', () => {
  it('reads common attribute values from saved summaries', () => {
    expect(savedItemAttributeValue(savedSummary(), 'manufacturer')).toBe('CANTEX');
    expect(savedItemAttributeValue(savedSummary(), 'model_number')).toBeNull();
  });

  it('labels processing states for dashboard rows', () => {
    expect(savedItemStatusLabel(savedSummary({ processing_status: 'uploaded' }))).toBe('Queued');
    expect(savedItemStatusLabel(savedSummary({ processing_status: 'extracting' }))).toBe(
      'Extracting',
    );
    expect(
      savedItemStatusLabel(savedSummary({ processing_status: 'error', processing_error: 'boom' })),
    ).toBe('Error: boom');
  });

  it('unwraps Next.js promise params on the saved item detail page', async () => {
    const source = await readFile(savedItemDetailPagePath, 'utf8');

    expect(source).toContain('use(params)');
    expect(source).not.toContain('params.id');
  });
});
