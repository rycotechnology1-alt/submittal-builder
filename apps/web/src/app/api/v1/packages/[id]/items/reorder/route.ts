import { NextResponse } from 'next/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { reorderItemsRequestSchema } from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLivePackage, notFound, packageExportedError } from '@/server/phase2-records';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, reorderItemsRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();
    if (pkg.status === 'exported') return packageExportedError();

    const itemIds = body.order.map((row) => row.item_id);
    if (new Set(itemIds).size !== itemIds.length) {
      return jsonError(422, 'validation_failed', 'Duplicate item IDs are not allowed');
    }

    const matchingItems = await db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.workspaceId, ctx.workspaceId),
          eq(schema.items.packageId, pkg.id),
          isNull(schema.items.deletedAt),
          inArray(schema.items.id, itemIds),
        ),
      );
    if (matchingItems.length !== itemIds.length) return notFound();

    await db.transaction(async (tx) => {
      for (const row of body.order) {
        await tx
          .update(schema.items)
          .set({ sortOrder: row.sort_order, updatedAt: new Date() })
          .where(eq(schema.items.id, row.item_id));
      }
    });

    return { ok: true };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
