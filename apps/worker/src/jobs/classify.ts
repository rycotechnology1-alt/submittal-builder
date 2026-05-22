import { eq } from 'drizzle-orm';

import type { Db, SourcePdf } from '@submittal/db';
import { schema } from '@submittal/db';
import type { AppStorage } from '@submittal/shared/storage';
import { renderPdfPageToWebp } from '@submittal/shared/pdf';

import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  loadRunnableSourcePdf,
  normalizeDocType,
  type SourcePdfJobData,
} from './common.js';

type ClassifyResult = {
  doc_type: string;
  confidence: number;
};

type ClassifyAi = {
  classifyDocument(input: { images: Uint8Array[]; sourcePdf: SourcePdf }): Promise<ClassifyResult>;
};

type ClassifyDeps = {
  db: Db;
  storage: Pick<AppStorage, 'getObjectBytes'>;
  ai: ClassifyAi;
  renderPageImages?: (input: { bytes: Uint8Array; pageNumbers: number[] }) => Promise<Uint8Array[]>;
};

function samplePages(pageCount: number | null): number[] {
  const count = pageCount ?? 1;
  return Array.from(new Set([1, Math.ceil(count / 2), count])).filter((n) => n >= 1);
}

async function defaultRenderPageImages(input: { bytes: Uint8Array; pageNumbers: number[] }) {
  return Promise.all(
    input.pageNumbers.map((pageNumber) =>
      renderPdfPageToWebp({ bytes: input.bytes, pageNumber, maxEdge: 1568 }),
    ),
  );
}

export async function runClassifyJob(deps: ClassifyDeps, data: SourcePdfJobData) {
  await markJobRunning(deps.db, data, 'classify', data.sourcePdfId);

  try {
    const sourcePdf = await loadRunnableSourcePdf(deps.db, data, 'classify');
    if (!sourcePdf) return null;

    const bytes = await deps.storage.getObjectBytes(sourcePdf.storageKey);
    const images = await (deps.renderPageImages ?? defaultRenderPageImages)({
      bytes,
      pageNumbers: samplePages(sourcePdf.pageCount),
    });
    const classification = await deps.ai.classifyDocument({ images, sourcePdf });
    const docType = normalizeDocType(classification.doc_type);

    const [existingItem] = sourcePdf.itemId
      ? await deps.db.select().from(schema.items).where(eq(schema.items.id, sourcePdf.itemId)).limit(1)
      : [];

    const item =
      existingItem ??
      (
        await deps.db
          .insert(schema.items)
          .values({
            workspaceId: data.workspaceId,
            packageId: data.packageId,
            docType,
            docTypeConfidence: classification.confidence,
            docTypeOriginalAiValue: docType,
            title: sourcePdf.originalFilename,
          })
          .returning()
      )[0];
    if (!item) throw new Error('item insert returned no row');

    if (existingItem) {
      await deps.db
        .update(schema.items)
        .set({
          docType,
          docTypeConfidence: classification.confidence,
          docTypeOriginalAiValue: existingItem.docTypeOriginalAiValue ?? docType,
          updatedAt: new Date(),
        })
        .where(eq(schema.items.id, existingItem.id));
    }

    await deps.db
      .update(schema.sourcePdfs)
      .set({
        itemId: item.id,
        processingStatus: 'extracting',
        processingError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.sourcePdfs.id, sourcePdf.id));

    await markJobSucceeded(deps.db, data, 'classify', data.sourcePdfId);
    return item;
  } catch (error) {
    await deps.db
      .update(schema.sourcePdfs)
      .set({
        processingStatus: 'error',
        processingError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(schema.sourcePdfs.id, data.sourcePdfId));
    await markJobFailed(deps.db, data, 'classify', error, data.sourcePdfId);
    throw error;
  }
}
