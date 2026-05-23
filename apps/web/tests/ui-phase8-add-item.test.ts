import { describe, expect, test } from 'vitest';

import {
  ALLOWED_PDF_CONTENT_TYPES,
  MAX_PDF_BYTES,
  isPdfFilename,
  isValidPdfContentType,
  isWithinPdfSizeLimit,
  validateAddItemFile,
} from '@/app/(dashboard)/packages/[id]/_components/editor/add-item-helpers';

describe('isValidPdfContentType', () => {
  test('accepts application/pdf', () => {
    for (const type of ALLOWED_PDF_CONTENT_TYPES) {
      expect(isValidPdfContentType(type)).toBe(true);
    }
  });

  test('rejects other types', () => {
    expect(isValidPdfContentType('image/png')).toBe(false);
    expect(isValidPdfContentType('application/zip')).toBe(false);
    expect(isValidPdfContentType('')).toBe(false);
  });
});

describe('isPdfFilename', () => {
  test('accepts .pdf extension regardless of case', () => {
    expect(isPdfFilename('report.pdf')).toBe(true);
    expect(isPdfFilename('REPORT.PDF')).toBe(true);
    expect(isPdfFilename('a.b.c.pdf')).toBe(true);
  });

  test('rejects other extensions', () => {
    expect(isPdfFilename('report.docx')).toBe(false);
    expect(isPdfFilename('report')).toBe(false);
    expect(isPdfFilename('pdf.png')).toBe(false);
  });
});

describe('isWithinPdfSizeLimit', () => {
  test('accepts bytes up to the cap', () => {
    expect(isWithinPdfSizeLimit(1)).toBe(true);
    expect(isWithinPdfSizeLimit(MAX_PDF_BYTES)).toBe(true);
    expect(isWithinPdfSizeLimit(MAX_PDF_BYTES - 1)).toBe(true);
  });

  test('rejects zero, negative, and over-cap sizes', () => {
    expect(isWithinPdfSizeLimit(0)).toBe(false);
    expect(isWithinPdfSizeLimit(-1)).toBe(false);
    expect(isWithinPdfSizeLimit(MAX_PDF_BYTES + 1)).toBe(false);
  });
});

describe('MAX_PDF_BYTES', () => {
  test('matches the onboarding upload cap (50 MB)', () => {
    expect(MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
  });
});

function makeFile({
  name = 'doc.pdf',
  type = 'application/pdf',
  size = 1024,
}: {
  name?: string;
  type?: string;
  size?: number;
}): File {
  const file = new File([new Uint8Array(Math.max(1, size))], name, { type });
  if (file.size !== size) {
    Object.defineProperty(file, 'size', { value: size, configurable: true });
  }
  return file;
}

describe('validateAddItemFile', () => {
  test('accepts a valid PDF', () => {
    expect(validateAddItemFile(makeFile({}))).toBeNull();
  });

  test('accepts a PDF by extension when the browser omits a content type', () => {
    expect(validateAddItemFile(makeFile({ type: '' }))).toBeNull();
  });

  test('rejects non-PDF content type and extension', () => {
    const rejection = validateAddItemFile(
      makeFile({ name: 'image.png', type: 'image/png' }),
    );
    expect(rejection?.kind).toBe('invalid_type');
  });

  test('rejects empty files', () => {
    const rejection = validateAddItemFile(makeFile({ size: 0 }));
    expect(rejection?.kind).toBe('empty_file');
  });

  test('rejects files larger than the cap', () => {
    const rejection = validateAddItemFile(makeFile({ size: MAX_PDF_BYTES + 1 }));
    expect(rejection?.kind).toBe('too_large');
  });
});
