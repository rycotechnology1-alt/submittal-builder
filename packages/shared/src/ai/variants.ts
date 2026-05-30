import type { ExtractedVariant } from './anthropic.js';

export type ItemVariantSecondaryDims = {
  type?: string;
  packaging?: string;
  length?: string;
};

/** A normalized variant row ready to persist (sans itemId / sourcePageId). */
export type DerivedVariantRow = {
  partNumber: string;
  size: string;
  secondaryDims?: ItemVariantSecondaryDims;
  displayLabel: string;
  sortOrder: number;
  isDefaultForSize: boolean;
  sourcePage: number;
};

/** Parse a leading number out of a length label like "10'" → 10. */
function lengthValue(dims: ItemVariantSecondaryDims | undefined): number {
  const match = dims?.length?.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function hasAnyDim(dims: ItemVariantSecondaryDims): boolean {
  return Boolean(dims.type || dims.packaging || dims.length);
}

/** "1/2" + {type:"Schedule 40", length:"10'"}" → `1/2" – Schedule 40, 10'`. */
function composeLabel(size: string, dims: ItemVariantSecondaryDims | undefined): string {
  if (!dims) return size;
  const parts = [dims.type, dims.packaging, dims.length].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length ? `${size} – ${parts.join(', ')}` : size;
}

/**
 * Normalize the AI's extracted variants into rows ready for `item_variants`,
 * preserving order and electing one smart default per size group.
 *
 * Default rule: within a size group, prefer the shortest length, then fall back
 * to the first-listed variant (which naturally gives the first type / packaging).
 */
export function deriveVariantRows(variants: ExtractedVariant[]): DerivedVariantRow[] {
  const rows = variants.map((v, index): DerivedVariantRow => {
    const dims =
      v.secondary_dims && hasAnyDim(v.secondary_dims) ? { ...v.secondary_dims } : undefined;
    return {
      partNumber: v.part_number,
      size: v.size,
      secondaryDims: dims,
      displayLabel: composeLabel(v.size, dims),
      sortOrder: index,
      isDefaultForSize: false,
      sourcePage: v.source_page,
    };
  });

  // Elect one default per size group.
  const bySize = new Map<string, DerivedVariantRow[]>();
  for (const row of rows) {
    const group = bySize.get(row.size) ?? [];
    group.push(row);
    bySize.set(row.size, group);
  }
  for (const group of bySize.values()) {
    const winner = group
      .slice()
      .sort(
        (a, b) =>
          lengthValue(a.secondaryDims) - lengthValue(b.secondaryDims) || a.sortOrder - b.sortOrder,
      )[0]!;
    winner.isDefaultForSize = true;
  }

  return rows;
}
