import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { createItemRequestSchema } from '@submittal/shared/api';

import { parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import {
  findLivePackage,
  itemAttributeJson,
  itemJson,
  itemSourcePdfJson,
  notFound,
} from '@/server/phase2-records';

const ATTRIBUTE_KEYS = ['manufacturer', 'model_number', 'description', 'spec_section_ref'] as const;

async function packageItemsResponse(workspaceId: string, packageId: string) {
  const items = await db
    .select()
    .from(schema.items)
    .where(
      and(
        eq(schema.items.workspaceId, workspaceId),
        eq(schema.items.packageId, packageId),
        isNull(schema.items.deletedAt),
      ),
    )
    .orderBy(asc(schema.items.sortOrder), asc(schema.items.createdAt));

  if (items.length === 0) return [];
  const itemIds = items.map((item) => item.id);

  const [attributes, sourcePdfs] = await Promise.all([
    db
      .select()
      .from(schema.itemAttributes)
      .where(inArray(schema.itemAttributes.itemId, itemIds)),
    db.select().from(schema.sourcePdfs).where(inArray(schema.sourcePdfs.itemId, itemIds)),
  ]);

  return items.map((item) => ({
    item: itemJson(item),
    attributes: attributes
      .filter((attribute) => attribute.itemId === item.id)
      .map(itemAttributeJson),
    source_pdfs: sourcePdfs.filter((pdf) => pdf.itemId === item.id).map(itemSourcePdfJson),
  }));
}

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();
    return packageItemsResponse(ctx.workspaceId, pkg.id);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, createItemRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    if (body.source_pdf_ids.length > 0) {
      const sourcePdfs = await db
        .select({ id: schema.sourcePdfs.id })
        .from(schema.sourcePdfs)
        .where(
          and(
            eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
            eq(schema.sourcePdfs.packageId, pkg.id),
            inArray(schema.sourcePdfs.id, body.source_pdf_ids),
          ),
        );
      if (sourcePdfs.length !== new Set(body.source_pdf_ids).size) return notFound();
    }

    const [lastItem] = await db
      .select({ sortOrder: schema.items.sortOrder })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.workspaceId, ctx.workspaceId),
          eq(schema.items.packageId, pkg.id),
          isNull(schema.items.deletedAt),
        ),
      )
      .orderBy(desc(schema.items.sortOrder))
      .limit(1);

    const [item] = await db
      .insert(schema.items)
      .values({
        workspaceId: ctx.workspaceId,
        packageId: pkg.id,
        docType: body.doc_type,
        title: body.title,
        sortOrder: (lastItem?.sortOrder ?? -1) + 1,
      })
      .returning();
    if (!item) throw new Error('Item insert returned no row');

    if (body.source_pdf_ids.length > 0) {
      await db
        .update(schema.sourcePdfs)
        .set({ itemId: item.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
            eq(schema.sourcePdfs.packageId, pkg.id),
            inArray(schema.sourcePdfs.id, body.source_pdf_ids),
          ),
        );
    }

    const attributeRows = ATTRIBUTE_KEYS.flatMap((key) => {
      const value = body.attributes?.[key];
      return value === undefined ? [] : [{ itemId: item.id, key, currentValue: value }];
    });
    if (attributeRows.length > 0) {
      await db.insert(schema.itemAttributes).values(attributeRows);
    }

    const [created] = await packageItemsResponse(ctx.workspaceId, pkg.id);
    const response = (await packageItemsResponse(ctx.workspaceId, pkg.id)).find(
      (row) => row.item.id === item.id,
    );
    return response ?? created;
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
