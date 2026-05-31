import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { locateBySize, reconcilePartNumbers } from './locate-part-number.js';

// Real CANTEX spec sheet. Its text layer is clean; the trade-size column shares a
// line with each SKU. On page 2 the row reads: "5335967 4 x 2 70 5.938 ...".
// The AI mis-reads 5335967 as 5335867 (one digit off), which is genuinely absent.
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  here,
  '../../../../spikes/fixtures/CANTEX_Improved_Base_Spacer_reduced.pdf',
);
const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
const SKU_PAGE = 2;

describe('locateBySize (real CANTEX fixture)', () => {
  it('recovers the true SKU 5335967 from size "4 x 2" when the AI mis-read it', async () => {
    const result = await locateBySize(fixtureBytes, SKU_PAGE, {
      partNumber: '5335867',
      size: '4 x 2',
    });
    expect(result).not.toBeNull();
    expect(result!.correctedPartNumber).toBe('5335967');
  });
});

describe('reconcilePartNumbers (real CANTEX fixture)', () => {
  it('corrects a mis-extracted SKU using the trade size', async () => {
    const [result] = await reconcilePartNumbers(fixtureBytes, [
      { partNumber: '5335867', size: '4 x 2', pageNumber: SKU_PAGE },
    ]);
    expect(result).toEqual({ status: 'found', partNumber: '5335967', corrected: true });
  });

  it('leaves an already-correct SKU untouched', async () => {
    const [result] = await reconcilePartNumbers(fixtureBytes, [
      { partNumber: '5335967', size: '4 x 2', pageNumber: SKU_PAGE },
    ]);
    expect(result).toEqual({ status: 'found', partNumber: '5335967', corrected: false });
  });

  it('does not invent a correction when nothing on the page is close', async () => {
    const [result] = await reconcilePartNumbers(fixtureBytes, [
      { partNumber: 'ZZZZZZ', size: '99 x 99', pageNumber: SKU_PAGE },
    ]);
    expect(result).toEqual({ status: 'absent', partNumber: 'ZZZZZZ', corrected: false });
  });
});
