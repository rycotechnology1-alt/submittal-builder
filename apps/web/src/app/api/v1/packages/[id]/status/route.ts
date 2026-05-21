import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { latestProcessingJobsForPackage } from '@submittal/db';

import { type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLivePackage, notFound } from '@/server/phase2-records';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const [sourcePdfs, jobs] = await Promise.all([
      db
        .select({
          id: schema.sourcePdfs.id,
          processingStatus: schema.sourcePdfs.processingStatus,
          processingError: schema.sourcePdfs.processingError,
        })
        .from(schema.sourcePdfs)
        .where(
          and(
            eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
            eq(schema.sourcePdfs.packageId, pkg.id),
          ),
        ),
      latestProcessingJobsForPackage(db, pkg.id),
    ]);

    return {
      status: pkg.status,
      source_pdfs: sourcePdfs.map((pdf) => ({
        id: pdf.id,
        processing_status: pdf.processingStatus,
        processing_error: pdf.processingError,
      })),
      jobs_summary: {
        queued: jobs.filter((job) => job.status === 'queued').length,
        running: jobs.filter((job) => job.status === 'running').length,
        failed: jobs.filter((job) => job.status === 'failed').length,
      },
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
