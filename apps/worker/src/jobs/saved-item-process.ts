import { and, eq } from 'drizzle-orm';

import type { Db, SavedItemFile } from '@submittal/db';
import { schema } from '@submittal/db';
import { deriveVariantRows, type ExtractedVariant } from '@submittal/shared/ai';
import type { TextractOcrClient } from '@submittal/shared/ocr';
import { reconcilePartNumbers, renderPdfPageToWebp } from '@submittal/shared/pdf';
import type { AppStorage } from '@submittal/shared/storage';

import { normalizeDocType } from './common.js';

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

type SavedItemProcessAi = {
  classifyDocument(input: {
    images: Uint8Array[];
    sourcePdf: SavedItemFile;
  }): Promise<{ doc_type: string; confidence: number }>;
  extractAttributes(input: {
    images: Uint8Array[];
    sourcePdf: SavedItemFile;
  }): Promise<ExtractResult>;
};

export type SavedItemProcessJobData = {
  workspaceId: string;
  savedItemId: string;
  requestId?: string;
};

type SavedItemProcessDeps = {
  db: Db;
  storage: Pick<AppStorage, 'getObjectBytes' | 'putObject'>;
  bucket: string;
  ocr: TextractOcrClient;
  ai: SavedItemProcessAi;
  renderPageImages?: (input: { bytes: Uint8Array; pageNumbers: number[] }) => Promise<Uint8Array[]>;
  reconcilePartNumbers?: typeof reconcilePartNumbers;
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

function rawTextractKey(file: SavedItemFile) {
  return `workspaces/${file.workspaceId}/textract_raw/saved_items/${file.id}.json`;
}

async function loadSavedItem(deps: SavedItemProcessDeps, data: SavedItemProcessJobData) {
  const [row] = await deps.db
    .select({ item: schema.savedItems, file: schema.savedItemFiles })
    .from(schema.savedItems)
    .innerJoin(
      schema.savedItemFiles,
      eq(schema.savedItems.savedItemFileId, schema.savedItemFiles.id),
    )
    .where(
      and(
        eq(schema.savedItems.id, data.savedItemId),
        eq(schema.savedItems.workspaceId, data.workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function upsertAttribute(input: {
  db: Db;
  savedItemId: string;
  key: AttributeKey;
  field: ExtractedField;
  savedItemSourcePageId: string | null;
}) {
  const [existing] = await input.db
    .select({ id: schema.savedItemAttributes.id })
    .from(schema.savedItemAttributes)
    .where(
      and(
        eq(schema.savedItemAttributes.savedItemId, input.savedItemId),
        eq(schema.savedItemAttributes.key, input.key),
      ),
    )
    .limit(1);

  const values = {
    currentValue: input.field.value,
    originalAiValue: input.field.value,
    confidence: input.field.confidence,
    savedItemSourcePageId: input.savedItemSourcePageId,
    editedByUserAt: null,
    updatedAt: new Date(),
  };

  if (existing) {
    await input.db
      .update(schema.savedItemAttributes)
      .set(values)
      .where(eq(schema.savedItemAttributes.id, existing.id));
    return;
  }

  await input.db.insert(schema.savedItemAttributes).values({
    savedItemId: input.savedItemId,
    key: input.key,
    ...values,
  });
}

async function replaceVariants(input: {
  db: Db;
  savedItemId: string;
  variants: ExtractedVariant[];
  sourcePageByNumber: Map<number, string>;
  bytes: Uint8Array;
  reconcile: typeof reconcilePartNumbers;
}) {
  await input.db
    .delete(schema.savedItemVariants)
    .where(eq(schema.savedItemVariants.savedItemId, input.savedItemId));

  const rows = deriveVariantRows(input.variants);
  if (rows.length === 0) return;

  let reconciled: Awaited<ReturnType<typeof reconcilePartNumbers>> = [];
  try {
    reconciled = await input.reconcile(
      input.bytes,
      rows.map((row) => ({
        partNumber: row.partNumber,
        size: row.size,
        pageNumber: row.sourcePage,
      })),
    );
  } catch {
    reconciled = [];
  }

  await input.db.insert(schema.savedItemVariants).values(
    rows.map((row, i) => ({
      savedItemId: input.savedItemId,
      savedItemSourcePageId: input.sourcePageByNumber.get(row.sourcePage) ?? null,
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

export async function runSavedItemProcessJob(
  deps: SavedItemProcessDeps,
  data: SavedItemProcessJobData,
) {
  const row = await loadSavedItem(deps, data);
  if (!row) return null;

  try {
    await deps.db
      .update(schema.savedItemFiles)
      .set({ processingStatus: 'ocr_running', processingError: null, updatedAt: new Date() })
      .where(eq(schema.savedItemFiles.id, row.file.id));

    const sourcePages = await deps.db
      .select()
      .from(schema.savedItemSourcePages)
      .where(eq(schema.savedItemSourcePages.savedItemFileId, row.file.id));
    const needsOcr = sourcePages.filter((page) => !page.hasOcr);
    if (needsOcr.length > 0) {
      const result = await deps.ocr.detectPdfText({
        bucket: deps.bucket,
        key: row.file.storageKey,
      });
      const textByPage = new Map(result.pages.map((page) => [page.pageNumber, page.text]));
      await Promise.all(
        needsOcr.map((page) =>
          deps.db
            .update(schema.savedItemSourcePages)
            .set({
              ocrText: textByPage.get(page.pageNumber) ?? '',
              hasOcr: true,
            })
            .where(eq(schema.savedItemSourcePages.id, page.id)),
        ),
      );
      await deps.storage.putObject({
        key: rawTextractKey(row.file),
        body: new TextEncoder().encode(JSON.stringify(result.raw)),
        contentType: 'application/json',
      });
    }

    const bytes = await deps.storage.getObjectBytes(row.file.storageKey);
    await deps.db
      .update(schema.savedItemFiles)
      .set({ processingStatus: 'classifying', processingError: null, updatedAt: new Date() })
      .where(eq(schema.savedItemFiles.id, row.file.id));

    const renderPageImages = deps.renderPageImages ?? defaultRenderPageImages;
    const classifyImages = await renderPageImages({
      bytes,
      pageNumbers: samplePages(row.file.pageCount),
    });
    const classification = await deps.ai.classifyDocument({
      images: classifyImages,
      sourcePdf: row.file,
    });
    const docType = normalizeDocType(classification.doc_type);
    await deps.db
      .update(schema.savedItems)
      .set({
        docType,
        docTypeConfidence: classification.confidence,
        docTypeOriginalAiValue: docType,
        updatedAt: new Date(),
      })
      .where(eq(schema.savedItems.id, row.item.id));

    await deps.db
      .update(schema.savedItemFiles)
      .set({ processingStatus: 'extracting', processingError: null, updatedAt: new Date() })
      .where(eq(schema.savedItemFiles.id, row.file.id));

    const latestPages = await deps.db
      .select()
      .from(schema.savedItemSourcePages)
      .where(eq(schema.savedItemSourcePages.savedItemFileId, row.file.id));
    const sourcePageByNumber = new Map(latestPages.map((page) => [page.pageNumber, page.id]));
    const pageNumbers = Array.from(
      { length: row.file.pageCount ?? latestPages.length },
      (_, i) => i + 1,
    );
    const extractImages = await renderPageImages({ bytes, pageNumbers });
    const extracted = await deps.ai.extractAttributes({
      images: extractImages,
      sourcePdf: row.file,
    });

    for (const key of ATTRIBUTE_KEYS) {
      const field = extracted[key];
      await upsertAttribute({
        db: deps.db,
        savedItemId: row.item.id,
        key,
        field,
        savedItemSourcePageId: sourcePageByNumber.get(field.source_page) ?? null,
      });
    }

    await replaceVariants({
      db: deps.db,
      savedItemId: row.item.id,
      variants: extracted.variants ?? [],
      sourcePageByNumber,
      bytes,
      reconcile: deps.reconcilePartNumbers ?? reconcilePartNumbers,
    });

    await deps.db
      .update(schema.savedItemFiles)
      .set({ processingStatus: 'extracted', processingError: null, updatedAt: new Date() })
      .where(eq(schema.savedItemFiles.id, row.file.id));

    return row.item;
  } catch (error) {
    await deps.db
      .update(schema.savedItemFiles)
      .set({
        processingStatus: 'error',
        processingError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(schema.savedItemFiles.id, row.file.id));
    throw error;
  }
}
