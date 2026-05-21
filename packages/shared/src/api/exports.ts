import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';

export const exportStatusSchema = z.enum(['pending', 'rendering', 'ready', 'failed']);

export const exportSchema = z.object({
  id: uuidSchema,
  package_id: uuidSchema,
  status: exportStatusSchema,
  bates_prefix: z.string().nullable(),
  byte_size: z.number().int().nonnegative().nullable(),
  page_count: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const createExportRequestSchema = z
  .object({
    bates_prefix: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[A-Za-z0-9._-]+$/, 'Bates prefix may contain only letters, numbers, . _ -')
      .optional(),
  })
  .strict();

export const createExportResponseSchema = z.object({
  export_id: uuidSchema,
});

export const exportDownloadResponseSchema = z.object({
  url: z.string().url(),
});

export type ExportResponse = z.infer<typeof exportSchema>;
export type ExportStatus = z.infer<typeof exportStatusSchema>;
export type CreateExportRequest = z.infer<typeof createExportRequestSchema>;
export type CreateExportResponse = z.infer<typeof createExportResponseSchema>;
export type ExportDownloadResponse = z.infer<typeof exportDownloadResponseSchema>;
