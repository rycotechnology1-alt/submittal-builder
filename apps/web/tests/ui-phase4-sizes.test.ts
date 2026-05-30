import { describe, expect, it } from 'vitest';

import type { ItemVariantResponse } from '@submittal/shared/api';

import { partNumberWarning } from '@/app/(dashboard)/packages/[id]/_components/sizes/size-selection-helpers';

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
