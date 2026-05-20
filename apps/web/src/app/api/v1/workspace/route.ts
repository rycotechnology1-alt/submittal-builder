import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { updateWorkspaceRequestSchema } from '@submittal/shared/api';

import { parseJson } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { workspaceJson } from '@/server/phase2-records';

export async function GET(req: Request) {
  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    return workspace ? workspaceJson(workspace) : null;
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function PATCH(req: Request) {
  const body = await parseJson(req, updateWorkspaceRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [workspace] = await db
      .update(schema.workspaces)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.sub_company_name !== undefined ? { subCompanyName: body.sub_company_name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .returning();
    return workspace ? workspaceJson(workspace) : null;
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
