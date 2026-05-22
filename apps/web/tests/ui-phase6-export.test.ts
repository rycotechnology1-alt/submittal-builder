import { describe, expect, test } from 'vitest';

import type { PackageItemResponse } from '@submittal/shared/api';

import {
  BATES_PREFIX_MAX_LENGTH,
  computeExportBlockers,
  defaultBatesPrefix,
  formatBytes,
  formatRelativeTime,
  summarizeExport,
  validateBatesPrefix,
} from '@/app/(dashboard)/packages/[id]/_components/editor/export-helpers';

const baseItem = (overrides: Partial<PackageItemResponse> = {}): PackageItemResponse => ({
  item: {
    id: overrides.item?.id ?? 'item-1',
    package_id: 'pkg-1',
    doc_type: 'product_data',
    doc_type_confidence: 0.9,
    doc_type_original_ai_value: null,
    sort_order: 0,
    title: 'Item',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...(overrides.item ?? {}),
  },
  attributes: overrides.attributes ?? [
    { key: 'manufacturer', current_value: 'Acme', original_ai_value: 'Acme', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
    { key: 'model_number', current_value: 'AC-1', original_ai_value: 'AC-1', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
    { key: 'description', current_value: 'desc', original_ai_value: 'desc', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
  ],
  source_pdfs: overrides.source_pdfs ?? [
    { id: 'pdf-1', original_filename: 'a.pdf', page_count: 10 },
  ],
});

describe('computeExportBlockers', () => {
  test('flags empty item list as a hard blocker', () => {
    const { hardBlockers, warnings } = computeExportBlockers([]);
    expect(hardBlockers).toHaveLength(1);
    expect(hardBlockers[0]).toMatch(/no items/i);
    expect(warnings).toHaveLength(0);
  });

  test('flags items without source PDFs as a hard blocker', () => {
    const items = [
      baseItem({ item: { id: 'item-1' } as PackageItemResponse['item'], source_pdfs: [] }),
    ];
    const { hardBlockers } = computeExportBlockers(items);
    expect(hardBlockers).toHaveLength(1);
    expect(hardBlockers[0]).toMatch(/source PDFs/);
  });

  test('returns no blockers when all items have sources', () => {
    const items = [baseItem()];
    const { hardBlockers } = computeExportBlockers(items);
    expect(hardBlockers).toHaveLength(0);
  });

  test('flags low-confidence unreviewed attributes as a warning', () => {
    const items = [
      baseItem({
        attributes: [
          { key: 'manufacturer', current_value: 'Acme', original_ai_value: 'Acme', confidence: 0.3, source_page_id: null, edited_by_user_at: null },
          { key: 'model_number', current_value: 'AC-1', original_ai_value: 'AC-1', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
          { key: 'description', current_value: 'desc', original_ai_value: 'desc', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
        ],
      }),
    ];
    const { warnings } = computeExportBlockers(items);
    const lowConf = warnings.find((w) => w.kind === 'low_confidence');
    expect(lowConf).toBeDefined();
    expect(lowConf?.itemCount).toBe(1);
    expect(lowConf?.firstItemId).toBe('item-1');
  });

  test('does not warn when the low-confidence attribute was edited by the user', () => {
    const items = [
      baseItem({
        attributes: [
          { key: 'manufacturer', current_value: 'Acme', original_ai_value: 'Acme', confidence: 0.3, source_page_id: null, edited_by_user_at: '2026-01-02T00:00:00.000Z' },
          { key: 'model_number', current_value: 'AC-1', original_ai_value: 'AC-1', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
          { key: 'description', current_value: 'desc', original_ai_value: 'desc', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
        ],
      }),
    ];
    const { warnings } = computeExportBlockers(items);
    expect(warnings.find((w) => w.kind === 'low_confidence')).toBeUndefined();
  });

  test('flags missing common attributes as a warning', () => {
    const items = [
      baseItem({
        attributes: [
          { key: 'manufacturer', current_value: 'Acme', original_ai_value: 'Acme', confidence: 0.95, source_page_id: null, edited_by_user_at: null },
        ],
      }),
    ];
    const { warnings } = computeExportBlockers(items);
    const missing = warnings.find((w) => w.kind === 'missing_attributes');
    expect(missing).toBeDefined();
    expect(missing?.itemCount).toBe(1);
  });

  test('does not flag missing attribute when it has any non-empty value', () => {
    const items = [baseItem()];
    const { warnings } = computeExportBlockers(items);
    expect(warnings.find((w) => w.kind === 'missing_attributes')).toBeUndefined();
  });
});

describe('summarizeExport', () => {
  test('counts items and source pages', () => {
    const items = [
      baseItem({ item: { id: 'a' } as PackageItemResponse['item'], source_pdfs: [{ id: 'pdf-1', original_filename: 'a.pdf', page_count: 10 }] }),
      baseItem({ item: { id: 'b' } as PackageItemResponse['item'], source_pdfs: [{ id: 'pdf-2', original_filename: 'b.pdf', page_count: 5 }] }),
    ];
    expect(summarizeExport(items)).toEqual({ itemCount: 2, sourcePageCount: 15 });
  });

  test('dedupes pages from source PDFs referenced by multiple items', () => {
    const shared = { id: 'pdf-shared', original_filename: 'shared.pdf', page_count: 8 };
    const items = [
      baseItem({ item: { id: 'a' } as PackageItemResponse['item'], source_pdfs: [shared] }),
      baseItem({ item: { id: 'b' } as PackageItemResponse['item'], source_pdfs: [shared] }),
    ];
    expect(summarizeExport(items).sourcePageCount).toBe(8);
  });

  test('treats null page_count as zero', () => {
    const items = [
      baseItem({ source_pdfs: [{ id: 'p', original_filename: 'p.pdf', page_count: null }] }),
    ];
    expect(summarizeExport(items).sourcePageCount).toBe(0);
  });
});

describe('defaultBatesPrefix', () => {
  test('joins submittal and revision with sanitized characters', () => {
    expect(defaultBatesPrefix({ submittal_number: '09 51 13-002', revision: 'R1' })).toBe('09-51-13-002-R1-');
  });

  test('respects the 16-character cap', () => {
    const out = defaultBatesPrefix({ submittal_number: 'very-long-submittal-number', revision: 'R99' });
    expect(out.length).toBeLessThanOrEqual(BATES_PREFIX_MAX_LENGTH);
    expect(out.endsWith('-')).toBe(true);
  });

  test('returns empty string when nothing usable', () => {
    expect(defaultBatesPrefix({ submittal_number: '', revision: '' })).toBe('');
  });
});

describe('validateBatesPrefix', () => {
  test('empty string is valid and resolves to null', () => {
    expect(validateBatesPrefix('')).toEqual({ ok: true, value: null });
    expect(validateBatesPrefix('   ')).toEqual({ ok: true, value: null });
  });

  test('trims and accepts valid characters', () => {
    expect(validateBatesPrefix('  09-51-13-  ')).toEqual({ ok: true, value: '09-51-13-' });
  });

  test('rejects invalid characters', () => {
    const result = validateBatesPrefix('bad!');
    expect(result.ok).toBe(false);
  });

  test('rejects strings over 16 characters', () => {
    const result = validateBatesPrefix('a'.repeat(17));
    expect(result.ok).toBe(false);
  });
});

describe('formatBytes', () => {
  test('returns em-dash for null or zero', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(0)).toBe('—');
  });

  test('renders KB and MB', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(12_400_000)).toBe('11.8 MB');
  });
});

describe('formatRelativeTime', () => {
  test('returns "just now" for very recent timestamps', () => {
    const iso = new Date(Date.now() - 5_000).toISOString();
    expect(formatRelativeTime(iso)).toBe('just now');
  });

  test('returns minutes for sub-hour intervals', () => {
    const iso = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatRelativeTime(iso)).toBe('10m ago');
  });
});
