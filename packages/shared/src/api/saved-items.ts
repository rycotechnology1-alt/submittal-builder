import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';
import {
  itemAttributeKeySchema,
  itemAttributeSchema,
  itemDocTypeSchema,
  itemSourcePdfSchema,
  itemVariantSecondaryDimsSchema,
  itemVariantSchema,
} from './items.js';

export const savedItemSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  doc_type: itemDocTypeSchema,
  doc_type_confidence: z.number().nullable(),
  doc_type_original_ai_value: z.string().nullable(),
  original_filename: z.string(),
  byte_size: z.number().int().nonnegative().nullable(),
  page_count: z.number().int().nonnegative().nullable(),
  sha256: z.string(),
  processing_status: itemSourcePdfSchema.shape.processing_status,
  processing_error: z.string().nullable(),
  attributes: z.array(
    itemAttributeSchema.omit({ source_page_id: true }).extend({
      saved_item_source_page_id: uuidSchema.nullable(),
    }),
  ),
  variant_count: z.number().int().nonnegative(),
  updated_at: isoTimestampSchema,
});

export const savedItemsListResponseSchema = z.object({
  data: z.array(savedItemSummarySchema),
});

export const savedItemFileSchema = z.object({
  id: uuidSchema,
  original_filename: z.string(),
  byte_size: z.number().int().nonnegative().nullable(),
  sha256: z.string(),
  page_count: z.number().int().nonnegative().nullable(),
  processing_status: itemSourcePdfSchema.shape.processing_status,
  processing_error: z.string().nullable(),
});

export const savedItemSourcePageSchema = z.object({
  id: uuidSchema,
  page_number: z.number().int().positive(),
  has_ocr: z.boolean(),
});

export const savedItemAttributeSchema = itemAttributeSchema.omit({ source_page_id: true }).extend({
  saved_item_source_page_id: uuidSchema.nullable(),
});

export const savedItemVariantSchema = itemVariantSchema
  .omit({ selected: true, source_page_id: true })
  .extend({
    saved_item_source_page_id: uuidSchema.nullable(),
  });

export const savedItemDetailResponseSchema = z.object({
  saved_item: savedItemSummarySchema,
  file: savedItemFileSchema,
  source_pages: z.array(savedItemSourcePageSchema),
  attributes: z.array(savedItemAttributeSchema),
  variants: z.array(savedItemVariantSchema),
});

export const updateSavedItemRequestSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    doc_type: itemDocTypeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one saved item field is required',
  });

export const updateSavedItemAttributeRequestSchema = z
  .object({
    value: z.string().trim().min(1).nullable(),
  })
  .strict();

export const savedItemVariantRequestSchema = z
  .object({
    part_number: z.string().trim().min(1),
    size: z.string().trim().min(1),
    secondary_dims: itemVariantSecondaryDimsSchema.nullable().optional(),
    display_label: z.string().trim().min(1),
    sort_order: z.number().int().min(0),
    is_default_for_size: z.boolean(),
    saved_item_source_page_id: uuidSchema.nullable().optional(),
  })
  .strict();

export const updateSavedItemVariantRequestSchema = savedItemVariantRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one variant field is required',
  });

export const savedItemUploadPresignRequestSchema = z
  .object({
    filename: z.string().trim().min(1),
    byte_size: z.number().int().positive(),
    content_type: z.literal('application/pdf'),
  })
  .strict();

export const savedItemUploadConfirmRequestSchema = z
  .object({
    storage_key: z.string().min(1),
    original_filename: z.string().trim().min(1),
  })
  .strict();

export const savedItemUploadPresignResponseSchema = z.object({
  upload_url: z.string(),
  storage_key: z.string(),
  expires_at: isoTimestampSchema,
  required_headers: z.record(z.string()),
});

export const savedItemUploadConfirmResponseSchema = z.object({
  saved_item: savedItemSummarySchema,
  duplicate: z.boolean(),
  processing_status: itemSourcePdfSchema.shape.processing_status,
});

export const saveCommonItemRequestSchema = z
  .object({
    duplicate_action: z.enum(['update', 'keep_existing']).optional(),
  })
  .strict();

export const saveCommonItemResponseSchema = z.object({
  saved_item: savedItemSummarySchema,
  created: z.boolean(),
  updated: z.boolean(),
});

export const importSavedItemsRequestSchema = z
  .object({
    saved_item_ids: z.array(uuidSchema).min(1),
  })
  .strict();

export const importSavedItemsResponseSchema = z.object({
  imported_item_ids: z.array(uuidSchema),
});

export const savedItemVariantOptionSchema = itemVariantSchema.omit({ selected: true });

export type SavedItemSummary = z.infer<typeof savedItemSummarySchema>;
export type SavedItemsListResponse = z.infer<typeof savedItemsListResponseSchema>;
export type SavedItemDetailResponse = z.infer<typeof savedItemDetailResponseSchema>;
export type SavedItemAttribute = z.infer<typeof savedItemAttributeSchema>;
export type SavedItemVariant = z.infer<typeof savedItemVariantSchema>;
export type UpdateSavedItemRequest = z.infer<typeof updateSavedItemRequestSchema>;
export type UpdateSavedItemAttributeRequest = z.infer<typeof updateSavedItemAttributeRequestSchema>;
export type SavedItemVariantRequest = z.infer<typeof savedItemVariantRequestSchema>;
export type UpdateSavedItemVariantRequest = z.infer<typeof updateSavedItemVariantRequestSchema>;
export type SavedItemUploadPresignRequest = z.infer<typeof savedItemUploadPresignRequestSchema>;
export type SavedItemUploadConfirmRequest = z.infer<typeof savedItemUploadConfirmRequestSchema>;
export type SavedItemUploadConfirmResponse = z.infer<typeof savedItemUploadConfirmResponseSchema>;
export type SaveCommonItemRequest = z.infer<typeof saveCommonItemRequestSchema>;
export type SaveCommonItemResponse = z.infer<typeof saveCommonItemResponseSchema>;
export type ImportSavedItemsRequest = z.infer<typeof importSavedItemsRequestSchema>;
export type ImportSavedItemsResponse = z.infer<typeof importSavedItemsResponseSchema>;
