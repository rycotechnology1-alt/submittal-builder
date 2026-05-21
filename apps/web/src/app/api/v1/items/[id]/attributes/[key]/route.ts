import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  itemAttributeKeySchema,
  updateItemAttributeRequestSchema,
} from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import {
  findLiveItem,
  itemAttributeJson,
  notFound,
  packageExportedError,
} from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

async function resolveAttributeKey<T extends Record<string, string>>(
  context: RouteContext<T>,
  paramName: keyof T & string,
) {
  const params = await context.params;
  const parsed = itemAttributeKeySchema.safeParse(params[paramName]);
  if (!parsed.success) {
    return jsonError(404, 'not_found', 'Not found');
  }
  return parsed.data;
}

export async function PUT(
  req: Request,
  context: RouteContext<{ id: string; key: string }>,
) {
  const itemId = await uuidParam(context, 'id');
  if (itemId instanceof Response) return itemId;
  const key = await resolveAttributeKey(context, 'key');
  if (key instanceof Response) return key;
  const body = await parseJson(req, updateItemAttributeRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const item = await findLiveItem(ctx.workspaceId, itemId);
    if (!item) return notFound();

    const [pkg] = await db
      .select({ status: schema.packages.status })
      .from(schema.packages)
      .where(eq(schema.packages.id, item.packageId))
      .limit(1);
    if (pkg?.status === 'exported') return packageExportedError();

    const now = new Date();
    const [existing] = await db
      .select()
      .from(schema.itemAttributes)
      .where(
        and(eq(schema.itemAttributes.itemId, item.id), eq(schema.itemAttributes.key, key)),
      )
      .limit(1);

    let updated;
    if (existing) {
      [updated] = await db
        .update(schema.itemAttributes)
        .set({
          currentValue: body.value,
          editedByUserAt: now,
          updatedAt: now,
        })
        .where(eq(schema.itemAttributes.id, existing.id))
        .returning();
    } else {
      [updated] = await db
        .insert(schema.itemAttributes)
        .values({
          itemId: item.id,
          key,
          currentValue: body.value,
          originalAiValue: null,
          editedByUserAt: now,
        })
        .returning();
    }

    return itemAttributeJson(updated!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
