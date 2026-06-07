import { NextResponse } from 'next/server';
import {
  itemAttributeKeySchema,
  updateSavedItemAttributeRequestSchema,
} from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { notFound } from '@/server/phase2-records';
import { updateSavedItemAttribute } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

async function attributeKey(context: RouteContext<{ id: string; key: string }>) {
  const params = await context.params;
  const parsed = itemAttributeKeySchema.safeParse(params.key);
  if (!parsed.success) return jsonError(404, 'not_found', 'Not found');
  return parsed.data;
}

export async function PUT(req: Request, context: RouteContext<{ id: string; key: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const key = await attributeKey(context);
  if (key instanceof Response) return key;
  const body = await parseJson(req, updateSavedItemAttributeRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const attribute = await updateSavedItemAttribute({
      workspaceId: ctx.workspaceId,
      savedItemId: id,
      key,
      value: body.value,
    });
    return attribute ? { attribute } : notFound();
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
