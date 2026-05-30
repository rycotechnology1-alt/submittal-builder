// Find where a part-number string sits on a source PDF page so the assembler
// can draw an arrow to it. Coordinates are returned in the page's *unrotated*
// PDF user space (origin bottom-left, y up) — the same space pdf-lib draws in,
// so the arrow stays aligned with the content regardless of the page's /Rotate.
//
// Returns null when the string is absent or ambiguous (found on more than one
// line); callers fall back to a margin stamp in those cases.

import type * as Pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { getStandardFontDataUrl } from './pdfjs-options.js';

export type PartNumberMatch = {
  /** Bottom-left corner + size of the matched text, in unrotated user space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Page dimensions (unrotated) for clamping/placement decisions. */
  pageWidth: number;
  pageHeight: number;
};

async function loadPdfjs() {
  if (process.env.VITEST) {
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<typeof Pdfjs>;
  return runtimeImport('pdfjs-dist/legacy/build/pdf.mjs');
}

type Glyph = { str: string; x: number; y: number; w: number; h: number };

/** Cluster glyphs into visual lines by their baseline y. */
function groupLines(glyphs: Glyph[]): Glyph[][] {
  const sorted = glyphs.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Glyph[][] = [];
  for (const g of sorted) {
    const tol = Math.max(2, g.h * 0.6);
    const line = lines.find((l) => Math.abs(l[0]!.y - g.y) <= tol);
    if (line) line.push(g);
    else lines.push([g]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Union bounding box of a set of glyphs. */
function union(glyphs: Glyph[]): { x: number; y: number; width: number; height: number } {
  const x0 = Math.min(...glyphs.map((g) => g.x));
  const y0 = Math.min(...glyphs.map((g) => g.y));
  const x1 = Math.max(...glyphs.map((g) => g.x + g.w));
  const y1 = Math.max(...glyphs.map((g) => g.y + g.h));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Find the glyphs covering `target` within a single line. Returns the covered
 * glyphs, or null if the target does not appear in that line.
 */
function matchInLine(line: Glyph[], target: string): Glyph[] | null {
  // Build a whitespace-stripped string with a char→glyph map so a part number
  // split across multiple text runs still matches.
  let compact = '';
  const charGlyph: number[] = [];
  line.forEach((g, gi) => {
    for (const ch of g.str.replace(/\s+/g, '')) {
      compact += ch.toLowerCase();
      charGlyph.push(gi);
    }
  });
  const idx = compact.indexOf(target);
  if (idx === -1) return null;
  const glyphIdx = new Set(charGlyph.slice(idx, idx + target.length));
  return [...glyphIdx].map((gi) => line[gi]!);
}

export async function locatePartNumber(
  bytes: Uint8Array,
  pageNumber: number,
  partNumber: string,
): Promise<PartNumberMatch | null> {
  const target = normalize(partNumber);
  if (!target) return null;

  const { getDocument, VerbosityLevel } = await loadPdfjs();
  const doc = await getDocument({
    // Copy into a plain Uint8Array — pdfjs rejects Node Buffers.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: getStandardFontDataUrl(),
    verbosity: VerbosityLevel.ERRORS,
  }).promise;

  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return null;
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const view = page.view; // unrotated MediaBox [x0, y0, x1, y1]
    const vx0 = view[0] ?? 0;
    const vy0 = view[1] ?? 0;
    const pageWidth = (view[2] ?? 0) - vx0;
    const pageHeight = (view[3] ?? 0) - vy0;

    const glyphs: Glyph[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const tr = item.transform as number[];
      const h = item.height || Math.hypot(tr[1] ?? 0, tr[3] ?? 0);
      // Offset by the MediaBox origin so coordinates are relative to the page's
      // lower-left corner — the space pdf-lib's draw* methods expect.
      glyphs.push({ str: item.str, x: (tr[4] ?? 0) - vx0, y: (tr[5] ?? 0) - vy0, w: item.width ?? 0, h });
    }

    const matches = groupLines(glyphs)
      .map((line) => matchInLine(line, target))
      .filter((m): m is Glyph[] => m !== null && m.length > 0);

    // Ambiguous (multiple lines) or absent ⇒ let the caller stamp instead.
    if (matches.length !== 1) return null;

    const box = union(matches[0]!);
    return { ...box, pageWidth, pageHeight };
  } finally {
    await doc.destroy();
  }
}
