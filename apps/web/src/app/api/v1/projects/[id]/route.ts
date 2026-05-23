import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { updateProjectRequestSchema } from '@submittal/shared/api';

import { noContent, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import {
  findLiveProject,
  findProjectInWorkspace,
  notFound,
  projectJson,
  projectPackageSummaryJson,
} from '@/server/phase2-records';
import { bestEffortDeleteObjects, collectPackageStorageKeys } from '@/server/hard-delete';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const project = await findLiveProject(ctx.workspaceId, id);
    if (!project) return notFound();

    const packages = await db
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

    return {
      project: projectJson(project),
      packages: packages.map(projectPackageSummaryJson),
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function PATCH(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, updateProjectRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const project = await findLiveProject(ctx.workspaceId, id);
    if (!project) return notFound();

    const [updated] = await db
      .update(schema.projects)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.project_number !== undefined ? { projectNumber: body.project_number } : {}),
        ...(body.gc_name !== undefined ? { gcName: body.gc_name } : {}),
        ...(body.architect_name !== undefined ? { architectName: body.architect_name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, project.id))
      .returning();

    return projectJson(updated!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function DELETE(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const project = await findProjectInWorkspace(ctx.workspaceId, id);
    if (!project) return notFound();

    const pkgs = await db
      .select({ id: schema.packages.id })
      .from(schema.packages)
      .where(eq(schema.packages.projectId, project.id));

    const keyGroups = await Promise.all(
      pkgs.map((p) => collectPackageStorageKeys(p.id, ctx.workspaceId)),
    );
    const keys = keyGroups.flat();

    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));
    await bestEffortDeleteObjects(keys);

    return noContent();
  });

  return result instanceof Response ? result : noContent();
}
