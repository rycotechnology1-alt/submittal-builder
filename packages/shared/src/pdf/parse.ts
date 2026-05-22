import type * as Pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { getStandardFontDataUrl } from './pdfjs-options.js';

const OCR_TEXT_THRESHOLD = 50;

export type ParsedPdfPage = {
  pageNumber: number;
  text: string | null;
  hasOcr: boolean;
};

export type ParsedPdf = {
  pageCount: number;
  pages: ParsedPdfPage[];
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

export async function parsePdfPages(bytes: Uint8Array): Promise<ParsedPdf> {
  const { getDocument, VerbosityLevel } = await loadPdfjs();
  const document = await getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: getStandardFontDataUrl(),
    verbosity: VerbosityLevel.ERRORS,
  }).promise;

  const pages: ParsedPdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const hasOcr = text.length >= OCR_TEXT_THRESHOLD;
    pages.push({ pageNumber, text: hasOcr ? text : null, hasOcr });
  }

  await document.destroy();
  return { pageCount: document.numPages, pages };
}
