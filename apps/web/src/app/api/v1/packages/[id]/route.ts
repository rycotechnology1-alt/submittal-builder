import { NextResponse } from 'next/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { updatePackageRequestSchema } from '@submittal/shared/api';

import { noContent, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLivePackage, notFound, packageJson } from '@/server/phase2-records';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const [[sourcePdfCount], [itemCount]] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.sourcePdfs)
        .where(
          and(
            eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
            eq(schema.sourcePdfs.packageId, pkg.id),
          ),
        ),
      db
        .select({ value: count() })
        .from(schema.items)
        .where(
          and(
            eq(schema.items.workspaceId, ctx.workspaceId),
            eq(schema.items.packageId, pkg.id),
            isNull(schema.items.deletedAt),
          ),
        ),
    ]);

    return {
      ...packageJson(pkg),
      source_pdf_count: sourcePdfCount?.value ?? 0,
      item_count: itemCount?.value ?? 0,
      latest_export: null,
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function PATCH(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, updatePackageRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const [updated] = await db
      .update(schema.packages)
      .set({
        ...(body.submittal_number !== undefined ? { submittalNumber: body.submittal_number } : {}),
        ...(body.spec_section !== undefined ? { specSection: body.spec_section } : {}),
        ...(body.revision !== undefined ? { revision: body.revision } : {}),
        ...(body.submittal_date !== undefined ? { submittalDate: body.submittal_date } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.packages.id, pkg.id))
      .returning();

    return packageJson(updated!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function DELETE(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    await db
      .update(schema.packages)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.packages.id, pkg.id));

    return noContent();
  });

  return result instanceof Response ? result : noContent();
}
