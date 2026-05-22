import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import {
  findSourcePdfInLivePackage,
  notFound,
  packageExportedError,
  sourcePdfJson,
} from '@/server/phase2-records';
import { withWorkspaceFromHeaders } from '@/server/workspace';

const ACTIVE_PROCESSING_STATUSES = ['uploaded', 'ocr_running', 'classifying', 'extracting'] as const;
const CANCEL_MESSAGE = 'Processing cancelled by user.';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const sourcePdf = await findSourcePdfInLivePackage(ctx.workspaceId, id);
    if (!sourcePdf) return notFound();

    const [pkg] = await db
      .select({ status: schema.packages.status })
      .from(schema.packages)
      .where(eq(schema.packages.id, sourcePdf.packageId))
      .limit(1);
    if (pkg?.status === 'exported') return packageExportedError();

    const now = new Date();
    const [updated] = await db
      .update(schema.sourcePdfs)
      .set({
        processingStatus: 'cancelled',
        processingError: CANCEL_MESSAGE,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sourcePdfs.id, sourcePdf.id),
          inArray(schema.sourcePdfs.processingStatus, [...ACTIVE_PROCESSING_STATUSES]),
        ),
      )
      .returning();

    if (!updated) return NextResponse.json(sourcePdfJson(sourcePdf), { status: 202 });

    await db
      .update(schema.processingJobs)
      .set({
        status: 'failed',
        error: CANCEL_MESSAGE,
        finishedAt: now,
      })
      .where(
        and(
          eq(schema.processingJobs.packageId, sourcePdf.packageId),
          eq(schema.processingJobs.sourcePdfId, sourcePdf.id),
          inArray(schema.processingJobs.status, ['queued', 'running']),
        ),
      );

    return sourcePdfJson(updated);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 202 });
}
