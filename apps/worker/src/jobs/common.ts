import { and, eq } from 'drizzle-orm';

import type { Db, SourcePdf } from '@submittal/db';
import { finishProcessingJobAttempt, schema, startProcessingJobAttempt } from '@submittal/db';

export type SourcePdfJobData = {
  workspaceId: string;
  packageId: string;
  sourcePdfId: string;
  /** Correlation id propagated from the originating web request. */
  requestId?: string;
};

export type PackageJobData = {
  workspaceId: string;
  packageId: string;
  /** Correlation id propagated from the originating web request. */
  requestId?: string;
};

export type JobKind = 'ocr' | 'classify' | 'extract' | 'batch_order' | 'render_export';

export type RenderExportJobData = {
  workspaceId: string;
  packageId: string;
  exportId: string;
  /** Correlation id propagated from the originating web request. */
  requestId?: string;
};

export const CANCELLED_PROCESSING_MESSAGE = 'Processing cancelled by user.';

export async function markJobRunning(
  db: Db,
  data: PackageJobData,
  kind: JobKind,
  sourcePdfId?: string,
) {
  await startProcessingJobAttempt(db, {
    packageId: data.packageId,
    sourcePdfId: sourcePdfId ?? null,
    kind,
  });
}

export async function markJobSucceeded(
  db: Db,
  data: PackageJobData,
  kind: JobKind,
  sourcePdfId?: string,
) {
  await finishProcessingJobAttempt(
    db,
    {
      packageId: data.packageId,
      sourcePdfId: sourcePdfId ?? null,
      kind,
    },
    'succeeded',
  );
}

export async function markJobFailed(
  db: Db,
  data: PackageJobData,
  kind: JobKind,
  error: unknown,
  sourcePdfId?: string,
) {
  await finishProcessingJobAttempt(
    db,
    {
      packageId: data.packageId,
      sourcePdfId: sourcePdfId ?? null,
      kind,
    },
    'failed',
    error,
  );
}

export async function loadRunnableSourcePdf(
  db: Db,
  data: SourcePdfJobData,
  kind: Extract<JobKind, 'ocr' | 'classify' | 'extract'>,
): Promise<SourcePdf | null> {
  const [sourcePdf] = await db
    .select()
    .from(schema.sourcePdfs)
    .where(
      and(
        eq(schema.sourcePdfs.id, data.sourcePdfId),
        eq(schema.sourcePdfs.workspaceId, data.workspaceId),
        eq(schema.sourcePdfs.packageId, data.packageId),
      ),
    )
    .limit(1);
  if (!sourcePdf) return null;

  if (sourcePdf.processingStatus === 'cancelled') {
    await markJobRunning(db, data, kind, data.sourcePdfId);
    await markJobFailed(db, data, kind, new Error(CANCELLED_PROCESSING_MESSAGE), data.sourcePdfId);
    return null;
  }

  return sourcePdf;
}

export function normalizeDocType(docType: string) {
  if (docType === 'product_data') return 'product_data';
  if (docType === 'cut_sheet') return 'product_data';
  if (docType === 'warranty') return 'warranty';
  if (docType === 'shop_drawing') return 'shop_drawing';
  if (docType === 'sds') return 'sds';
  if (docType === 'installation') return 'installation';
  if (docType === 'test_report') return 'test_report';
  return 'other';
}
