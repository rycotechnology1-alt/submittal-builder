import { NextResponse } from 'next/server';

import { type RouteContext, uuidParam } from '@/server/api';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLivePackage, notFound } from '@/server/phase2-records';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    return {
      status: pkg.status,
      source_pdfs: [],
      jobs_summary: { queued: 0, running: 0, failed: 0 },
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
