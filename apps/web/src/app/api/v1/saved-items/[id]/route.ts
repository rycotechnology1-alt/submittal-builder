import { NextResponse } from 'next/server';
import { updateSavedItemRequestSchema } from '@submittal/shared/api';

import { noContent, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { deleteSavedItem, savedItemDetail, updateSavedItem } from '@/server/saved-items';
import { notFound } from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const detail = await savedItemDetail(ctx.workspaceId, id);
    return detail ?? notFound();
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function PATCH(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, updateSavedItemRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const savedItem = await updateSavedItem({
      workspaceId: ctx.workspaceId,
      savedItemId: id,
      title: body.title,
      docType: body.doc_type,
    });
    return savedItem ? { saved_item: savedItem } : notFound();
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function DELETE(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const deleted = await deleteSavedItem({ workspaceId: ctx.workspaceId, savedItemId: id });
    return deleted ? noContent() : notFound();
  });

  return result instanceof Response ? result : noContent();
}
