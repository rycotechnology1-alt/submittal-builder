import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { updateItemRequestSchema } from '@submittal/shared/api';

import { noContent, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import {
  bestEffortDeleteObjects,
  updatePackageStatusAfterContentRemoval,
} from '@/server/hard-delete';
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

    const linkedSourcePdfs = await db
      .select({
        id: schema.sourcePdfs.id,
        storageKey: schema.sourcePdfs.storageKey,
        savedItemFileId: schema.sourcePdfs.savedItemFileId,
      })
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
          eq(schema.sourcePdfs.itemId, item.id),
        ),
      );
    const linkedSourcePdfIds = linkedSourcePdfs.map((pdf) => pdf.id);
    const storageKeys = linkedSourcePdfs
      .filter((pdf) => pdf.savedItemFileId === null)
      .map((pdf) => pdf.storageKey);

    await db.transaction(async (tx) => {
      if (linkedSourcePdfIds.length > 0) {
        await tx
          .delete(schema.sourcePdfs)
          .where(inArray(schema.sourcePdfs.id, linkedSourcePdfIds));
      }
      await tx.delete(schema.items).where(eq(schema.items.id, item.id));
      await updatePackageStatusAfterContentRemoval(tx as unknown as typeof db, {
        packageId: item.packageId,
        workspaceId: ctx.workspaceId,
      });
    });

    await bestEffortDeleteObjects(storageKeys);

    return noContent();
  });

  return result instanceof Response ? result : noContent();
}
