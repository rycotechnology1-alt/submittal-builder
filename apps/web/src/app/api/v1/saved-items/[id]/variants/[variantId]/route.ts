import { NextResponse } from 'next/server';
import { updateSavedItemVariantRequestSchema } from '@submittal/shared/api';

import { jsonError, noContent, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { notFound } from '@/server/phase2-records';
import { deleteSavedItemVariant, updateSavedItemVariant } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function PATCH(
  req: Request,
  context: RouteContext<{ id: string; variantId: string }>,
) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const variantId = await uuidParam(context, 'variantId');
  if (variantId instanceof Response) return variantId;
  const body = await parseJson(req, updateSavedItemVariantRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const variant = await updateSavedItemVariant({
      workspaceId: ctx.workspaceId,
      savedItemId: id,
      variantId,
      patch: {
        ...(body.part_number !== undefined ? { partNumber: body.part_number } : {}),
        ...(body.size !== undefined ? { size: body.size } : {}),
        ...(body.secondary_dims !== undefined ? { secondaryDims: body.secondary_dims } : {}),
        ...(body.display_label !== undefined ? { displayLabel: body.display_label } : {}),
        ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
        ...(body.is_default_for_size !== undefined
          ? { isDefaultForSize: body.is_default_for_size }
          : {}),
        ...(body.saved_item_source_page_id !== undefined
          ? { savedItemSourcePageId: body.saved_item_source_page_id }
          : {}),
      },
    });
    if (variant === false) {
      return jsonError(
        422,
        'invalid_saved_item_source_page',
        'Source page does not belong to this saved item',
      );
    }
    return variant ? { variant } : notFound();
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function DELETE(
  req: Request,
  context: RouteContext<{ id: string; variantId: string }>,
) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const variantId = await uuidParam(context, 'variantId');
  if (variantId instanceof Response) return variantId;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const deleted = await deleteSavedItemVariant({
      workspaceId: ctx.workspaceId,
      savedItemId: id,
      variantId,
    });
    return deleted ? noContent() : notFound();
  });

  return result instanceof Response ? result : noContent();
}
