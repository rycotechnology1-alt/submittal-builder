import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { findLivePackage, notFound } from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

const ACTIVE_PROCESSING_STATUSES = ['uploaded', 'ocr_running', 'classifying', 'extracting'] as const;
const CANCEL_MESSAGE = 'Processing cancelled by user.';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const now = new Date();
    const cancelled = await db
      .update(schema.sourcePdfs)
      .set({
        processingStatus: 'cancelled',
        processingError: CANCEL_MESSAGE,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
          eq(schema.sourcePdfs.packageId, pkg.id),
          inArray(schema.sourcePdfs.processingStatus, [...ACTIVE_PROCESSING_STATUSES]),
        ),
      )
      .returning({ id: schema.sourcePdfs.id });

    if (cancelled.length > 0) {
      await db
        .update(schema.processingJobs)
        .set({
          status: 'failed',
          error: CANCEL_MESSAGE,
          finishedAt: now,
        })
        .where(
          and(
            eq(schema.processingJobs.packageId, pkg.id),
            inArray(
              schema.processingJobs.sourcePdfId,
              cancelled.map((pdf) => pdf.id),
            ),
            inArray(schema.processingJobs.status, ['queued', 'running']),
          ),
        );
    }

    return {
      processing_state: 'cancelled' as const,
      cancelled_source_pdf_count: cancelled.length,
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 202 });
}
