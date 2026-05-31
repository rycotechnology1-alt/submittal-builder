import { and, eq } from 'drizzle-orm';

import type { Db, SourcePdf } from '@submittal/db';
import { schema } from '@submittal/db';
import type { AppStorage } from '@submittal/shared/storage';
import { renderPdfPageToWebp, reconcilePartNumbers } from '@submittal/shared/pdf';
import { deriveVariantRows, type ExtractedVariant } from '@submittal/shared/ai';

import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  loadRunnableSourcePdf,
  type SourcePdfJobData,
} from './common.js';

const ATTRIBUTE_KEYS = ['manufacturer', 'model_number', 'description', 'spec_section_ref'] as const;

type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

type ExtractedField = {
  value: string | null;
  confidence: number;
  source_page: number;
};

type ExtractResult = Record<AttributeKey, ExtractedField> & {
  variants?: ExtractedVariant[];
};

type ExtractAi = {
  extractAttributes(input: { images: Uint8Array[]; sourcePdf: SourcePdf }): Promise<ExtractResult>;
};

type ExtractDeps = {
  db: Db;
  storage: Pick<AppStorage, 'getObjectBytes'>;
  ai: ExtractAi;
  renderPageImages?: (input: { bytes: Uint8Array; pageNumbers: number[] }) => Promise<Uint8Array[]>;
  /** Verify each extracted part number against its source page and recover the
   *  correct SKU (e.g. from the trade size) when it can't be located. */
  reconcilePartNumbers?: typeof reconcilePartNumbers;
  enqueue?: (name: 'batch_order', data: SourcePdfJobData) => Promise<void>;
};

async function defaultRenderPageImages(input: { bytes: Uint8Array; pageNumbers: number[] }) {
  return Promise.all(
    input.pageNumbers.map((pageNumber) =>
      renderPdfPageToWebp({ bytes: input.bytes, pageNumber, maxEdge: 1568 }),
    ),
  );
}

async function upsertAttribute(input: {
  db: Db;
  itemId: string;
  key: AttributeKey;
  field: ExtractedField;
  sourcePageId: string | null;
}) {
  const [existing] = await input.db
    .select({ id: schema.itemAttributes.id })
    .from(schema.itemAttributes)
    .where(
      and(
        eq(schema.itemAttributes.itemId, input.itemId),
        eq(schema.itemAttributes.key, input.key),
      ),
    )
    .limit(1);

  const values = {
    currentValue: input.field.value,
    originalAiValue: input.field.value,
    confidence: input.field.confidence,
    sourcePageId: input.sourcePageId,
    editedByUserAt: null,
    updatedAt: new Date(),
  };

  if (existing) {
    await input.db
      .update(schema.itemAttributes)
      .set(values)
      .where(eq(schema.itemAttributes.id, existing.id));
    return;
  }

  await input.db.insert(schema.itemAttributes).values({
    itemId: input.itemId,
    key: input.key,
    ...values,
  });
}

async function replaceVariants(input: {
  db: Db;
  itemId: string;
  variants: ExtractedVariant[];
  sourcePageByNumber: Map<number, string>;
  bytes: Uint8Array;
  reconcile: typeof reconcilePartNumbers;
}) {
  // Re-extraction is authoritative: clear and rewrite the item's variant table.
  await input.db.delete(schema.itemVariants).where(eq(schema.itemVariants.itemId, input.itemId));

  const rows = deriveVariantRows(input.variants);
  if (rows.length === 0) return;

  // Verify each part number against its source page's text layer; when the
  // extracted SKU can't be found, recover the correct one (e.g. via the trade
  // size) so a mis-read digit is fixed rather than silently shipped.
  let reconciled: Awaited<ReturnType<typeof reconcilePartNumbers>> = [];
  try {
    reconciled = await input.reconcile(
      input.bytes,
      rows.map((row) => ({ partNumber: row.partNumber, size: row.size, pageNumber: row.sourcePage })),
    );
  } catch {
    reconciled = [];
  }

  await input.db.insert(schema.itemVariants).values(
    rows.map((row, i) => ({
      itemId: input.itemId,
      sourcePageId: input.sourcePageByNumber.get(row.sourcePage) ?? null,
      partNumber: reconciled[i]?.partNumber ?? row.partNumber,
      size: row.size,
      secondaryDims: row.secondaryDims ?? null,
      displayLabel: row.displayLabel,
      partNumberVerification: reconciled[i]?.status ?? null,
      sortOrder: row.sortOrder,
      isDefaultForSize: row.isDefaultForSize,
    })),
  );
}

export async function runExtractJob(deps: ExtractDeps, data: SourcePdfJobData) {
  await markJobRunning(deps.db, data, 'extract', data.sourcePdfId);

  try {
    const sourcePdf = await loadRunnableSourcePdf(deps.db, data, 'extract');
    if (!sourcePdf) return null;
    if (!sourcePdf.itemId) throw new Error(`source_pdf has not been classified: ${sourcePdf.id}`);

    await deps.db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'extracting', processingError: null, updatedAt: new Date() })
      .where(eq(schema.sourcePdfs.id, sourcePdf.id));

    const sourcePages = await deps.db
      .select()
      .from(schema.sourcePages)
      .where(eq(schema.sourcePages.sourcePdfId, sourcePdf.id));
    const sourcePageByNumber = new Map(sourcePages.map((page) => [page.pageNumber, page.id]));

    const bytes = await deps.storage.getObjectBytes(sourcePdf.storageKey);
    const pageNumbers = Array.from({ length: sourcePdf.pageCount ?? sourcePages.length }, (_, i) => i + 1);
    const images = await (deps.renderPageImages ?? defaultRenderPageImages)({ bytes, pageNumbers });
    const extracted = await deps.ai.extractAttributes({ images, sourcePdf });

    for (const key of ATTRIBUTE_KEYS) {
      const field = extracted[key];
      await upsertAttribute({
        db: deps.db,
        itemId: sourcePdf.itemId,
        key,
        field,
        sourcePageId: sourcePageByNumber.get(field.source_page) ?? null,
      });
    }

    await replaceVariants({
      db: deps.db,
      itemId: sourcePdf.itemId,
      variants: extracted.variants ?? [],
      sourcePageByNumber,
      bytes,
      reconcile: deps.reconcilePartNumbers ?? reconcilePartNumbers,
    });

    await deps.db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'extracted', processingError: null, updatedAt: new Date() })
      .where(eq(schema.sourcePdfs.id, sourcePdf.id));

    await markJobSucceeded(deps.db, data, 'extract', data.sourcePdfId);

    const packageSourcePdfs = await deps.db
      .select({
        id: schema.sourcePdfs.id,
        itemId: schema.sourcePdfs.itemId,
        processingStatus: schema.sourcePdfs.processingStatus,
      })
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.workspaceId, data.workspaceId),
          eq(schema.sourcePdfs.packageId, data.packageId),
        ),
      );
    const allExtracted =
      packageSourcePdfs.length > 0 &&
      packageSourcePdfs.every((pdf) => pdf.itemId && pdf.processingStatus === 'extracted');
    if (allExtracted) await deps.enqueue?.('batch_order', data);
  } catch (error) {
    await deps.db
      .update(schema.sourcePdfs)
      .set({
        processingStatus: 'error',
        processingError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(schema.sourcePdfs.id, data.sourcePdfId));
    await markJobFailed(deps.db, data, 'extract', error, data.sourcePdfId);
    throw error;
  }
}
