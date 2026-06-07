import { NextResponse } from 'next/server';
import { savedItemVariantRequestSchema } from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { notFound } from '@/server/phase2-records';
import { createSavedItemVariant } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, savedItemVariantRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const variant = await createSavedItemVariant({
      workspaceId: ctx.workspaceId,
      savedItemId: id,
      partNumber: body.part_number,
      size: body.size,
      secondaryDims: body.secondary_dims ?? null,
      displayLabel: body.display_label,
      sortOrder: body.sort_order,
      isDefaultForSize: body.is_default_for_size,
      savedItemSourcePageId: body.saved_item_source_page_id ?? null,
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
  return NextResponse.json(result, { status: 201 });
}
