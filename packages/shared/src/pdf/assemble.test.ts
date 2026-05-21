import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';

import { assembleSubmittalPdf } from './assemble.js';

async function makeFixturePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`fixture page ${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  return doc.save();
}

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
