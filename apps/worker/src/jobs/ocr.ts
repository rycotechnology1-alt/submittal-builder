import { eq } from 'drizzle-orm';

import type { Db, SourcePdf, SourcePage } from '@submittal/db';
import { schema } from '@submittal/db';
import type { AppStorage } from '@submittal/shared/storage';
import type { TextractOcrClient } from '@submittal/shared/ocr';

import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  loadRunnableSourcePdf,
  type SourcePdfJobData,
} from './common.js';

type OcrDeps = {
  db: Db;
  storage: Pick<AppStorage, 'putObject'>;
  bucket: string;
  ocr: TextractOcrClient;
  enqueue?: (name: string, data: SourcePdfJobData, options: Record<string, unknown>) => Promise<void>;
};

function rawTextractKey(sourcePdf: SourcePdf) {
  return `workspaces/${sourcePdf.workspaceId}/textract_raw/${sourcePdf.id}.json`;
}

export async function runOcrJob(deps: OcrDeps, data: SourcePdfJobData) {
  try {
    const sourcePdf = await loadRunnableSourcePdf(deps.db, data, 'ocr');
    if (!sourcePdf) return null;
    await markJobRunning(deps.db, data, 'ocr', data.sourcePdfId);

    const sourcePages = await deps.db
      .select()
      .from(schema.sourcePages)
      .where(eq(schema.sourcePages.sourcePdfId, sourcePdf.id));
    const needsOcr = sourcePages.filter((page) => !page.hasOcr);
    if (needsOcr.length > 0) {
      const result = await deps.ocr.detectPdfText({ bucket: deps.bucket, key: sourcePdf.storageKey });
      const textByPage = new Map(result.pages.map((page) => [page.pageNumber, page.text]));

      await Promise.all(
        needsOcr.map((page: SourcePage) =>
          deps.db
            .update(schema.sourcePages)
            .set({
              ocrText: textByPage.get(page.pageNumber) ?? '',
              hasOcr: true,
            })
            .where(eq(schema.sourcePages.id, page.id)),
        ),
      );

      await deps.storage.putObject({
        key: rawTextractKey(sourcePdf),
        body: new TextEncoder().encode(JSON.stringify(result.raw)),
        contentType: 'application/json',
      });
    }

    await deps.db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'classifying', processingError: null, updatedAt: new Date() })
      .where(eq(schema.sourcePdfs.id, sourcePdf.id));

    await markJobSucceeded(deps.db, data, 'ocr', data.sourcePdfId);

    await deps.enqueue?.('classify', data, {
      singletonKey: `classify:${data.sourcePdfId}`,
      retryLimit: 3,
      retryBackoff: true,
    });
  } catch (error) {
    await deps.db
      .update(schema.sourcePdfs)
      .set({
        processingStatus: 'error',
        processingError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(schema.sourcePdfs.id, data.sourcePdfId));
    await markJobFailed(deps.db, data, 'ocr', error, data.sourcePdfId);
    throw error;
  }
}
