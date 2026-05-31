import { NextResponse } from 'next/server';
import { importSavedItemsRequestSchema } from '@submittal/shared/api';

import { parseJson, type RouteContext, uuidParam } from '@/server/api';
import { importSavedItems } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, importSavedItemsRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    return importSavedItems({
      workspaceId: ctx.workspaceId,
      packageId: id,
      savedItemIds: body.saved_item_ids,
    });
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
