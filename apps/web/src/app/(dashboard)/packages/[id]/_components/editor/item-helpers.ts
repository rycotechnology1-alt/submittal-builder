import type { PackageItemResponse } from '@submittal/shared/api';

export const LOW_CONFIDENCE_THRESHOLD = 0.7;

type Attribute = PackageItemResponse['attributes'][number];

export function attributeNeedsReview(attr: Attribute): boolean {
  if (attr.edited_by_user_at) return false;
  if (attr.confidence == null) return false;
  return attr.confidence < LOW_CONFIDENCE_THRESHOLD;
}

export function itemNeedsReview(item: PackageItemResponse): boolean {
  return item.attributes.some(attributeNeedsReview);
}

export function countItemsNeedingReview(items: PackageItemResponse[]): number {
  let n = 0;
  for (const item of items) {
    if (itemNeedsReview(item)) n += 1;
  }
  return n;
}

export function applyReorder<T extends string>(ids: T[], fromId: T, toId: T): T[] {
  if (fromId === toId) return ids;
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex === -1 || toIndex === -1) return ids;
  const next = ids.slice();
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, fromId);
  return next;
}
