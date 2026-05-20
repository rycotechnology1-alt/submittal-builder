import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import { createProjectRequestSchema } from '@submittal/shared/api';

import { parseJson } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { projectJson } from '@/server/phase2-records';

export async function GET(req: Request) {
  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim();
    const filters = [
      eq(schema.projects.workspaceId, ctx.workspaceId),
      isNull(schema.projects.deletedAt),
      ...(q ? [ilike(schema.projects.name, `%${q}%`)] : []),
    ];

    const rows = await db
      .select()
      .from(schema.projects)
      .where(and(...filters))
      .orderBy(desc(schema.projects.updatedAt));

    return { data: rows.map(projectJson), next_cursor: null };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await parseJson(req, createProjectRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [project] = await db
      .insert(schema.projects)
      .values({
        workspaceId: ctx.workspaceId,
        name: body.name,
        projectNumber: body.project_number ?? null,
        gcName: body.gc_name ?? null,
        architectName: body.architect_name ?? null,
      })
      .returning();
    return projectJson(project!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
