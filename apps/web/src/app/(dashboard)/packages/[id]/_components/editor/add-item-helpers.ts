import { MAX_UPLOAD_FILE_BYTES } from '@/lib/upload';

export const ALLOWED_PDF_CONTENT_TYPES = ['application/pdf'] as const;

export type PdfContentType = (typeof ALLOWED_PDF_CONTENT_TYPES)[number];

export const MAX_PDF_BYTES = MAX_UPLOAD_FILE_BYTES;

export function isValidPdfContentType(type: string): type is PdfContentType {
  return (ALLOWED_PDF_CONTENT_TYPES as readonly string[]).includes(type);
}

export function isPdfFilename(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

export function isWithinPdfSizeLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_PDF_BYTES;
}

export type AddItemRejection =
  | { kind: 'invalid_type'; message: string }
  | { kind: 'empty_file'; message: string }
  | { kind: 'too_large'; message: string };

export function validateAddItemFile(file: File): AddItemRejection | null {
  const looksLikePdf = isValidPdfContentType(file.type) || isPdfFilename(file.name);
  if (!looksLikePdf) {
    return { kind: 'invalid_type', message: 'Only PDF files can be added.' };
  }
  if (file.size <= 0) {
    return { kind: 'empty_file', message: 'File appears to be empty.' };
  }
  if (file.size > MAX_PDF_BYTES) {
    return { kind: 'too_large', message: 'PDFs must be 50 MB or smaller.' };
  }
  return null;
}
