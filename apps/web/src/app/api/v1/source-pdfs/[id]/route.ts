import { NextResponse } from 'next/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { reassignSourcePdfRequestSchema } from '@submittal/shared/api';

import {
  jsonError,
  noContent,
  parseJson,
  type RouteContext,
  uuidParam,
} from '@/server/api';
import { db, schema } from '@/server/db';
import {
  bestEffortDeleteObjects,
  updatePackageStatusAfterContentRemoval,
} from '@/server/hard-delete';
import {
  findLivePackage,
  findSourcePdfInLivePackage,
  notFound,
  sourcePdfJson,
} from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function PATCH(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, reassignSourcePdfRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const sourcePdf = await findSourcePdfInLivePackage(ctx.workspaceId, id);
    if (!sourcePdf) return notFound();

    if (body.item_id === null) {
      return jsonError(
        409,
        'source_pdf_unassign_unsupported',
        'Source PDFs can be reassigned to another item or deleted from the package',
      );
    }

    if (body.item_id) {
      const [item] = await db
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(
          and(
            eq(schema.items.id, body.item_id),
            eq(schema.items.workspaceId, ctx.workspaceId),
            eq(schema.items.packageId, sourcePdf.packageId),
            isNull(schema.items.deletedAt),
          ),
        )
        .limit(1);
      if (!item) {
        return jsonError(
          409,
          'item_not_in_package',
          'Target item must be a live item in the same package',
        );
      }
    }

    const [updated] = await db
      .update(schema.sourcePdfs)
      .set({ itemId: body.item_id, updatedAt: new Date() })
      .where(eq(schema.sourcePdfs.id, sourcePdf.id))
      .returning();

    return sourcePdfJson(updated!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function DELETE(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const sourcePdf = await findSourcePdfInLivePackage(ctx.workspaceId, id);
    if (!sourcePdf) return notFound();

    const pkg = await findLivePackage(ctx.workspaceId, sourcePdf.packageId);
    if (!pkg) return notFound();

    await db.transaction(async (tx) => {
      await tx.delete(schema.sourcePdfs).where(eq(schema.sourcePdfs.id, sourcePdf.id));

      if (sourcePdf.itemId) {
        const [remainingSourceCount] = await tx
          .select({ value: count() })
          .from(schema.sourcePdfs)
          .where(
            and(
              eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
              eq(schema.sourcePdfs.packageId, sourcePdf.packageId),
              eq(schema.sourcePdfs.itemId, sourcePdf.itemId),
            ),
          );
        if ((remainingSourceCount?.value ?? 0) === 0) {
          await tx.delete(schema.items).where(eq(schema.items.id, sourcePdf.itemId));
        }
      }

      await updatePackageStatusAfterContentRemoval(tx as unknown as typeof db, {
        packageId: sourcePdf.packageId,
        workspaceId: ctx.workspaceId,
      });
    });

    await bestEffortDeleteObjects([sourcePdf.storageKey]);
    return noContent();
  });

  return result instanceof Response ? result : noContent();
}
