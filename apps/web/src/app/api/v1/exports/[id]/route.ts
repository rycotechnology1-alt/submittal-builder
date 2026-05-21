import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { exportJson, notFound } from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [row] = await db
      .select({
        export: schema.exports,
        packageWorkspaceId: schema.packages.workspaceId,
      })
      .from(schema.exports)
      .innerJoin(schema.packages, eq(schema.exports.packageId, schema.packages.id))
      .where(and(eq(schema.exports.id, id), eq(schema.packages.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!row) return notFound();

    return exportJson(row.export);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
