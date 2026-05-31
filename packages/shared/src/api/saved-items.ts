import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';
import { itemAttributeSchema, itemDocTypeSchema, itemVariantSchema } from './items.js';

export const savedItemSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  doc_type: itemDocTypeSchema,
  original_filename: z.string(),
  byte_size: z.number().int().nonnegative().nullable(),
  page_count: z.number().int().nonnegative().nullable(),
  sha256: z.string(),
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
export type SaveCommonItemRequest = z.infer<typeof saveCommonItemRequestSchema>;
export type SaveCommonItemResponse = z.infer<typeof saveCommonItemResponseSchema>;
export type ImportSavedItemsRequest = z.infer<typeof importSavedItemsRequestSchema>;
export type ImportSavedItemsResponse = z.infer<typeof importSavedItemsResponseSchema>;
