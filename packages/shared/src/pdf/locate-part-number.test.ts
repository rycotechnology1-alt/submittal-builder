import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { locatePartNumber, verifyPartNumbers } from './locate-part-number.js';

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

  it('tightly bounds a part number embedded in a wide paragraph text run', async () => {
    // Paragraph-style sheets render a whole line as one wide pdfjs text item, so
    // the located box must cover only the token, not the entire line.
    const paragraph =
      '2-inch Schedule 40 PVC pipe is offered in 1/2 in. (A52AA42), ' +
      '3/4 in. (A52BA42), 1 in. (A52CA42), 1-1/4 in. (A52DA42), and 2 in. (A52HA42).';
    const bytes = await pdfWithText([{ text: paragraph, x: 54, y: 521 }]);
    const match = await locatePartNumber(bytes, 1, 'A52CA42');
    expect(match).not.toBeNull();
    // Token only (~7 chars), not the multi-hundred-point paragraph line.
    expect(match!.width).toBeLessThan(60);
    // And positioned where the token actually sits, well past the line start.
    expect(match!.x).toBeGreaterThan(150);
  });
});

/** A one-page PDF with no text layer at all (e.g. a scanned image page). */
async function emptyPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe('verifyPartNumbers', () => {
  it('reports "found" when the part number is on the page', async () => {
    const bytes = await pdfWithText([
      { text: 'Spec sheet with assorted product content', x: 40, y: 700 },
      { text: '5335967', x: 200, y: 500 },
    ]);
    const statuses = await verifyPartNumbers(bytes, [{ partNumber: '5335967', pageNumber: 1 }]);
    expect(statuses).toEqual(['found']);
  });

  it('reports "absent" when the page has text but not that part number', async () => {
    const bytes = await pdfWithText([
      { text: 'Spec sheet with assorted product content', x: 40, y: 700 },
      { text: '5335967', x: 200, y: 500 },
    ]);
    // 5335867 is one digit off — a mis-extraction that is not on the page.
    const statuses = await verifyPartNumbers(bytes, [{ partNumber: '5335867', pageNumber: 1 }]);
    expect(statuses).toEqual(['absent']);
  });

  it('reports "unverifiable" when the page has no text layer', async () => {
    const bytes = await emptyPagePdf();
    const statuses = await verifyPartNumbers(bytes, [{ partNumber: '5335967', pageNumber: 1 }]);
    expect(statuses).toEqual(['unverifiable']);
  });

  it('verifies multiple targets across pages, aligned to input order', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]);
    p1.drawText('Page one filler content here', { x: 40, y: 700, size: 10, font });
    p1.drawText('AAA111', { x: 200, y: 500, size: 12, font });
    const p2 = doc.addPage([612, 792]);
    p2.drawText('Page two filler content here', { x: 40, y: 700, size: 10, font });
    p2.drawText('BBB222', { x: 200, y: 500, size: 12, font });
    const bytes = await doc.save();

    const statuses = await verifyPartNumbers(bytes, [
      { partNumber: 'BBB222', pageNumber: 2 },
      { partNumber: 'AAA111', pageNumber: 1 },
      { partNumber: 'AAA111', pageNumber: 2 },
    ]);
    expect(statuses).toEqual(['found', 'found', 'absent']);
  });
});
