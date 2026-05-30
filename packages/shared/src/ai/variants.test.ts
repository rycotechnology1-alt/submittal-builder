import { describe, expect, it } from 'vitest';

import { deriveVariantRows } from './variants.js';

describe('deriveVariantRows', () => {
  it('returns empty for no variants', () => {
    expect(deriveVariantRows([])).toEqual([]);
  });

  it('keeps input order as sortOrder and uses size as label when no secondary dims', () => {
    const rows = deriveVariantRows([
      { part_number: 'A', size: '1/2"', source_page: 1 },
      { part_number: 'B', size: '3/4"', source_page: 1 },
    ]);
    expect(rows.map((r) => [r.sortOrder, r.partNumber, r.displayLabel])).toEqual([
      [0, 'A', '1/2"'],
      [1, 'B', '3/4"'],
    ]);
    // single variant per size ⇒ each is its own default
    expect(rows.every((r) => r.isDefaultForSize)).toBe(true);
  });

  it('composes a display label from secondary dimensions', () => {
    const row = deriveVariantRows([
      {
        part_number: 'A52AE12',
        size: '1/2"',
        secondary_dims: { type: 'Schedule 40', length: "10'" },
        source_page: 1,
      },
    ])[0]!;
    expect(row.displayLabel).toBe('1/2" – Schedule 40, 10\'');
    expect(row.secondaryDims).toEqual({ type: 'Schedule 40', length: "10'" });
  });

  it('marks exactly one default per size group, preferring the shortest length', () => {
    const rows = deriveVariantRows([
      { part_number: 'LONG', size: '1/2"', secondary_dims: { length: "20'" }, source_page: 1 },
      { part_number: 'SHORT', size: '1/2"', secondary_dims: { length: "10'" }, source_page: 1 },
    ]);
    const defaults = rows.filter((r) => r.isDefaultForSize);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.partNumber).toBe('SHORT');
  });

  it('falls back to first-listed within a size when lengths are equal/absent', () => {
    const rows = deriveVariantRows([
      { part_number: 'COIL', size: '1/2"', secondary_dims: { packaging: 'Coil' }, source_page: 1 },
      { part_number: 'REEL', size: '1/2"', secondary_dims: { packaging: 'Reel' }, source_page: 2 },
    ]);
    const def = rows.find((r) => r.isDefaultForSize);
    expect(def!.partNumber).toBe('COIL');
    // both belong to the same size group
    expect(rows.filter((r) => r.size === '1/2"')).toHaveLength(2);
  });

  it('normalizes null secondary dims to undefined', () => {
    const row = deriveVariantRows([
      { part_number: 'A', size: '1"', secondary_dims: null, source_page: 1 },
    ])[0]!;
    expect(row.secondaryDims).toBeUndefined();
    expect(row.displayLabel).toBe('1"');
  });
});
