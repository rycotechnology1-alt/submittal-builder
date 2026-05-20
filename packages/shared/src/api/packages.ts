import { z } from 'zod';

import { isoTimestampSchema, listEnvelopeSchema, uuidSchema } from './common.js';

export const packageStatusSchema = z.enum(['draft', 'processing', 'ready', 'exported']);

export const packageSchema = z.object({
  id: uuidSchema,
  project_id: uuidSchema,
  submittal_number: z.string(),
  spec_section: z.string(),
  revision: z.string(),
  submittal_date: z.string().nullable(),
  title: z.string().nullable(),
  status: packageStatusSchema,
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const packageDetailResponseSchema = packageSchema.extend({
  source_pdf_count: z.number().int().nonnegative(),
  item_count: z.number().int().nonnegative(),
  latest_export: z.null(),
});

export const packageListResponseSchema = listEnvelopeSchema(packageSchema);

export const createPackageRequestSchema = z
  .object({
    submittal_number: z.string().trim().min(1),
    spec_section: z.string().trim().min(1),
    revision: z.string().trim().min(1).optional(),
    submittal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    title: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const updatePackageRequestSchema = createPackageRequestSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one package field is required',
  });

export const packageStatusResponseSchema = z.object({
  status: packageStatusSchema,
  source_pdfs: z.array(
    z.object({
      id: uuidSchema,
      processing_status: z.enum(['uploaded', 'ocr_running', 'classifying', 'extracted', 'error']),
      processing_error: z.string().nullable().optional(),
    }),
  ),
  jobs_summary: z.object({
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export type PackageResponse = z.infer<typeof packageSchema>;
export type PackageDetailResponse = z.infer<typeof packageDetailResponseSchema>;
export type CreatePackageRequest = z.infer<typeof createPackageRequestSchema>;
export type UpdatePackageRequest = z.infer<typeof updatePackageRequestSchema>;
export type PackageStatusResponse = z.infer<typeof packageStatusResponseSchema>;
