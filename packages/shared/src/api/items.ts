import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';

export const itemDocTypeSchema = z.enum([
  'product_data',
  'shop_drawing',
  'sds',
  'warranty',
  'installation',
  'test_report',
  'other',
]);

export const itemAttributeKeySchema = z.enum([
  'manufacturer',
  'model_number',
  'description',
  'spec_section_ref',
]);

export const itemSchema = z.object({
  id: uuidSchema,
  package_id: uuidSchema,
  doc_type: itemDocTypeSchema,
  doc_type_confidence: z.number().nullable(),
  doc_type_original_ai_value: z.string().nullable(),
  sort_order: z.number().int(),
  title: z.string(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const itemAttributeSchema = z.object({
  key: itemAttributeKeySchema,
  current_value: z.string().nullable(),
  original_ai_value: z.string().nullable(),
  confidence: z.number().nullable(),
  source_page_id: uuidSchema.nullable(),
  edited_by_user_at: isoTimestampSchema.nullable(),
});

export const itemSourcePdfSchema = z.object({
  id: uuidSchema,
  original_filename: z.string(),
  page_count: z.number().int().nullable(),
});

export const packageItemResponseSchema = z.object({
  item: itemSchema,
  attributes: z.array(itemAttributeSchema),
  source_pdfs: z.array(itemSourcePdfSchema),
});

export const createItemRequestSchema = z
  .object({
    source_pdf_ids: z.array(uuidSchema),
    doc_type: itemDocTypeSchema,
    title: z.string().trim().min(1),
    attributes: z
      .object({
        manufacturer: z.string().trim().min(1).nullable().optional(),
        model_number: z.string().trim().min(1).nullable().optional(),
        description: z.string().trim().min(1).nullable().optional(),
        spec_section_ref: z.string().trim().min(1).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateItemRequestSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    doc_type: itemDocTypeSchema.optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one item field is required',
  });

export const reorderItemsRequestSchema = z
  .object({
    order: z
      .array(
        z.object({
          item_id: uuidSchema,
          sort_order: z.number().int().min(0),
        }),
      )
      .min(1),
  })
  .strict();

export type PackageItemResponse = z.infer<typeof packageItemResponseSchema>;
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;
export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;
export type ReorderItemsRequest = z.infer<typeof reorderItemsRequestSchema>;
