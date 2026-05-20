// GET /api/v1/me — returns { user, workspace } for the authed session.

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request) {
  const r = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [workspace] = await db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        subCompanyName: schema.workspaces.subCompanyName,
        subCompanyLogoStorageKey: schema.workspaces.subCompanyLogoStorageKey,
        createdAt: schema.workspaces.createdAt,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);

    return {
      user: { id: ctx.userId, email: ctx.email, name: ctx.name },
      workspace: workspace ?? null,
    };
  });

  if (r instanceof Response) return r;
  return NextResponse.json(r);
}
