import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { updateItemRequestSchema } from '@submittal/shared/api';

import { noContent, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLiveItem, itemJson, notFound } from '@/server/phase2-records';

export async function PATCH(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, updateItemRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const item = await findLiveItem(ctx.workspaceId, id);
    if (!item) return notFound();

    const docTypeChange =
      body.doc_type !== undefined && body.doc_type !== item.docType
        ? {
            docType: body.doc_type,
            ...(item.docTypeOriginalAiValue === null
              ? { docTypeOriginalAiValue: item.docType }
              : {}),
          }
        : {};

    const [updated] = await db
      .update(schema.items)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...docTypeChange,
        ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.items.id, item.id))
      .returning();

    return itemJson(updated!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function DELETE(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const item = await findLiveItem(ctx.workspaceId, id);
    if (!item) return notFound();

    await db.transaction(async (tx) => {
      await tx
        .update(schema.items)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.items.id, item.id));
      await tx
        .update(schema.sourcePdfs)
        .set({ itemId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
            eq(schema.sourcePdfs.itemId, item.id),
          ),
        );
    });

    return noContent();
  });

  return result instanceof Response ? result : noContent();
}
