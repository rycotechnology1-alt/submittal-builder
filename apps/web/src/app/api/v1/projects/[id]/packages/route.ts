import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createPackageRequestSchema } from '@submittal/shared/api';

import { parseJson, parseUuid, type RouteContext } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLiveProject, notFound, packageJson } from '@/server/phase2-records';

async function projectIdParam(context: RouteContext<{ id?: string; projectId?: string }>) {
  const params = await context.params;
  return parseUuid(params.projectId ?? params.id);
}

export async function GET(req: Request, context: RouteContext<{ id?: string; projectId?: string }>) {
  const projectId = await projectIdParam(context);
  if (projectId instanceof Response) return projectId;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const project = await findLiveProject(ctx.workspaceId, projectId);
    if (!project) return notFound();

    const rows = await db
      .select()
      .from(schema.packages)
      .where(
        and(
          eq(schema.packages.workspaceId, ctx.workspaceId),
          eq(schema.packages.projectId, project.id),
          isNull(schema.packages.deletedAt),
        ),
      )
      .orderBy(desc(schema.packages.updatedAt));

    return { data: rows.map(packageJson), next_cursor: null };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(
  req: Request,
  context: RouteContext<{ id?: string; projectId?: string }>,
) {
  const projectId = await projectIdParam(context);
  if (projectId instanceof Response) return projectId;
  const body = await parseJson(req, createPackageRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const project = await findLiveProject(ctx.workspaceId, projectId);
    if (!project) return notFound();

    const [pkg] = await db
      .insert(schema.packages)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: project.id,
        submittalNumber: body.submittal_number,
        specSection: body.spec_section,
        revision: body.revision ?? 'R0',
        submittalDate: body.submittal_date ?? null,
        title: body.title ?? null,
      })
      .returning();

    return packageJson(pkg!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
