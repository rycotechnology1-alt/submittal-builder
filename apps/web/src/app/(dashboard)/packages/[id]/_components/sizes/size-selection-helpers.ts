import type { ItemVariantResponse } from '@submittal/shared/api';

/**
 * Advisory warning for a variant whose part number could not be found in its
 * source page's text layer (`absent`) — a likely AI mis-extraction the user
 * should double-check before submitting. Returns null for `found`, the
 * un-checkable `unverifiable` (scanned) case, and unknown (`null`) status.
 */
export function partNumberWarning(variant: ItemVariantResponse): string | null {
  if (variant.part_number_verification === 'absent') {
    return "This part number wasn't found on the source page — double-check it.";
  }
  return null;
}
