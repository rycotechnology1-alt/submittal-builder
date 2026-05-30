import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { variantSelectionRequestSchema } from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { findLiveItem, itemVariantJson, notFound } from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function PUT(req: Request, context: RouteContext<{ id: string }>) {
  const itemId = await uuidParam(context, 'id');
  if (itemId instanceof Response) return itemId;
  const body = await parseJson(req, variantSelectionRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const item = await findLiveItem(ctx.workspaceId, itemId);
    if (!item) return notFound();

    const variants = await db
      .select()
      .from(schema.itemVariants)
      .where(eq(schema.itemVariants.itemId, item.id))
      .orderBy(asc(schema.itemVariants.sortOrder));

    const variantIds = new Set(variants.map((variant) => variant.id));
    const selectedIds = new Set(body.variant_ids);
    // Every id must belong to this item — reject otherwise.
    for (const id of selectedIds) {
      if (!variantIds.has(id)) {
        return jsonError(400, 'invalid_variant', 'A variant does not belong to this item');
      }
    }

    const now = new Date();
    if (selectedIds.size > 0) {
      await db
        .update(schema.itemVariants)
        .set({ selectedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.itemVariants.itemId, item.id),
            inArray(schema.itemVariants.id, [...selectedIds]),
          ),
        );
    }
    // Clear selection on everything not chosen.
    const unselected = variants
      .filter((variant) => !selectedIds.has(variant.id))
      .map((variant) => variant.id);
    if (unselected.length > 0) {
      await db
        .update(schema.itemVariants)
        .set({ selectedAt: null, updatedAt: now })
        .where(
          and(
            eq(schema.itemVariants.itemId, item.id),
            inArray(schema.itemVariants.id, unselected),
          ),
        );
    }

    const refreshed = await db
      .select()
      .from(schema.itemVariants)
      .where(eq(schema.itemVariants.itemId, item.id))
      .orderBy(asc(schema.itemVariants.sortOrder));

    return {
      variants: refreshed.map(itemVariantJson),
      selected_part_numbers: refreshed
        .filter((variant) => variant.selectedAt !== null)
        .map((variant) => variant.partNumber),
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
