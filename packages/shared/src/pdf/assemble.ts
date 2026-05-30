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
import type { PDFPage } from 'pdf-lib';

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
  /**
   * Identity of the item this source belongs to. Sources sharing an itemId are
   * collapsed into a single Table of Contents row. Falls back to the title when
   * absent.
   */
  itemId?: string;
  /** AI-extracted description for the TOC row (1-2 sentences). */
  description?: string | null;
  /** Part number for the TOC row (currently the model number). */
  partNumber?: string | null;
  /** Manufacturer for the TOC row. */
  manufacturer?: string | null;
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

// --- Table of Contents table layout ----------------------------------------

const TOC_MARGIN = 36; // left/right margin for the wide TOC table
const TOC_HEADER_TOP = PAGE_H - 100; // y of the top edge of the header row
const TOC_HEADER_HEIGHT = 28; // tall enough for a wrapped two-line header label
const TOC_BODY_TOP = TOC_HEADER_TOP - TOC_HEADER_HEIGHT;
const TOC_BOTTOM = 50; // keep clear of the Bates label at y=18
const TOC_FONT_SIZE = 9;
const TOC_LINE_HEIGHT = 11;
const TOC_CELL_PAD = 4;
const TOC_MIN_ROW_HEIGHT = 30; // leave room to hand-write in the approval box
const TOC_GRID = rgb(0.7, 0.7, 0.7);

type TocColumn = { key: 'number' | 'description' | 'partNumber' | 'manufacturer' | 'approval' | 'page'; label: string; width: number };

const TOC_COLUMNS: TocColumn[] = [
  { key: 'number', label: '#', width: 30 },
  { key: 'description', label: 'Description', width: 210 },
  { key: 'partNumber', label: 'Part #', width: 80 },
  { key: 'manufacturer', label: 'Manufacturer', width: 100 },
  { key: 'approval', label: 'Engineers Approval', width: 80 },
  { key: 'page', label: 'Page', width: 40 },
];

type EmbeddedFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

/** Column left edges (x), one per column plus the table's right edge. */
function tocColumnEdges(): number[] {
  const edges = [TOC_MARGIN];
  for (const col of TOC_COLUMNS) edges.push(edges[edges.length - 1]! + col.width);
  return edges;
}

/** Greedily wrap text to a max width, breaking overlong words by character. */
function wrapText(text: string, font: EmbeddedFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const pushWord = (word: string) => {
    let chunk = word;
    while (font.widthOfTextAtSize(chunk, size) > maxWidth && chunk.length > 1) {
      // Break a single word that is wider than the cell.
      let cut = chunk.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) cut--;
      lines.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
    }
    return chunk;
  };
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = pushWord(word);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Truncate a single line with an ellipsis so it fits maxWidth. */
function truncateText(text: string, font: EmbeddedFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
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
  type SectionStart = {
    title: string;
    pageIndexInOutput: number;
    itemId?: string;
    description?: string | null;
    partNumber?: string | null;
    manufacturer?: string | null;
  };
  const sectionStarts: SectionStart[] = [];
  const repairedSourceIndices: number[] = [];

  for (let i = 0; i < input.sources.length; i++) {
    const source = input.sources[i]!;
    const { doc, repaired } = await loadSourceDoc(source);
    if (repaired) repairedSourceIndices.push(i);
    const pageIndices = doc.getPageIndices();
    const copied = await out.copyPages(doc, pageIndices);
    sectionStarts.push({
      title: source.title,
      pageIndexInOutput: out.getPageCount(),
      itemId: source.itemId,
      description: source.description,
      partNumber: source.partNumber,
      manufacturer: source.manufacturer,
    });
    for (const page of copied) out.addPage(page);
  }

  // 3. Build TOC rows: one per item (consecutive sources sharing an itemId
  //    collapse into a single row). Description falls back to the title.
  type TocRow = {
    number: number;
    description: string;
    partNumber: string;
    manufacturer: string;
    pageStartIndex: number;
  };
  const tocRows: TocRow[] = [];
  let lastKey: string | undefined;
  for (const s of sectionStarts) {
    const key = s.itemId ?? `__title__:${s.title}`;
    if (key === lastKey) continue;
    tocRows.push({
      number: tocRows.length + 1,
      description: (s.description ?? '').trim() || s.title,
      partNumber: (s.partNumber ?? '').trim(),
      manufacturer: (s.manufacturer ?? '').trim(),
      pageStartIndex: s.pageIndexInOutput,
    });
    lastKey = key;
  }

  // 4. Lay rows out into one or more TOC pages so we know how many pages (T) to
  //    insert before the merged sources, then how far page numbers shift.
  const edges = tocColumnEdges();
  const tableRight = edges[edges.length - 1]!;
  const descWidth = TOC_COLUMNS[1]!.width - 2 * TOC_CELL_PAD;
  type LaidRow = { row: TocRow; descLines: string[]; height: number; top: number };
  const pages: LaidRow[][] = [];
  let currentPage: LaidRow[] = [];
  let y = TOC_BODY_TOP;
  for (const row of tocRows) {
    const descLines = wrapText(row.description, font, TOC_FONT_SIZE, descWidth);
    const height = Math.max(
      descLines.length * TOC_LINE_HEIGHT + 2 * TOC_CELL_PAD,
      TOC_MIN_ROW_HEIGHT,
    );
    if (y - height < TOC_BOTTOM && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      y = TOC_BODY_TOP;
    }
    currentPage.push({ row, descLines, height, top: y });
    y -= height;
  }
  pages.push(currentPage); // always at least one page (header only when empty)
  const tocPageCount = pages.length;

  // Insert the TOC pages at index 1 (after the cover). Each insert lands right
  // after the previous one, so subsequent page indices shift by tocPageCount.
  const tocPageObjs: PDFPage[] = [];
  for (let i = 0; i < tocPageCount; i++) {
    tocPageObjs.push(out.insertPage(1 + i, [PAGE_W, PAGE_H]));
  }

  // +tocPageCount for the inserted TOC pages, +1 for 1-based numbering.
  const bookmarks: AssembledBookmark[] = sectionStarts.map((s) => ({
    title: s.title,
    pageNumber: s.pageIndexInOutput + tocPageCount + 1,
  }));

  // 5. Draw the table on each TOC page.
  const drawLine = (page: PDFPage, ax: number, ay: number, bx: number, by: number) =>
    page.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: 0.5, color: TOC_GRID });
  const drawCell = (page: PDFPage, text: string, colIndex: number, top: number, bold = false) => {
    if (!text) return;
    const col = TOC_COLUMNS[colIndex]!;
    const fitted = truncateText(text, bold ? fontBold : font, TOC_FONT_SIZE, col.width - 2 * TOC_CELL_PAD);
    page.drawText(fitted, {
      x: edges[colIndex]! + TOC_CELL_PAD,
      y: top - TOC_CELL_PAD - TOC_FONT_SIZE,
      size: TOC_FONT_SIZE,
      font: bold ? fontBold : font,
      color: rgb(0.15, 0.15, 0.15),
    });
  };

  pages.forEach((laidRows, p) => {
    const page = tocPageObjs[p]!;
    if (p === 0) {
      page.drawText('Table of Contents', { x: TOC_MARGIN, y: PAGE_H - 72, size: 20, font: fontBold });
    }

    // Header labels (wrap so "Engineers Approval" stacks instead of clipping).
    TOC_COLUMNS.forEach((col, ci) => {
      const lines = wrapText(col.label, fontBold, TOC_FONT_SIZE, col.width - 2 * TOC_CELL_PAD);
      lines.forEach((line, li) => {
        page.drawText(line, {
          x: edges[ci]! + TOC_CELL_PAD,
          y: TOC_HEADER_TOP - TOC_CELL_PAD - TOC_FONT_SIZE - li * TOC_LINE_HEIGHT,
          size: TOC_FONT_SIZE,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
      });
    });

    // Body rows.
    for (const { row, descLines, top } of laidRows) {
      drawCell(page, String(row.number), 0, top);
      descLines.forEach((line, li) => {
        page.drawText(line, {
          x: edges[1]! + TOC_CELL_PAD,
          y: top - TOC_CELL_PAD - TOC_FONT_SIZE - li * TOC_LINE_HEIGHT,
          size: TOC_FONT_SIZE,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
      });
      drawCell(page, row.partNumber, 2, top);
      drawCell(page, row.manufacturer, 3, top);
      // Column 4 (Engineers Approval) is intentionally left blank.
      drawCell(page, String(row.pageStartIndex + tocPageCount + 1), 5, top);
    }

    // Borders: outer + column separators + a rule under the header and each row.
    const bodyBottom = laidRows.length
      ? laidRows[laidRows.length - 1]!.top - laidRows[laidRows.length - 1]!.height
      : TOC_BODY_TOP;
    for (const x of edges) drawLine(page, x, TOC_HEADER_TOP, x, bodyBottom);
    drawLine(page, TOC_MARGIN, TOC_HEADER_TOP, tableRight, TOC_HEADER_TOP);
    drawLine(page, TOC_MARGIN, TOC_BODY_TOP, tableRight, TOC_BODY_TOP);
    for (const { top, height } of laidRows) drawLine(page, TOC_MARGIN, top - height, tableRight, top - height);
  });

  // 6. Bates stamp every page in the assembled document.
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

  // 7. PDF outline (bookmarks pane) — one entry per source.
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
