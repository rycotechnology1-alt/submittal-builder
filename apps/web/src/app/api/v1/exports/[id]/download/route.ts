import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { jsonError, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { notFound } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [row] = await db
      .select({
        export: schema.exports,
      })
      .from(schema.exports)
      .innerJoin(schema.packages, eq(schema.exports.packageId, schema.packages.id))
      .where(and(eq(schema.exports.id, id), eq(schema.packages.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!row) return notFound();
    if (row.export.status !== 'ready') {
      return jsonError(409, 'export_not_ready', `Export is ${row.export.status}`);
    }

    const url = await getStorage().presignGetUrl({
      key: row.export.storageKey,
      expiresInSeconds: 5 * 60,
    });
    return { url };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
