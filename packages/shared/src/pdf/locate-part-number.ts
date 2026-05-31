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

type Box = { x: number; y: number; width: number; height: number };

// A real part number occupies a small fraction of the page width. If a located
// box is wider than this, treat the locate as low-confidence (don't highlight).
const MAX_MATCH_WIDTH_FRACTION = 0.5;

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

// Separators a SKU may differ on between the model's transcription and the page:
// whitespace plus the hyphen/dash family (hyphen-minus, soft hyphen,
// U+2010–U+2015, minus sign). Centralized so it is easy to widen later.
const isSeparator = (ch: string) => /[\s-­‐-―−]/.test(ch);

const normalize = (s: string) => {
  let out = '';
  for (const ch of s) if (!isSeparator(ch)) out += ch.toLowerCase();
  return out;
};

/** Whitespace-stripped, lowercased trade size, e.g. "4 x 2" -> "4x2". Keeps
 *  hyphens so sizes like "1-1/2" stay distinct. */
const normalizeSize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Bounded Levenshtein edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** A part-number-shaped token: alphanumeric (+ hyphen), >=5 chars, has a digit
 *  and no decimal point (so it never matches a dimension column like "5.938"). */
function isSkuToken(token: string): boolean {
  return /^[A-Za-z0-9-]{5,}$/.test(token) && /\d/.test(token);
}

/** Whitespace-separated tokens across a grouped line. */
function lineTokens(line: Glyph[]): string[] {
  return line.flatMap((g) => g.str.split(/\s+/)).filter(Boolean);
}

/** The single line whose text contains the normalized size token, or null when
 *  the size is absent or matches more than one row (too ambiguous to trust). */
function findSizeRow(lines: Glyph[][], sizeKey: string): Glyph[] | null {
  const matches = lines.filter((line) =>
    normalizeSize(line.map((g) => g.str).join('')).includes(sizeKey),
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** The part-number-shaped token on a line — the unique one, or (when several)
 *  the one closest to the extracted SKU. Null when the line has none. */
function recoverSkuFromLine(line: Glyph[], aiKey: string): string | null {
  const skuTokens = lineTokens(line).filter(isSkuToken);
  if (skuTokens.length === 0) return null;
  if (skuTokens.length === 1 || !aiKey) return skuTokens[0]!;
  return skuTokens
    .map((t) => ({ t, d: levenshtein(normalize(t), aiKey) }))
    .sort((a, b) => a.d - b.d)[0]!.t;
}

/** Whether the normalized target appears on any grouped line of the page. */
function pageContainsKey(lines: Glyph[][], targetKey: string): boolean {
  return lines.some((line) => matchInLine(line, targetKey) !== null);
}

/** The unique page SKU token within edit distance 1 of the extracted SKU, or
 *  null when there is none or the nearest is ambiguous. Used as a last-resort
 *  correction when the trade size can't anchor the row. */
function nearestPageSku(lines: Glyph[][], aiKey: string): string | null {
  if (!aiKey) return null;
  const within = lines
    .flatMap((line) => lineTokens(line))
    .filter(isSkuToken)
    .map((t) => ({ t, d: levenshtein(normalize(t), aiKey) }))
    .filter((x) => x.d <= 1);
  if (within.length === 0) return null;
  const min = Math.min(...within.map((x) => x.d));
  const best = new Set(within.filter((x) => x.d === min).map((x) => x.t));
  return best.size === 1 ? [...best][0]! : null;
}

/**
 * Find the tight bounding box covering `target` within a single line, or null if
 * the target does not appear in that line.
 *
 * A part number can sit inside one wide text run — paragraph-style sheets render
 * a whole line as a single pdfjs item. Mapping the matched characters back to
 * that one run and taking its full width would highlight the entire line, so we
 * approximate the substring's x-range *within* each contributing run
 * proportionally (uniform advance across the run's characters) and union those
 * sub-rectangles. For tabular sheets — where the value is its own narrow run —
 * the matched chars span the whole run, so this reduces to the run's own box.
 */
function matchInLine(line: Glyph[], target: string): Box | null {
  // Whitespace-stripped string with each kept char mapped to its run index and
  // its char offset within that run's original string, so a part number split
  // across runs still matches and the proportional offset stays accurate.
  let compact = '';
  const refs: { gi: number; k: number }[] = [];
  line.forEach((g, gi) => {
    for (let k = 0; k < g.str.length; k++) {
      const ch = g.str[k]!;
      if (isSeparator(ch)) continue;
      compact += ch.toLowerCase();
      refs.push({ gi, k });
    }
  });
  const idx = compact.indexOf(target);
  if (idx === -1) return null;

  // Per run, the min/max original char index covered by the match.
  const spans = new Map<number, { kmin: number; kmax: number }>();
  for (const { gi, k } of refs.slice(idx, idx + target.length)) {
    const span = spans.get(gi);
    if (span) {
      span.kmin = Math.min(span.kmin, k);
      span.kmax = Math.max(span.kmax, k);
    } else {
      spans.set(gi, { kmin: k, kmax: k });
    }
  }

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [gi, { kmin, kmax }] of spans) {
    const g = line[gi]!;
    const n = g.str.length || 1;
    x0 = Math.min(x0, g.x + (kmin / n) * g.w);
    x1 = Math.max(x1, g.x + ((kmax + 1) / n) * g.w);
    y0 = Math.min(y0, g.y);
    y1 = Math.max(y1, g.y + g.h);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

type PdfjsDoc = Awaited<ReturnType<typeof Pdfjs.getDocument>['promise']>;

type PageGlyphs = {
  glyphs: Glyph[];
  pageWidth: number;
  pageHeight: number;
};

/** Extract every text glyph on a page in unrotated user space, or null if the
 *  page number is out of range. An empty `glyphs` array means no text layer. */
async function extractPageGlyphs(
  doc: PdfjsDoc,
  pageNumber: number,
): Promise<PageGlyphs | null> {
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
  return { glyphs, pageWidth, pageHeight };
}

async function openPdf(bytes: Uint8Array): Promise<PdfjsDoc> {
  const { getDocument, VerbosityLevel } = await loadPdfjs();
  return getDocument({
    // Copy into a plain Uint8Array — pdfjs rejects Node Buffers.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: getStandardFontDataUrl(),
    verbosity: VerbosityLevel.ERRORS,
  }).promise;
}

export async function locatePartNumber(
  bytes: Uint8Array,
  pageNumber: number,
  partNumber: string,
): Promise<PartNumberMatch | null> {
  const target = normalize(partNumber);
  if (!target) return null;

  const doc = await openPdf(bytes);
  try {
    const extracted = await extractPageGlyphs(doc, pageNumber);
    if (!extracted) return null;
    const { glyphs, pageWidth, pageHeight } = extracted;

    const matches = groupLines(glyphs)
      .map((line) => matchInLine(line, target))
      .filter((m): m is Box => m !== null && m.width > 0);

    // Ambiguous (multiple lines) or absent ⇒ let the caller stamp instead.
    if (matches.length !== 1) return null;

    const box = matches[0]!;
    // Low-confidence guard: a plausible part number never spans half the page.
    // Fall back to a stamp instead of painting a giant rectangle over data.
    if (box.width > pageWidth * MAX_MATCH_WIDTH_FRACTION) return null;

    return { ...box, pageWidth, pageHeight };
  } finally {
    await doc.destroy();
  }
}

export type LocateBySizeResult = {
  /** The part number recovered from the matched size row's text layer. */
  correctedPartNumber: string;
  /** Bounding box of the recovered part number for highlighting. */
  match: PartNumberMatch;
};

/**
 * Recover a part number using its trade size as the anchor. Every SKU shares a
 * text-layer line with its trade size, and size extraction is more reliable than
 * part-number extraction — so when the extracted part number can't be located
 * (e.g. an AI digit mis-read), the *uniquely* matching size row identifies the
 * correct SKU. Returns null when the size is absent, ambiguous (matches more
 * than one row), or the row carries no part-number-shaped token.
 *
 * `partNumber` is the (possibly wrong) extracted SKU, used only to disambiguate
 * when a size row legitimately carries more than one SKU-shaped token.
 */
export async function locateBySize(
  bytes: Uint8Array,
  pageNumber: number,
  target: { partNumber: string; size: string },
): Promise<LocateBySizeResult | null> {
  const sizeKey = normalizeSize(target.size);
  if (!sizeKey) return null;

  const doc = await openPdf(bytes);
  try {
    const extracted = await extractPageGlyphs(doc, pageNumber);
    if (!extracted) return null;
    const { glyphs, pageWidth, pageHeight } = extracted;

    const line = findSizeRow(groupLines(glyphs), sizeKey);
    if (!line) return null;
    const chosen = recoverSkuFromLine(line, normalize(target.partNumber));
    if (!chosen) return null;

    const box = matchInLine(line, normalize(chosen));
    if (!box || box.width <= 0) return null;
    if (box.width > pageWidth * MAX_MATCH_WIDTH_FRACTION) return null;

    return { correctedPartNumber: chosen, match: { ...box, pageWidth, pageHeight } };
  } finally {
    await doc.destroy();
  }
}

/**
 * Whether a selected part number can be verified against the text actually
 * printed on its source page:
 * - `found`: the part number appears in the page's text layer.
 * - `absent`: the page has a text layer but the part number is not on it —
 *   a likely mis-extraction worth surfacing to the user.
 * - `unverifiable`: the page has no usable text layer (e.g. a scan), so the
 *   value cannot be checked either way.
 */
export type VerificationStatus = 'found' | 'absent' | 'unverifiable';

export type VerifyTarget = { partNumber: string; pageNumber: number };

/** Verify each target against its page's text layer. Opens the PDF once and
 *  extracts each referenced page a single time. Returns one status per input
 *  target, aligned by index. */
export async function verifyPartNumbers(
  bytes: Uint8Array,
  targets: VerifyTarget[],
): Promise<VerificationStatus[]> {
  if (targets.length === 0) return [];

  const doc = await openPdf(bytes);
  try {
    const pageCache = new Map<number, PageGlyphs | null>();
    const getPage = async (pageNumber: number) => {
      if (!pageCache.has(pageNumber)) {
        pageCache.set(pageNumber, await extractPageGlyphs(doc, pageNumber));
      }
      return pageCache.get(pageNumber) ?? null;
    };

    const results: VerificationStatus[] = [];
    for (const target of targets) {
      const normalized = normalize(target.partNumber);
      const page = await getPage(target.pageNumber);
      if (!page || page.glyphs.length === 0) {
        results.push('unverifiable');
        continue;
      }
      if (!normalized) {
        results.push('absent');
        continue;
      }
      const found = groupLines(page.glyphs).some(
        (line) => matchInLine(line, normalized) !== null,
      );
      results.push(found ? 'found' : 'absent');
    }
    return results;
  } finally {
    await doc.destroy();
  }
}

export type ReconcileTarget = {
  partNumber: string;
  /** Extracted trade size used to anchor the row, e.g. "4 x 2". */
  size: string | null;
  pageNumber: number;
};

export type ReconcileResult = {
  status: VerificationStatus;
  /** The reconciled part number — corrected when recovery succeeded, else the
   *  original input value. */
  partNumber: string;
  /** Whether `partNumber` differs from the input (a correction was applied). */
  corrected: boolean;
};

/**
 * Verify each extracted part number against its source page and, when it can't
 * be found, try to recover the correct SKU:
 *   1. present on the page  -> `found`, unchanged
 *   2. trade size anchors a unique row -> `found`, corrected to that row's SKU
 *   3. a unique page token is within edit distance 1 -> `found`, corrected
 *   4. otherwise -> `absent` (text layer) / `unverifiable` (no text), unchanged
 *
 * Opens the PDF once and extracts each referenced page a single time. Results
 * are aligned by index to `targets`.
 */
export async function reconcilePartNumbers(
  bytes: Uint8Array,
  targets: ReconcileTarget[],
): Promise<ReconcileResult[]> {
  if (targets.length === 0) return [];

  const doc = await openPdf(bytes);
  try {
    const pageCache = new Map<number, PageGlyphs | null>();
    const getPage = async (pageNumber: number) => {
      if (!pageCache.has(pageNumber)) {
        pageCache.set(pageNumber, await extractPageGlyphs(doc, pageNumber));
      }
      return pageCache.get(pageNumber) ?? null;
    };

    const results: ReconcileResult[] = [];
    for (const target of targets) {
      const key = normalize(target.partNumber);
      const page = await getPage(target.pageNumber);
      if (!page || page.glyphs.length === 0) {
        results.push({ status: 'unverifiable', partNumber: target.partNumber, corrected: false });
        continue;
      }

      const lines = groupLines(page.glyphs);
      if (key && pageContainsKey(lines, key)) {
        results.push({ status: 'found', partNumber: target.partNumber, corrected: false });
        continue;
      }

      const sizeKey = target.size ? normalizeSize(target.size) : '';
      const row = sizeKey ? findSizeRow(lines, sizeKey) : null;
      const recovered = row ? recoverSkuFromLine(row, key) : null;
      const corrected = recovered ?? nearestPageSku(lines, key);
      if (corrected) {
        results.push({
          status: 'found',
          partNumber: corrected,
          corrected: normalize(corrected) !== key,
        });
        continue;
      }

      results.push({ status: 'absent', partNumber: target.partNumber, corrected: false });
    }
    return results;
  } finally {
    await doc.destroy();
  }
}
