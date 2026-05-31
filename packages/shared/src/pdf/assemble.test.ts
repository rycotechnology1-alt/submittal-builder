import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';

import { assembleSubmittalPdf, highlightRect } from './assemble.js';
import type { PartNumberMatch } from './locate-part-number.js';
import { parsePdfPages } from './parse.js';

async function makeFixturePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`fixture page ${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  return doc.save();
}

const FILLER =
  'Liquidtight Enviro-Flex Conduit specification sheet sample content used to clear the OCR text threshold during tests.';

/** A one-page PDF containing the given part number plus filler text. */
async function makePartNumberPdf(partNumber: string, rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (rotation) page.setRotation(degrees(rotation));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(FILLER, { x: 40, y: 720, size: 9, font });
  page.drawText(partNumber, { x: 220, y: 500, size: 12, font });
  return doc.save();
}

const baseCover = {
  workspaceName: 'Acme',
  subCompanyName: 'Acme',
  projectName: 'Test',
  submittalNumber: '26 05 00',
  specSection: '26 05 00',
  revision: 'R0',
  packageTitle: null,
};

describe('highlightRect', () => {
  const sample = (over: Partial<PartNumberMatch> = {}): PartNumberMatch => ({
    x: 100,
    y: 200,
    width: 50,
    height: 12,
    pageWidth: 612,
    pageHeight: 792,
    ...over,
  });

  it('pads the located bbox on all sides', () => {
    const r = highlightRect(sample(), 1.5);
    expect(r.x).toBeCloseTo(98.5);
    expect(r.y).toBeCloseTo(198.5);
    expect(r.width).toBeCloseTo(53);
    expect(r.height).toBeCloseTo(15);
  });

  it('clamps to the left and bottom edges without going negative', () => {
    const r = highlightRect(sample({ x: 0.5, y: 0.5 }), 1.5);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.x + r.width).toBeLessThanOrEqual(612);
    expect(r.y + r.height).toBeLessThanOrEqual(792);
  });

  it('clamps to the right and top edges within the page', () => {
    const r = highlightRect(sample({ x: 600, y: 780 }), 1.5);
    expect(r.x + r.width).toBeLessThanOrEqual(612);
    expect(r.y + r.height).toBeLessThanOrEqual(792);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('assembleSubmittalPdf', () => {
  it('produces cover + TOC + merged sources with bookmarks and Bates labels', async () => {
    const sourceA = await makeFixturePdf(3);
    const sourceB = await makeFixturePdf(2);
    const sourceC = await makeFixturePdf(1);

    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme Submittals',
        subCompanyName: 'Acme HVAC',
        projectName: 'Test Tower',
        submittalNumber: '23 81 00-001',
        specSection: '23 81 00',
        revision: 'R0',
        packageTitle: 'Test Package',
        logoBytes: null,
        logoContentType: null,
      },
      sources: [
        { bytes: sourceA, title: 'Daikin VRV Cut Sheet' },
        { bytes: sourceB, title: 'Hardie Warranty' },
        { bytes: sourceC, title: 'Woodwork Shop Drawing' },
      ],
      batesPrefix: 'SUB-',
    });

    // page count = cover (1) + toc (1) + 3 + 2 + 1 = 8
    expect(result.pageCount).toBe(8);
    expect(result.bookmarks).toEqual([
      { title: 'Daikin VRV Cut Sheet', pageNumber: 3 },
      { title: 'Hardie Warranty', pageNumber: 6 },
      { title: 'Woodwork Shop Drawing', pageNumber: 8 },
    ]);
    expect(result.batesRange).toEqual({ first: 'SUB-000001', last: 'SUB-000008' });
    expect(result.repairedSourceIndices).toEqual([]);

    // Re-parse the assembled PDF and verify the outline catalog entries.
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getPageCount()).toBe(8);
    const outlines = reopened.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines).toBeDefined();
  });

  it('invokes the repair fallback when pdf-lib cannot parse a source', async () => {
    const goodSource = await makeFixturePdf(1);
    const brokenSource = new TextEncoder().encode('not a valid pdf at all');
    const repairOutput = await makeFixturePdf(2);

    let repairCalls = 0;
    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme',
        subCompanyName: 'Acme',
        projectName: 'Test',
        submittalNumber: '00 00 00',
        specSection: '00 00 00',
        revision: 'R0',
        packageTitle: null,
      },
      sources: [
        { bytes: goodSource, title: 'Good Source' },
        {
          bytes: brokenSource,
          title: 'Broken Source',
          repair: async () => {
            repairCalls++;
            return repairOutput;
          },
        },
      ],
    });

    expect(repairCalls).toBe(1);
    expect(result.repairedSourceIndices).toEqual([1]);
    // cover + toc + 1 (good) + 2 (repaired) = 5
    expect(result.pageCount).toBe(5);
  });

  it('renders item metadata into the TOC table without breaking page math', async () => {
    const sourceA = await makeFixturePdf(2);
    const sourceB = await makeFixturePdf(1);

    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme',
        subCompanyName: 'Acme',
        projectName: 'Test',
        submittalNumber: '26 05 00',
        specSection: '26 05 00',
        revision: 'R0',
        packageTitle: null,
      },
      sources: [
        {
          bytes: sourceA,
          title: 'Item One',
          itemId: 'item-1',
          description: 'Rigid galvanized steel conduit, 3/4 in. trade size, threaded ends.',
          partNumber: 'RGS-075',
          manufacturer: 'Allied Tube',
        },
        {
          bytes: sourceB,
          title: 'Item Two',
          itemId: 'item-2',
          description: 'Type SO portable cord, 12 AWG, 3 conductor.',
          partNumber: 'SO-12-3',
          manufacturer: 'Southwire',
        },
      ],
    });

    // cover (1) + 1 toc + 2 + 1 = 5; single-page TOC keeps the original shift.
    expect(result.pageCount).toBe(5);
    expect(result.bookmarks).toEqual([
      { title: 'Item One', pageNumber: 3 },
      { title: 'Item Two', pageNumber: 5 },
    ]);

    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getPageCount()).toBe(5);
  });

  it('wraps long TOC part number lists without truncating selected values', async () => {
    const source = await makeFixturePdf(1);
    const partNumbers = Array.from(
      { length: 24 },
      (_, i) => `PN-${String(i + 1).padStart(4, '0')}`,
    );

    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme',
        subCompanyName: 'Acme',
        projectName: 'Test',
        submittalNumber: '26 05 00',
        specSection: '26 05 00',
        revision: 'R0',
        packageTitle: null,
      },
      sources: [
        {
          bytes: source,
          title: 'Multi-size Item',
          itemId: 'item-1',
          description: 'Conduit with multiple submitted sizes.',
          partNumber: partNumbers.join(', '),
          manufacturer: 'CANTEX',
        },
      ],
    });

    const parsed = await parsePdfPages(result.bytes);
    const text = parsed.pages.map((page) => page.text ?? '').join(' ');
    for (const partNumber of partNumbers) {
      expect(text).toContain(partNumber);
    }
    expect(text).not.toContain('...');
    expect(text).not.toContain('…');
  });

  it('splits an oversized TOC part number row across pages and preserves page math', async () => {
    const source = await makeFixturePdf(1);
    const partNumbers = Array.from(
      { length: 180 },
      (_, i) => `PN-${String(i + 1).padStart(4, '0')}`,
    );

    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme',
        subCompanyName: 'Acme',
        projectName: 'Test',
        submittalNumber: '26 05 00',
        specSection: '26 05 00',
        revision: 'R0',
        packageTitle: null,
      },
      sources: [
        {
          bytes: source,
          title: 'Oversized Multi-size Item',
          itemId: 'item-1',
          description:
            'A submitted product with more selected part numbers than fit on one TOC page.',
          partNumber: partNumbers.join(', '),
          manufacturer: 'CANTEX',
        },
        {
          bytes: source,
          title: 'Following Item',
          itemId: 'item-2',
          description: 'The item after the oversized TOC row.',
          partNumber: 'FOLLOW-001',
          manufacturer: 'Acme',
        },
      ],
    });

    const tocPageCount = result.pageCount - 1 - 2;
    expect(tocPageCount).toBeGreaterThan(1);
    expect(result.bookmarks).toEqual([
      { title: 'Oversized Multi-size Item', pageNumber: tocPageCount + 2 },
      { title: 'Following Item', pageNumber: tocPageCount + 3 },
    ]);
    expect(result.bookmarks[1]!.pageNumber).toBe(result.pageCount);

    const parsed = await parsePdfPages(result.bytes);
    const text = parsed.pages.map((page) => page.text ?? '').join(' ');
    expect(text).toContain(partNumbers[0]);
    expect(text).toContain(partNumbers[partNumbers.length - 1]);
  });

  it('paginates the TOC across multiple pages and shifts page numbers by the TOC page count', async () => {
    const onePage = await makeFixturePdf(1);
    const count = 60;
    const sources = Array.from({ length: count }, (_, i) => ({
      bytes: onePage,
      title: `Item ${i + 1}`,
      itemId: `item-${i + 1}`,
      description: `Product number ${i + 1} with assorted identifying specifications and ratings.`,
      partNumber: `PN-${i + 1}`,
      manufacturer: `Maker ${i + 1}`,
    }));

    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme',
        subCompanyName: 'Acme',
        projectName: 'Test',
        submittalNumber: '26 05 00',
        specSection: '26 05 00',
        revision: 'R0',
        packageTitle: null,
      },
      sources,
    });

    // pageCount = cover (1) + T toc pages + count source pages.
    const tocPageCount = result.pageCount - 1 - count;
    expect(tocPageCount).toBeGreaterThan(1);

    // Each source k starts at index (1 + k) before TOC insertion, so its
    // bookmark lands at (1 + k) + T + 1.
    result.bookmarks.forEach((entry, k) => {
      expect(entry.pageNumber).toBe(1 + k + tocPageCount + 1);
    });
    // The last item must land on the final page of the document.
    expect(result.bookmarks[count - 1]!.pageNumber).toBe(result.pageCount);
  });

  it('renders the cover letterhead header with a logo + full address/contact', async () => {
    // 1x1 PNG — exercises the embed path + dynamic header layout. The fit logic
    // scales it into the logo box, pushing the body below the header.
    const logoBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const source = await makeFixturePdf(1);

    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme Submittals',
        subCompanyName: 'Acme HVAC',
        projectName: 'Test Tower',
        submittalNumber: '23 81 00-001',
        specSection: '23 81 00',
        revision: 'R0',
        packageTitle: 'Test Package',
        logoBytes,
        logoContentType: 'image/png',
        addressStreet: '123 Main St',
        addressCity: 'Austin',
        addressState: 'TX',
        addressZip: '78701',
        contactPhone: '512-555-0100',
        contactEmail: 'hi@acme.com',
        contactWebsite: 'acme.com',
      },
      sources: [{ bytes: source, title: 'Only Source' }],
    });

    // cover (1) + toc (1) + 1 source = 3; header rendering must not throw.
    expect(result.pageCount).toBe(3);
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getPageCount()).toBe(3);
  });

  it('highlights the located part number without drawing a label', async () => {
    const source = await makePartNumberPdf('V06BAA1');
    const result = await assembleSubmittalPdf({
      cover: baseCover,
      sources: [
        {
          bytes: source,
          title: 'Enviro-Flex',
          itemId: 'item-1',
          selectedVariants: [{ partNumber: 'V06BAA1', label: '1/2"', sourcePage: 1 }],
        },
      ],
    });

    // cover + toc + 1 source page = 3; the source page is index 2.
    const parsed = await parsePdfPages(result.bytes);
    const sourceText = parsed.pages[2]!.text ?? '';
    // The highlight draws no on-page text — the part number lives only in the
    // TOC; neither the size label nor a fallback stamp should appear.
    expect(sourceText).not.toContain('SUBMITTED');
    expect(sourceText).not.toContain('1/2');
  });

  it('highlights the located part number even on a rotated page', async () => {
    const source = await makePartNumberPdf('V06BAA1', 90);
    const result = await assembleSubmittalPdf({
      cover: baseCover,
      sources: [
        {
          bytes: source,
          title: 'Enviro-Flex',
          itemId: 'item-1',
          selectedVariants: [{ partNumber: 'V06BAA1', label: '1/2"', sourcePage: 1 }],
        },
      ],
    });

    const parsed = await parsePdfPages(result.bytes);
    const sourceText = parsed.pages[2]!.text ?? '';
    // Highlight only — no label, no fallback stamp on a located (rotated) page.
    expect(sourceText).not.toContain('1/2');
    expect(sourceText).not.toContain('SUBMITTED');
  });

  it('stamps a fallback banner when the part number cannot be located', async () => {
    const source = await makePartNumberPdf('V06BAA1');
    const result = await assembleSubmittalPdf({
      cover: baseCover,
      sources: [
        {
          bytes: source,
          title: 'Enviro-Flex',
          itemId: 'item-1',
          // This part number is absent from the page ⇒ fallback stamp.
          selectedVariants: [{ partNumber: 'V06ZZZ9', label: '2" – Coil', sourcePage: 1 }],
        },
      ],
    });

    const parsed = await parsePdfPages(result.bytes);
    const sourceText = parsed.pages[2]!.text ?? '';
    expect(sourceText).toContain('SUBMITTED');
    expect(sourceText).toContain('V06ZZZ9');
  });

  it('stamps an un-locatable selected part number even when verification flagged it absent', async () => {
    const source = await makePartNumberPdf('5335967');
    const result = await assembleSubmittalPdf({
      cover: baseCover,
      sources: [
        {
          bytes: source,
          title: 'Base Spacer',
          itemId: 'item-1',
          // Mis-extracted SKU (one digit off) with no size to anchor recovery:
          // the user still selected it, so the page-1 fallback stamp must appear.
          selectedVariants: [
            { partNumber: '5335867', label: '4 x 2', sourcePage: 1, verificationStatus: 'absent' },
          ],
        },
      ],
    });

    const parsed = await parsePdfPages(result.bytes);
    const sourceText = parsed.pages[2]!.text ?? '';
    expect(sourceText).toContain('SUBMITTED');
    expect(sourceText).toContain('5335867');
  });

  it('highlights via the selected size when the part number was mis-extracted', async () => {
    // The page lists SKUs beside their trade sizes. The selected variant's part
    // number is wrong, but its size ("4 x 2") uniquely anchors the correct row,
    // so the assembler highlights the located token instead of stamping.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(FILLER, { x: 40, y: 720, size: 9, font });
    page.drawText('5335971 4 x 1 80', { x: 60, y: 520, size: 12, font });
    page.drawText('5335967 4 x 2 70', { x: 60, y: 500, size: 12, font });
    const source = await doc.save();

    const result = await assembleSubmittalPdf({
      cover: baseCover,
      sources: [
        {
          bytes: source,
          title: 'Base Spacer',
          itemId: 'item-1',
          selectedVariants: [
            {
              partNumber: '5335867',
              label: '4 x 2',
              sourcePage: 1,
              size: '4 x 2',
              verificationStatus: 'absent',
            },
          ],
        },
      ],
    });

    const parsed = await parsePdfPages(result.bytes);
    const sourceText = parsed.pages[2]!.text ?? '';
    // Recovered via size ⇒ highlight only, no fallback stamp.
    expect(sourceText).not.toContain('SUBMITTED');
  });

  it('still stamps an unverifiable part number (scanned page, no text layer)', async () => {
    const source = await makePartNumberPdf('5335967');
    const result = await assembleSubmittalPdf({
      cover: baseCover,
      sources: [
        {
          bytes: source,
          title: 'Base Spacer',
          itemId: 'item-1',
          selectedVariants: [
            {
              partNumber: '5335867',
              label: '4 x 2',
              sourcePage: 1,
              verificationStatus: 'unverifiable',
            },
          ],
        },
      ],
    });

    const parsed = await parsePdfPages(result.bytes);
    const sourceText = parsed.pages[2]!.text ?? '';
    // Could not verify ⇒ keep the stamp fallback.
    expect(sourceText).toContain('SUBMITTED');
    expect(sourceText).toContain('5335867');
  });

  it('handles a zero-source export with cover + toc only', async () => {
    const result = await assembleSubmittalPdf({
      cover: {
        workspaceName: 'Acme',
        subCompanyName: 'Acme',
        projectName: 'Test',
        submittalNumber: '00 00 00',
        specSection: '00 00 00',
        revision: 'R0',
        packageTitle: null,
      },
      sources: [],
    });

    // Even with no sources, the cover and TOC pages exist.
    expect(result.pageCount).toBe(2);
    expect(result.bookmarks).toEqual([]);
  });
});
