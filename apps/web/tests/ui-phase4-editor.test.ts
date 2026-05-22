import { describe, expect, test } from 'vitest';

import {
  applyReorder,
  attributeNeedsReview,
  countItemsNeedingReview,
  LOW_CONFIDENCE_THRESHOLD,
} from '@/app/(dashboard)/packages/[id]/_components/editor/item-helpers';
import type { PackageItemResponse } from '@submittal/shared/api';

type Attribute = PackageItemResponse['attributes'][number];

function attribute(overrides: Partial<Attribute> = {}): Attribute {
  return {
    key: 'manufacturer',
    current_value: 'USG',
    original_ai_value: 'USG',
    confidence: 0.95,
    source_page_id: null,
    edited_by_user_at: null,
    ...overrides,
  };
}

function item(
  attributes: Attribute[],
  overrides: Partial<PackageItemResponse['item']> = {},
): PackageItemResponse {
  return {
    item: {
      id: 'item-' + Math.random().toString(36).slice(2, 10),
      package_id: 'pkg-1',
      doc_type: 'product_data',
      doc_type_confidence: 0.9,
      doc_type_original_ai_value: null,
      sort_order: 0,
      title: 'Sample item',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    },
    attributes,
    source_pdfs: [],
  };
}

describe('attributeNeedsReview', () => {
  test('returns true when confidence is below threshold and user has not edited', () => {
    expect(
      attributeNeedsReview(
        attribute({ confidence: LOW_CONFIDENCE_THRESHOLD - 0.01, edited_by_user_at: null }),
      ),
    ).toBe(true);
  });

  test('returns false once the user has edited the attribute', () => {
    expect(
      attributeNeedsReview(
        attribute({ confidence: 0.2, edited_by_user_at: '2026-05-22T12:00:00Z' }),
      ),
    ).toBe(false);
  });

  test('returns false when confidence is at or above the threshold', () => {
    expect(attributeNeedsReview(attribute({ confidence: LOW_CONFIDENCE_THRESHOLD }))).toBe(false);
    expect(attributeNeedsReview(attribute({ confidence: 0.9 }))).toBe(false);
  });

  test('returns false when confidence is null (no AI score recorded)', () => {
    expect(attributeNeedsReview(attribute({ confidence: null }))).toBe(false);
  });
});

describe('countItemsNeedingReview', () => {
  test('counts an item once if any attribute needs review', () => {
    const items = [
      item([
        attribute({ key: 'manufacturer', confidence: 0.9 }),
        attribute({ key: 'model_number', confidence: 0.4 }),
      ]),
      item([attribute({ key: 'manufacturer', confidence: 0.9 })]),
      item([
        attribute({ key: 'manufacturer', confidence: 0.3 }),
        attribute({ key: 'model_number', confidence: 0.2 }),
      ]),
    ];
    expect(countItemsNeedingReview(items)).toBe(2);
  });

  test('returns 0 for an empty list', () => {
    expect(countItemsNeedingReview([])).toBe(0);
  });
});

describe('applyReorder', () => {
  test('moves the source id to the index of the target id, preserving the rest', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    expect(applyReorder(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  test('returns the input unchanged when from and to are the same', () => {
    const ids = ['a', 'b', 'c'];
    expect(applyReorder(ids, 'b', 'b')).toEqual(['a', 'b', 'c']);
  });

  test('returns the input unchanged when either id is missing', () => {
    const ids = ['a', 'b', 'c'];
    expect(applyReorder(ids, 'x', 'b')).toEqual(ids);
    expect(applyReorder(ids, 'a', 'x')).toEqual(ids);
  });

  test('moves an item to the end when target is the last element', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(applyReorder(ids, 'a', 'd')).toEqual(['b', 'c', 'd', 'a']);
  });
});
