import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';

export const workspaceResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sub_company_name: z.string(),
  sub_company_logo_url: z.string().url().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const updateWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    sub_company_name: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one workspace field is required',
  });

export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
