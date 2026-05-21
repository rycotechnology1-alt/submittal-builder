// Assemble a submittal export PDF: cover sheet + table of contents + source
// PDFs merged by reference + bookmarks + Bates stamping.
//
// Pages from source PDFs are copied via pdf-lib's `copyPages` and are not
// re-encoded — original page content streams are preserved so SHA-256 of any
// individual source page byte stream is identical to the input.
//
// The bookmark/outline construction uses pdf-lib's low-level context because
// the library has no high-level outline API.

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const BATES_DIGITS = 6;

export type AssembleSourcePdf = {
  /** Original PDF bytes. */
  bytes: Uint8Array;
  /** Bookmark title — typically the item title. */
  title: string;
  /** Optional path through a repair tool if pdf-lib chokes. */
  repair?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

export type CoverMetadata = {
  workspaceName: string;
  subCompanyName: string;
  projectName: string;
  submittalNumber: string;
  specSection: string;
  revision: string;
  packageTitle: string | null;
  /** Optional cover logo as PNG or JPEG bytes. */
  logoBytes?: Uint8Array | null;
  logoContentType?: 'image/png' | 'image/jpeg' | null;
};

export type AssembleInput = {
  cover: CoverMetadata;
  /** Sources in the desired output order. */
  sources: AssembleSourcePdf[];
  /** Prefix for Bates stamping (e.g. "SUB-"). Defaults to empty string. */
  batesPrefix?: string;
};

export type AssembledBookmark = {
  title: string;
  pageNumber: number;
};

export type AssembleResult = {
  bytes: Uint8Array;
  pageCount: number;
  bookmarks: AssembledBookmark[];
  batesRange: { first: string; last: string };
  repairedSourceIndices: number[];
};

function batesLabel(prefix: string, page: number): string {
  return `${prefix}${String(page).padStart(BATES_DIGITS, '0')}`;
}

async function loadSourceDoc(source: AssembleSourcePdf): Promise<{
  doc: PDFDocument;
  repaired: boolean;
}> {
  try {
    const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    return { doc, repaired: false };
  } catch (err) {
    if (!source.repair) throw err;
    const repaired = await source.repair(source.bytes);
    const doc = await PDFDocument.load(repaired, { ignoreEncryption: true });
    return { doc, repaired: true };
  }
}

export async function assembleSubmittalPdf(input: AssembleInput): Promise<AssembleResult> {
  const batesPrefix = input.batesPrefix ?? '';
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const fontBold = await out.embedFont(StandardFonts.HelveticaBold);

  // 1. Cover sheet (page 1). We add a placeholder; TOC will be inserted as
  //    page 2 once we know section starts.
  const cover = out.addPage([PAGE_W, PAGE_H]);
  if (input.cover.logoBytes && input.cover.logoContentType) {
    try {
      const image =
        input.cover.logoContentType === 'image/png'
          ? await out.embedPng(input.cover.logoBytes)
          : await out.embedJpg(input.cover.logoBytes);
      const targetWidth = 180;
      const scale = targetWidth / image.width;
      const targetHeight = image.height * scale;
      cover.drawImage(image, {
        x: 72,
        y: PAGE_H - 72 - targetHeight,
        width: targetWidth,
        height: targetHeight,
      });
    } catch {
      // logo failures are non-fatal; continue without it.
    }
  }
  cover.drawText('SUBMITTAL PACKAGE', {
    x: 72,
    y: PAGE_H - 220,
    size: 26,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  cover.drawText(input.cover.packageTitle ?? input.cover.submittalNumber, {
    x: 72,
    y: PAGE_H - 252,
    size: 14,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  let coverY = PAGE_H - 320;
  const drawRow = (label: string, value: string) => {
    cover.drawText(label, { x: 72, y: coverY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    cover.drawText(value, { x: 220, y: coverY, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    coverY -= 22;
  };
  drawRow('Submittal #:', input.cover.submittalNumber);
  drawRow('Spec section:', input.cover.specSection);
  drawRow('Revision:', input.cover.revision);
  drawRow('Project:', input.cover.projectName);
  drawRow('Subcontractor:', input.cover.subCompanyName);
  drawRow('Workspace:', input.cover.workspaceName);
  drawRow('Generated:', new Date().toISOString().slice(0, 10));

  // Approval stamp box.
  coverY -= 24;
  cover.drawRectangle({
    x: 72,
    y: coverY - 110,
    width: PAGE_W - 144,
    height: 110,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 0.5,
  });
  cover.drawText('Architect / Engineer Stamp', {
    x: 84,
    y: coverY - 22,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  // 2. Merge sources; record where each one starts.
  type SectionStart = { title: string; pageIndexInOutput: number };
  const sectionStarts: SectionStart[] = [];
  const repairedSourceIndices: number[] = [];

  for (let i = 0; i < input.sources.length; i++) {
    const source = input.sources[i]!;
    const { doc, repaired } = await loadSourceDoc(source);
    if (repaired) repairedSourceIndices.push(i);
    const pageIndices = doc.getPageIndices();
    const copied = await out.copyPages(doc, pageIndices);
    sectionStarts.push({ title: source.title, pageIndexInOutput: out.getPageCount() });
    for (const page of copied) out.addPage(page);
  }

  // 3. Insert TOC at position 1 (after cover). Inserting shifts subsequent
  //    page indices by +1.
  const toc = out.insertPage(1, [PAGE_W, PAGE_H]);
  toc.drawText('Table of Contents', {
    x: 72,
    y: PAGE_H - 96,
    size: 20,
    font: fontBold,
  });
  toc.drawLine({
    start: { x: 72, y: PAGE_H - 108 },
    end: { x: PAGE_W - 72, y: PAGE_H - 108 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  // +1 for the TOC shift, +1 for 1-based numbering.
  const bookmarks: AssembledBookmark[] = sectionStarts.map((s) => ({
    title: s.title,
    pageNumber: s.pageIndexInOutput + 1 + 1,
  }));

  let tocY = PAGE_H - 144;
  bookmarks.forEach((entry, i) => {
    toc.drawText(`${i + 1}.  ${entry.title}`, { x: 72, y: tocY, size: 11, font });
    toc.drawText(`p. ${entry.pageNumber}`, {
      x: PAGE_W - 120,
      y: tocY,
      size: 11,
      font,
    });
    tocY -= 22;
  });

  // 4. Bates stamp every page in the assembled document.
  const totalPages = out.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = out.getPage(i);
    const label = batesLabel(batesPrefix, i + 1);
    const { width } = page.getSize();
    const labelWidth = font.widthOfTextAtSize(label, 9);
    page.drawText(label, {
      x: (width - labelWidth) / 2,
      y: 18,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  // 5. PDF outline (bookmarks pane) — one entry per source.
  if (bookmarks.length > 0) {
    const context = out.context;
    const outlineRefs = bookmarks.map(() => context.nextRef());
    const outlinesDictRef = context.nextRef();

    bookmarks.forEach((entry, i) => {
      const pageRef = out.getPage(entry.pageNumber - 1).ref;
      const dest = PDFArray.withContext(context);
      dest.push(pageRef);
      dest.push(PDFName.of('XYZ'));
      dest.push(PDFNumber.of(0));
      dest.push(PDFNumber.of(PAGE_H));
      dest.push(PDFNumber.of(0));

      const dict = context.obj({
        Title: PDFString.of(entry.title),
        Parent: outlinesDictRef,
        Dest: dest,
      });
      if (i > 0) dict.set(PDFName.of('Prev'), outlineRefs[i - 1]!);
      if (i < bookmarks.length - 1) dict.set(PDFName.of('Next'), outlineRefs[i + 1]!);
      context.assign(outlineRefs[i]!, dict);
    });

    const outlinesDict = context.obj({
      Type: PDFName.of('Outlines'),
      First: outlineRefs[0]!,
      Last: outlineRefs[outlineRefs.length - 1]!,
      Count: PDFNumber.of(bookmarks.length),
    });
    context.assign(outlinesDictRef, outlinesDict);
    out.catalog.set(PDFName.of('Outlines'), outlinesDictRef);
    out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }

  const bytes = await out.save();
  return {
    bytes,
    pageCount: totalPages,
    bookmarks,
    batesRange: {
      first: batesLabel(batesPrefix, 1),
      last: batesLabel(batesPrefix, totalPages),
    },
    repairedSourceIndices,
  };
}
