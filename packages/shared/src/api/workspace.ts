import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';

export const workspaceResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sub_company_name: z.string(),
  sub_company_logo_url: z.string().url().nullable(),
  address_street: z.string().nullable(),
  address_city: z.string().nullable(),
  address_state: z.string().nullable(),
  address_zip: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_website: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const updateWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    sub_company_name: z.string().trim().min(1).optional(),
    // Optional company details — pass null (or an empty string, normalized to
    // null server-side) to clear a field.
    address_street: z.string().trim().nullable().optional(),
    address_city: z.string().trim().nullable().optional(),
    address_state: z.string().trim().nullable().optional(),
    address_zip: z.string().trim().nullable().optional(),
    contact_phone: z.string().trim().nullable().optional(),
    contact_email: z.string().trim().nullable().optional(),
    contact_website: z.string().trim().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one workspace field is required',
  });

export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
