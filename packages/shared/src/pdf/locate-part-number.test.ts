import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { locatePartNumber } from './locate-part-number.js';

async function pdfWithText(
  entries: { text: string; x: number; y: number }[],
  rotation = 0,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (rotation) page.setRotation(degrees(rotation));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const e of entries) {
    page.drawText(e.text, { x: e.x, y: e.y, size: 12, font });
  }
  return doc.save();
}

describe('locatePartNumber', () => {
  it('returns the bounding box of a part number in unrotated user space', async () => {
    const bytes = await pdfWithText([{ text: 'V06BAA1', x: 200, y: 500 }]);
    const match = await locatePartNumber(bytes, 1, 'V06BAA1');
    expect(match).not.toBeNull();
    expect(match!.x).toBeGreaterThan(190);
    expect(match!.x).toBeLessThan(210);
    expect(match!.y).toBeGreaterThan(490);
    expect(match!.y).toBeLessThan(510);
    expect(match!.width).toBeGreaterThan(20);
    expect(match!.pageWidth).toBeCloseTo(612, 0);
    expect(match!.pageHeight).toBeCloseTo(792, 0);
  });

  it('locates a part number even when the page is rotated', async () => {
    const bytes = await pdfWithText([{ text: 'V06BAA1', x: 200, y: 500 }], 90);
    const match = await locatePartNumber(bytes, 1, 'V06BAA1');
    // Coordinates are content-space, so rotation does not move them.
    expect(match).not.toBeNull();
    expect(match!.x).toBeGreaterThan(190);
    expect(match!.x).toBeLessThan(210);
  });

  it('returns null when the part number is absent', async () => {
    const bytes = await pdfWithText([{ text: 'V06BAA1', x: 200, y: 500 }]);
    expect(await locatePartNumber(bytes, 1, 'NOPE99')).toBeNull();
  });

  it('returns null when the part number appears on more than one line (ambiguous)', async () => {
    const bytes = await pdfWithText([
      { text: 'V06BAA1', x: 200, y: 500 },
      { text: 'V06BAA1', x: 200, y: 300 },
    ]);
    expect(await locatePartNumber(bytes, 1, 'V06BAA1')).toBeNull();
  });
});
