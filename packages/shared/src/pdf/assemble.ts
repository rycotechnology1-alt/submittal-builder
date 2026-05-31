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

import { buildHeaderLines } from './cover-format.js';
import {
  locateBySize,
  locatePartNumber,
  type PartNumberMatch,
  type VerificationStatus,
} from './locate-part-number.js';

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
  /**
   * Selected size/part-number callouts to mark on this source's pages. Each is
   * drawn as an arrow to the located part number, or a margin stamp when the
   * text cannot be confidently located.
   */
  selectedVariants?: SelectedVariantCallout[];
};

export type SelectedVariantCallout = {
  /** The exact part number to locate and call out, e.g. "V06BAA1". */
  partNumber: string;
  /** Human label for the callout, e.g. `1/2" – Coil`. */
  label: string;
  /** 1-based page within this source PDF where the part number appears. */
  sourcePage: number;
  /**
   * Selected trade size, e.g. `4 x 2`. When the part number can't be located
   * directly (e.g. an AI mis-read), the size anchors the correct row so the
   * located token can still be highlighted.
   */
  size?: string | null;
  /**
   * Whether this part number was verified against the source page's text layer.
   * No longer gates the fallback stamp (a selected part number that can't be
   * located is always stamped); retained for diagnostics.
   */
  verificationStatus?: VerificationStatus | null;
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
  /** Optional company address + contact for the cover letterhead header. */
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactWebsite?: string | null;
};

// --- Cover letterhead header layout -----------------------------------------

const COVER_MARGIN = 72; // 1 inch
const HEADER_TOP = PAGE_H - COVER_MARGIN; // top edge of logo + info block
const LOGO_MAX_W = 160;
const LOGO_MAX_H = 90;
const LOGO_GAP = 18; // space between logo and the info column
const HEADER_NAME_SIZE = 13;
const HEADER_LINE_SIZE = 9.5;
const HEADER_LINE_GAP = 13;

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

// --- Selected part-number callouts ------------------------------------------

const CALLOUT_ACCENT = rgb(0.85, 0.12, 0.12);

// Highlighter-style marking for a located part number. A translucent fill over
// the exact text reads through (it covers no neighbouring table data) and needs
// no margin space. The part number itself lives in the TOC "Part #" column, so
// nothing is drawn as on-page text — no arrow, no box, no label.
const HIGHLIGHT_FILL = rgb(1, 0.85, 0);
const HIGHLIGHT_PAD = 1.5;
const HIGHLIGHT_FILL_OPACITY = 0.35;
const HIGHLIGHT_BORDER_OPACITY = 0.9;
const HIGHLIGHT_BORDER_WIDTH = 0.6;

export type HighlightRect = { x: number; y: number; width: number; height: number };

/**
 * Pad the located bbox and clamp it inside the page so the highlight never
 * spills past an edge. Pure (no drawing) so it can be unit-tested directly.
 */
export function highlightRect(match: PartNumberMatch, pad: number): HighlightRect {
  let x = match.x - pad;
  let y = match.y - pad;
  let width = match.width + pad * 2;
  let height = match.height + pad * 2;
  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }
  if (x + width > match.pageWidth) width = match.pageWidth - x;
  if (y + height > match.pageHeight) height = match.pageHeight - y;
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

/** Draw a translucent highlight over a located part number — no arrow, no label. */
function drawPartNumberHighlight(page: PDFPage, match: PartNumberMatch): void {
  const r = highlightRect(match, HIGHLIGHT_PAD);
  page.drawRectangle({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    color: HIGHLIGHT_FILL,
    opacity: HIGHLIGHT_FILL_OPACITY,
    borderColor: HIGHLIGHT_FILL,
    borderOpacity: HIGHLIGHT_BORDER_OPACITY,
    borderWidth: HIGHLIGHT_BORDER_WIDTH,
  });
}

/** Fallback: a stamp banner at the top-left of the page listing part numbers. */
function drawSubmittedStamp(page: PDFPage, font: EmbeddedFont, lines: string[]): void {
  const size = 9;
  const pad = 5;
  const lineHeight = 13;
  const { width, height } = page.getSize();
  const textW = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
  const boxW = Math.min(width - 20, textW + pad * 2);
  const boxH = pad * 2 + lines.length * lineHeight;
  const x = 10;
  const y = height - 10 - boxH;
  page.drawRectangle({
    x,
    y,
    width: boxW,
    height: boxH,
    color: rgb(1, 0.97, 0.85),
    borderColor: CALLOUT_ACCENT,
    borderWidth: 1,
  });
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: x + pad,
      y: y + boxH - pad - size - i * lineHeight,
      size,
      font,
      color: CALLOUT_ACCENT,
    });
  });
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

  // --- Letterhead header: logo on the left, company name + address + contact
  // stacked to the right. Only the cover page carries this block. The body
  // below starts from the measured header bottom so a tall logo never collides
  // with the title.
  let logoBottom = HEADER_TOP;
  let infoX = COVER_MARGIN;
  if (input.cover.logoBytes && input.cover.logoContentType) {
    try {
      const image =
        input.cover.logoContentType === 'image/png'
          ? await out.embedPng(input.cover.logoBytes)
          : await out.embedJpg(input.cover.logoBytes);
      // Fit within the logo box, preserving aspect ratio.
      const scale = Math.min(LOGO_MAX_W / image.width, LOGO_MAX_H / image.height);
      const drawnW = image.width * scale;
      const drawnH = image.height * scale;
      cover.drawImage(image, {
        x: COVER_MARGIN,
        y: HEADER_TOP - drawnH,
        width: drawnW,
        height: drawnH,
      });
      logoBottom = HEADER_TOP - drawnH;
      infoX = COVER_MARGIN + drawnW + LOGO_GAP;
    } catch {
      // logo failures are non-fatal; continue without it.
    }
  }

  const headerLines = buildHeaderLines({
    companyName: input.cover.workspaceName,
    addressStreet: input.cover.addressStreet,
    addressCity: input.cover.addressCity,
    addressState: input.cover.addressState,
    addressZip: input.cover.addressZip,
    contactPhone: input.cover.contactPhone,
    contactEmail: input.cover.contactEmail,
    contactWebsite: input.cover.contactWebsite,
  });

  // Company name (bold) then address/contact lines, top-aligned with the logo.
  let textY = HEADER_TOP - HEADER_NAME_SIZE;
  cover.drawText(headerLines[0] ?? input.cover.workspaceName, {
    x: infoX,
    y: textY,
    size: HEADER_NAME_SIZE,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  for (let i = 1; i < headerLines.length; i++) {
    textY -= HEADER_LINE_GAP;
    cover.drawText(headerLines[i]!, {
      x: infoX,
      y: textY,
      size: HEADER_LINE_SIZE,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  // Divider under whichever column reaches lower (logo or text).
  const headerBottom = Math.min(logoBottom, textY);
  const dividerY = headerBottom - 16;
  cover.drawLine({
    start: { x: COVER_MARGIN, y: dividerY },
    end: { x: PAGE_W - COVER_MARGIN, y: dividerY },
    thickness: 0.75,
    color: rgb(0.6, 0.6, 0.6),
  });

  const titleY = dividerY - 36;
  cover.drawText('SUBMITTAL PACKAGE', {
    x: COVER_MARGIN,
    y: titleY,
    size: 26,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  cover.drawText(input.cover.packageTitle ?? input.cover.submittalNumber, {
    x: COVER_MARGIN,
    y: titleY - 30,
    size: 14,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  let coverY = titleY - 78;
  const drawRow = (label: string, value: string) => {
    cover.drawText(label, {
      x: COVER_MARGIN,
      y: coverY,
      size: 11,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    cover.drawText(value, { x: 220, y: coverY, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    coverY -= 22;
  };
  drawRow('Submittal #:', input.cover.submittalNumber);
  drawRow('Spec section:', input.cover.specSection);
  drawRow('Revision:', input.cover.revision);
  drawRow('Project:', input.cover.projectName);
  drawRow('Subcontractor:', input.cover.subCompanyName);
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
    pageCount: number;
    itemId?: string;
    description?: string | null;
    partNumber?: string | null;
    manufacturer?: string | null;
    sourceBytes: Uint8Array;
    selectedVariants?: SelectedVariantCallout[];
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
      pageCount: copied.length,
      itemId: source.itemId,
      description: source.description,
      partNumber: source.partNumber,
      manufacturer: source.manufacturer,
      sourceBytes: source.bytes,
      selectedVariants: source.selectedVariants,
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

  // 6b. Mark the user-selected part number(s) on each source's pages: an arrow
  //     to the located text, or a margin stamp when it can't be located.
  for (const s of sectionStarts) {
    if (!s.selectedVariants?.length) continue;
    const firstPageIndex = s.pageIndexInOutput + tocPageCount;
    const stampLines: string[] = [];
    for (const variant of s.selectedVariants) {
      const pageOffset = Math.min(Math.max(variant.sourcePage - 1, 0), s.pageCount - 1);
      const page = out.getPage(firstPageIndex + pageOffset);
      let match: PartNumberMatch | null = null;
      try {
        match = await locatePartNumber(s.sourceBytes, pageOffset + 1, variant.partNumber);
      } catch {
        match = null;
      }
      // Couldn't locate the SKU directly — fall back to the selected trade size,
      // which anchors the correct row even when the part number was mis-read.
      if (!match && variant.size) {
        try {
          const bySize = await locateBySize(s.sourceBytes, pageOffset + 1, {
            partNumber: variant.partNumber,
            size: variant.size,
          });
          if (bySize) match = bySize.match;
        } catch {
          // ignore — fall through to the stamp
        }
      }
      if (match) {
        drawPartNumberHighlight(page, match);
      } else {
        // A selected part number that can't be located still gets the page-1
        // stamp so the reviewer sees what was submitted.
        stampLines.push(`SUBMITTED — Part No. ${variant.partNumber} (${variant.label})`);
      }
    }
    if (stampLines.length > 0) {
      drawSubmittedStamp(out.getPage(firstPageIndex), font, stampLines);
    }
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
