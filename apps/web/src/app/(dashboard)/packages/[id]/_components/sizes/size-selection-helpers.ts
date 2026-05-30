import type { ItemVariantResponse, PackageItemResponse } from '@submittal/shared/api';

export function canInitializeSizeSelectionQueue({
  isSuccess,
  isFetching,
}: {
  isSuccess: boolean;
  isFetching: boolean;
}): boolean {
  return isSuccess && !isFetching;
}

export function needsSizeSelection(item: PackageItemResponse): boolean {
  return item.variants.length > 1 && item.selected_part_numbers.length === 0;
}

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
