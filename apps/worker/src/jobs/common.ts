import type { Db } from '@submittal/db';
import {
  finishProcessingJobAttempt,
  startProcessingJobAttempt,
} from '@submittal/db';

export type SourcePdfJobData = {
  workspaceId: string;
  packageId: string;
  sourcePdfId: string;
};

export type PackageJobData = {
  workspaceId: string;
  packageId: string;
};

export type JobKind = 'ocr' | 'classify' | 'extract' | 'batch_order' | 'render_export';

export type RenderExportJobData = {
  workspaceId: string;
  packageId: string;
  exportId: string;
};

export async function markJobRunning(db: Db, data: PackageJobData, kind: JobKind, sourcePdfId?: string) {
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
