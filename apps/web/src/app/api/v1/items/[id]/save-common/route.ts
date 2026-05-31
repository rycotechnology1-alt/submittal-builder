import { NextResponse } from 'next/server';
import { saveCommonItemRequestSchema } from '@submittal/shared/api';

import { parseJson, type RouteContext, uuidParam } from '@/server/api';
import { findLiveItem, notFound } from '@/server/phase2-records';
import { saveCommonItem } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, saveCommonItemRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const item = await findLiveItem(ctx.workspaceId, id);
    if (!item) return notFound();
    return saveCommonItem({
      workspaceId: ctx.workspaceId,
      item,
      duplicateAction: body.duplicate_action,
    });
  });

  if (result instanceof Response) return result;
  if ('status' in result && 'body' in result) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.json(result);
}
