import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { latestProcessingJobsForPackage } from '@submittal/db';

import { type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { findLivePackage, notFound } from '@/server/phase2-records';

const activeProcessingStatuses = ['uploaded', 'ocr_running', 'classifying', 'extracting'] as const;

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
          originalFilename: schema.sourcePdfs.originalFilename,
          byteSize: schema.sourcePdfs.byteSize,
          pageCount: schema.sourcePdfs.pageCount,
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

    const terminalCounts = {
      extracted: sourcePdfs.filter((pdf) => pdf.processingStatus === 'extracted').length,
      error: sourcePdfs.filter((pdf) => pdf.processingStatus === 'error').length,
      cancelled: sourcePdfs.filter((pdf) => pdf.processingStatus === 'cancelled').length,
    };
    const hasActiveProcessing = sourcePdfs.some((pdf) =>
      activeProcessingStatuses.includes(pdf.processingStatus as (typeof activeProcessingStatuses)[number]),
    );
    const hasErrors = terminalCounts.error > 0;
    const hasCancelled = terminalCounts.cancelled > 0;
    const processingState =
      pkg.status === 'ready'
        ? 'ready'
        : hasActiveProcessing
          ? 'active'
          : hasErrors
            ? 'blocked'
            : hasCancelled
              ? 'cancelled'
              : sourcePdfs.length === 0
                ? 'idle'
                : 'idle';

    return {
      status: pkg.status,
      processing_state: processingState,
      has_active_processing: hasActiveProcessing,
      has_errors: hasErrors,
      can_cancel: hasActiveProcessing,
      terminal_counts: terminalCounts,
      source_pdfs: sourcePdfs.map((pdf) => ({
        id: pdf.id,
        processing_status: pdf.processingStatus,
        processing_error: pdf.processingError,
        original_filename: pdf.originalFilename,
        byte_size: pdf.byteSize,
        page_count: pdf.pageCount,
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
