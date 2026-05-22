import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { createQueuedProcessingJobAttempt, getLatestProcessingJob } from '@submittal/db';

import { type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { getProcessingQueue } from '@/server/processing-queue';
import { findLivePackage, notFound } from '@/server/phase2-records';
import { requestIdFrom } from '@/server/request-id';
import { withWorkspaceFromHeaders } from '@/server/workspace';

type JobKind = 'ocr' | 'classify' | 'extract' | 'batch_order';

const JOB_OPTIONS = {
  retryLimit: 3,
  retryBackoff: true,
} as const;

async function enqueueProcessingJob(input: {
  packageId: string;
  workspaceId: string;
  kind: JobKind;
  sourcePdfId: string | null;
  requestId: string;
}): Promise<boolean> {
  const latest = await getLatestProcessingJob(db, input);
  if (latest && ['queued', 'running', 'succeeded'].includes(latest.status)) return false;

  await createQueuedProcessingJobAttempt(db, {
    packageId: input.packageId,
    sourcePdfId: input.sourcePdfId,
    kind: input.kind,
  });

  await getProcessingQueue().send(
    input.kind,
    {
      packageId: input.packageId,
      workspaceId: input.workspaceId,
      sourcePdfId: input.sourcePdfId,
      requestId: input.requestId,
    },
    {
      ...JOB_OPTIONS,
      singletonKey: `${input.kind}:${input.sourcePdfId ?? input.packageId}`,
    },
  );

  return true;
}

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const requestId = requestIdFrom(req.headers);

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const sourcePdfs = await db
        .select({
          id: schema.sourcePdfs.id,
          itemId: schema.sourcePdfs.itemId,
          processingStatus: schema.sourcePdfs.processingStatus,
        })
      .from(schema.sourcePdfs)
      .where(
          and(
            eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
            eq(schema.sourcePdfs.packageId, pkg.id),
            inArray(schema.sourcePdfs.processingStatus, [
              'uploaded',
              'ocr_running',
              'classifying',
              'extracting',
              'error',
              'cancelled',
            ]),
          ),
        );

    const enqueued: Record<JobKind, number> = {
      ocr: 0,
      classify: 0,
      extract: 0,
      batch_order: 0,
    };

    await db
      .update(schema.packages)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(schema.packages.id, pkg.id));

    for (const pdf of sourcePdfs) {
      const [missingOcrPage] = await db
        .select({ id: schema.sourcePages.id })
        .from(schema.sourcePages)
        .where(
          and(eq(schema.sourcePages.sourcePdfId, pdf.id), eq(schema.sourcePages.hasOcr, false)),
        )
        .limit(1);

      if (missingOcrPage) {
        const didEnqueue = await enqueueProcessingJob({
          packageId: pkg.id,
          workspaceId: ctx.workspaceId,
          kind: 'ocr',
          sourcePdfId: pdf.id,
          requestId,
        });
        if (didEnqueue) {
          enqueued.ocr++;
          await db
            .update(schema.sourcePdfs)
            .set({ processingStatus: 'ocr_running', processingError: null, updatedAt: new Date() })
            .where(eq(schema.sourcePdfs.id, pdf.id));
        }
        continue;
      }

      if (pdf.itemId) {
        const didEnqueue = await enqueueProcessingJob({
          packageId: pkg.id,
          workspaceId: ctx.workspaceId,
          kind: 'extract',
          sourcePdfId: pdf.id,
          requestId,
        });
        if (didEnqueue) {
          enqueued.extract++;
          await db
            .update(schema.sourcePdfs)
            .set({ processingStatus: 'extracting', processingError: null, updatedAt: new Date() })
            .where(eq(schema.sourcePdfs.id, pdf.id));
        }
        continue;
      }

      const didEnqueue = await enqueueProcessingJob({
        packageId: pkg.id,
        workspaceId: ctx.workspaceId,
        kind: 'classify',
        sourcePdfId: pdf.id,
        requestId,
      });
      if (didEnqueue) {
        enqueued.classify++;
        await db
          .update(schema.sourcePdfs)
          .set({ processingStatus: 'classifying', processingError: null, updatedAt: new Date() })
          .where(eq(schema.sourcePdfs.id, pdf.id));
      }
    }

    console.log({
      level: 'info',
      msg: 'process_requested',
      request_id: requestId,
      package_id: pkg.id,
      workspace_id: ctx.workspaceId,
      enqueued,
    });

    return {
      status: 'processing',
      enqueued,
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, {
    status: 202,
    headers: { 'x-request-id': requestId },
  });
}
