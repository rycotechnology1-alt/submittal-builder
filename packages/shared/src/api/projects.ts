import { z } from 'zod';

import { isoTimestampSchema, listEnvelopeSchema, uuidSchema } from './common.js';

export const projectSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  project_number: z.string().nullable(),
  gc_name: z.string().nullable(),
  architect_name: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const projectPackageSummarySchema = z.object({
  id: uuidSchema,
  submittal_number: z.string(),
  revision: z.string(),
  status: z.enum(['draft', 'processing', 'ready', 'exported']),
  updated_at: isoTimestampSchema,
});

export const projectDetailResponseSchema = z.object({
  project: projectSchema,
  packages: z.array(projectPackageSummarySchema),
});

export const projectListResponseSchema = listEnvelopeSchema(projectSchema);

export const createProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    project_number: z.string().trim().min(1).nullable().optional(),
    gc_name: z.string().trim().min(1).nullable().optional(),
    architect_name: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const updateProjectRequestSchema = createProjectRequestSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one project field is required',
  });

export type ProjectResponse = z.infer<typeof projectSchema>;
export type ProjectDetailResponse = z.infer<typeof projectDetailResponseSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
