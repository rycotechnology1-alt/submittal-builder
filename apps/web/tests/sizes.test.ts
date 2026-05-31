import { describe, expect, it } from 'vitest';

import type { ItemVariantResponse, PackageItemResponse } from '@submittal/shared/api';

import {
  canInitializeSizeSelectionQueue,
  needsSizeSelection,
  partNumberWarning,
} from '@/app/(dashboard)/packages/[id]/_components/sizes/size-selection-helpers';

const variant = (over: Partial<ItemVariantResponse> = {}): ItemVariantResponse => ({
  id: '00000000-0000-0000-0000-000000000001',
  part_number: '5335967',
  size: '4 x 2',
  secondary_dims: null,
  display_label: '4 x 2',
  sort_order: 0,
  is_default_for_size: true,
  selected: false,
  source_page_id: null,
  part_number_verification: 'found',
  ...over,
});

describe('partNumberWarning', () => {
  it('warns when the part number was not found on the source page', () => {
    const warning = partNumberWarning(variant({ part_number_verification: 'absent' }));
    expect(warning).toBeTruthy();
    expect(warning).toMatch(/wasn't found|not found/i);
  });

  it('does not warn when the part number was found', () => {
    expect(partNumberWarning(variant({ part_number_verification: 'found' }))).toBeNull();
  });

  it('does not warn when the page could not be verified (scanned)', () => {
    expect(partNumberWarning(variant({ part_number_verification: 'unverifiable' }))).toBeNull();
  });

  it('does not warn when verification is unknown (null)', () => {
    expect(partNumberWarning(variant({ part_number_verification: null }))).toBeNull();
  });
});

function packageItem(overrides: Partial<PackageItemResponse> = {}): PackageItemResponse {
  return {
    item: {
      id: '00000000-0000-0000-0000-000000000101',
      package_id: '00000000-0000-0000-0000-000000000201',
      doc_type: 'product_data',
      doc_type_confidence: 0.9,
      doc_type_original_ai_value: null,
      sort_order: 0,
      title: 'Conduit cut sheet',
      created_at: '2026-05-30T00:00:00.000Z',
      updated_at: '2026-05-30T00:00:00.000Z',
    },
    attributes: [],
    source_pdfs: [],
    variants: [],
    selected_part_numbers: [],
    ...overrides,
  };
}

describe('needsSizeSelection', () => {
  it('returns true when an item has multiple variants and no selected part numbers', () => {
    expect(
      needsSizeSelection(
        packageItem({
          variants: [variant(), variant({ id: '00000000-0000-0000-0000-000000000002' })],
        }),
      ),
    ).toBe(true);
  });

  it('returns false when a multi-variant item already has a selected part number', () => {
    expect(
      needsSizeSelection(
        packageItem({
          variants: [variant(), variant({ id: '00000000-0000-0000-0000-000000000002' })],
          selected_part_numbers: ['5335967'],
        }),
      ),
    ).toBe(false);
  });

  it('returns false when an item has zero or one variant', () => {
    expect(needsSizeSelection(packageItem({ variants: [] }))).toBe(false);
    expect(needsSizeSelection(packageItem({ variants: [variant()] }))).toBe(false);
  });
});

describe('canInitializeSizeSelectionQueue', () => {
  it('returns false while a successful query is still fetching fresh data', () => {
    expect(canInitializeSizeSelectionQueue({ isSuccess: true, isFetching: true })).toBe(false);
  });

  it('returns true once a successful query is not fetching', () => {
    expect(canInitializeSizeSelectionQueue({ isSuccess: true, isFetching: false })).toBe(true);
  });

  it('returns false before the query succeeds', () => {
    expect(canInitializeSizeSelectionQueue({ isSuccess: false, isFetching: false })).toBe(false);
  });
});
