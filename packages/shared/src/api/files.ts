import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const uploadContentTypeSchema = z.enum(['application/pdf']);
export const logoContentTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

export const sourcePdfPresignRequestSchema = z
  .object({
    filename: z.string().trim().min(1),
    byte_size: z.number().int().positive(),
    content_type: uploadContentTypeSchema,
    sha256: sha256Schema.optional(),
  })
  .strict();

export const sourcePdfPresignResponseSchema = z.object({
  source_pdf_id: uuidSchema,
  upload_url: z.string().url(),
  storage_key: z.string(),
  expires_at: isoTimestampSchema,
  required_headers: z.record(z.string()),
});

export const sourcePdfConfirmRequestSchema = z.object({}).strict();

export const sourcePdfResponseSchema = z.object({
  id: uuidSchema,
  package_id: uuidSchema,
  original_filename: z.string(),
  storage_key: z.string(),
  byte_size: z.number().int().nonnegative().nullable(),
  sha256: sha256Schema.nullable(),
  page_count: z.number().int().positive().nullable(),
  processing_status: z.enum([
    'uploaded',
    'ocr_running',
    'classifying',
    'extracting',
    'extracted',
    'error',
    'cancelled',
  ]),
  processing_error: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const sourcePagePreviewResponseSchema = z.object({
  image_url: z.string().url(),
  ocr_text: z.string().nullable(),
});

export const downloadResponseSchema = z.object({
  url: z.string().url(),
});

export const logoPresignRequestSchema = z
  .object({
    filename: z.string().trim().min(1),
    byte_size: z.number().int().positive(),
    content_type: logoContentTypeSchema,
  })
  .strict();

export const logoPresignResponseSchema = z.object({
  upload_url: z.string().url(),
  storage_key: z.string(),
  expires_at: isoTimestampSchema,
  required_headers: z.record(z.string()),
});

export const logoConfirmRequestSchema = z
  .object({
    storage_key: z.string().min(1),
  })
  .strict();

export type SourcePdfPresignRequest = z.infer<typeof sourcePdfPresignRequestSchema>;
export type SourcePdfResponse = z.infer<typeof sourcePdfResponseSchema>;
export type LogoPresignRequest = z.infer<typeof logoPresignRequestSchema>;
