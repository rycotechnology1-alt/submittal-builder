import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { createExportRequestSchema } from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { getProcessingQueue } from '@/server/processing-queue';
import {
  exportJson,
  findLivePackage,
  notFound,
} from '@/server/phase2-records';
import { requestIdFrom } from '@/server/request-id';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const rows = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.packageId, pkg.id))
      .orderBy(desc(schema.exports.createdAt));

    return rows.map(exportJson);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, createExportRequestSchema);
  if (body instanceof Response) return body;
  const requestId = requestIdFrom(req.headers);

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();
    if (pkg.status !== 'ready' && pkg.status !== 'exported') {
      return jsonError(
        409,
        'package_not_ready',
        'Package must finish processing before it can be exported',
      );
    }

    const exportId = crypto.randomUUID();
    const storageKey = `workspaces/${ctx.workspaceId}/exports/${exportId}.pdf`;

    const [created] = await db
      .insert(schema.exports)
      .values({
        id: exportId,
        packageId: pkg.id,
        createdByUserId: ctx.userId,
        storageKey,
        batesPrefix: body.bates_prefix ?? null,
        status: 'pending',
      })
      .returning();
    if (!created) throw new Error('Export insert returned no row');

    await getProcessingQueue().send(
      'render_export',
      {
        workspaceId: ctx.workspaceId,
        packageId: pkg.id,
        exportId: created.id,
        requestId,
      },
      {
        singletonKey: `render_export:${created.id}`,
        retryLimit: 3,
        retryBackoff: true,
      },
    );

    console.log({
      level: 'info',
      msg: 'export_requested',
      request_id: requestId,
      export_id: created.id,
      package_id: pkg.id,
      workspace_id: ctx.workspaceId,
    });

    return { export_id: created.id };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, {
    status: 202,
    headers: { 'x-request-id': requestId },
  });
}
