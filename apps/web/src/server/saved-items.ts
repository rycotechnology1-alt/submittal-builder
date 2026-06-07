import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { parsePdfPages } from '@submittal/shared/pdf/parse';

import type { Item, SourcePdf } from '@submittal/db';
import { db, schema } from '@/server/db';
import { iso, jsonError } from '@/server/api';
import {
  isWorkspaceStorageKey,
  savedItemFileStorageKey,
  sha256Hex,
  UPLOAD_URL_TTL_SECONDS,
} from '@/server/file-records';
import { findLivePackage, notFound } from '@/server/phase2-records';
import { getProcessingQueue } from '@/server/processing-queue';
import { getStorage } from '@/server/storage';

type DbExecutor = typeof db;

type SavedItemSummaryRow = {
  item: typeof schema.savedItems.$inferSelect;
  file: typeof schema.savedItemFiles.$inferSelect;
};

const ATTRIBUTE_SEARCH_KEYS = ['manufacturer', 'model_number', 'description'] as const;

export function savedItemSummaryJson(input: {
  item: typeof schema.savedItems.$inferSelect;
  file: typeof schema.savedItemFiles.$inferSelect;
  attributes: (typeof schema.savedItemAttributes.$inferSelect)[];
  variantCount: number;
}) {
  return {
    id: input.item.id,
    title: input.item.title,
    doc_type: input.item.docType,
    doc_type_confidence: input.item.docTypeConfidence,
    doc_type_original_ai_value: input.item.docTypeOriginalAiValue,
    original_filename: input.file.originalFilename,
    byte_size: input.file.byteSize,
    page_count: input.file.pageCount,
    sha256: input.file.sha256,
    processing_status: input.file.processingStatus,
    processing_error: input.file.processingError,
    attributes: input.attributes.map((attribute) => ({
      key: attribute.key,
      current_value: attribute.currentValue,
      original_ai_value: attribute.originalAiValue,
      confidence: attribute.confidence,
      saved_item_source_page_id: attribute.savedItemSourcePageId,
      edited_by_user_at: iso(attribute.editedByUserAt),
    })),
    variant_count: input.variantCount,
    updated_at: iso(input.item.updatedAt)!,
  };
}

export function savedItemFileJson(file: typeof schema.savedItemFiles.$inferSelect) {
  return {
    id: file.id,
    original_filename: file.originalFilename,
    byte_size: file.byteSize,
    sha256: file.sha256,
    page_count: file.pageCount,
    processing_status: file.processingStatus,
    processing_error: file.processingError,
  };
}

export function savedItemAttributeJson(attribute: typeof schema.savedItemAttributes.$inferSelect) {
  return {
    key: attribute.key,
    current_value: attribute.currentValue,
    original_ai_value: attribute.originalAiValue,
    confidence: attribute.confidence,
    saved_item_source_page_id: attribute.savedItemSourcePageId,
    edited_by_user_at: iso(attribute.editedByUserAt),
  };
}

export function savedItemVariantJson(variant: typeof schema.savedItemVariants.$inferSelect) {
  return {
    id: variant.id,
    part_number: variant.partNumber,
    size: variant.size,
    secondary_dims: variant.secondaryDims ?? null,
    display_label: variant.displayLabel,
    sort_order: variant.sortOrder,
    is_default_for_size: variant.isDefaultForSize,
    saved_item_source_page_id: variant.savedItemSourcePageId,
    part_number_verification: variant.partNumberVerification,
  };
}

export async function savedItemSummary(workspaceId: string, savedItemId: string) {
  const [row] = await db
    .select({ item: schema.savedItems, file: schema.savedItemFiles })
    .from(schema.savedItems)
    .innerJoin(
      schema.savedItemFiles,
      eq(schema.savedItems.savedItemFileId, schema.savedItemFiles.id),
    )
    .where(
      and(eq(schema.savedItems.workspaceId, workspaceId), eq(schema.savedItems.id, savedItemId)),
    )
    .limit(1);
  if (!row) return null;
  const [attributes, [variantCount]] = await Promise.all([
    db
      .select()
      .from(schema.savedItemAttributes)
      .where(eq(schema.savedItemAttributes.savedItemId, row.item.id)),
    db
      .select({ value: count() })
      .from(schema.savedItemVariants)
      .where(eq(schema.savedItemVariants.savedItemId, row.item.id)),
  ]);
  return savedItemSummaryJson({
    item: row.item,
    file: row.file,
    attributes,
    variantCount: variantCount?.value ?? 0,
  });
}

export async function findSavedItemInWorkspace(workspaceId: string, savedItemId: string) {
  const [row] = await db
    .select({ item: schema.savedItems, file: schema.savedItemFiles })
    .from(schema.savedItems)
    .innerJoin(
      schema.savedItemFiles,
      eq(schema.savedItems.savedItemFileId, schema.savedItemFiles.id),
    )
    .where(
      and(eq(schema.savedItems.workspaceId, workspaceId), eq(schema.savedItems.id, savedItemId)),
    )
    .limit(1);
  return row ?? null;
}

export async function savedItemDetail(workspaceId: string, savedItemId: string) {
  const row = await findSavedItemInWorkspace(workspaceId, savedItemId);
  if (!row) return null;

  const [sourcePages, attributes, variants, summary] = await Promise.all([
    db
      .select()
      .from(schema.savedItemSourcePages)
      .where(eq(schema.savedItemSourcePages.savedItemFileId, row.file.id))
      .orderBy(asc(schema.savedItemSourcePages.pageNumber)),
    db
      .select()
      .from(schema.savedItemAttributes)
      .where(eq(schema.savedItemAttributes.savedItemId, row.item.id)),
    db
      .select()
      .from(schema.savedItemVariants)
      .where(eq(schema.savedItemVariants.savedItemId, row.item.id))
      .orderBy(asc(schema.savedItemVariants.sortOrder)),
    savedItemSummary(workspaceId, savedItemId),
  ]);

  return {
    saved_item: summary!,
    file: savedItemFileJson(row.file),
    source_pages: sourcePages.map((page) => ({
      id: page.id,
      page_number: page.pageNumber,
      has_ocr: page.hasOcr,
    })),
    attributes: attributes.map(savedItemAttributeJson),
    variants: variants.map(savedItemVariantJson),
  };
}

async function touchSavedItem(executor: DbExecutor, savedItemId: string, now = new Date()) {
  await executor
    .update(schema.savedItems)
    .set({ updatedAt: now })
    .where(eq(schema.savedItems.id, savedItemId));
}

export async function updateSavedItem(input: {
  workspaceId: string;
  savedItemId: string;
  title?: string;
  docType?: (typeof schema.savedItems.$inferSelect)['docType'];
}) {
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return null;
  const now = new Date();
  await db
    .update(schema.savedItems)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.docType !== undefined ? { docType: input.docType } : {}),
      updatedAt: now,
    })
    .where(eq(schema.savedItems.id, row.item.id));
  return savedItemSummary(input.workspaceId, row.item.id);
}

export async function updateSavedItemAttribute(input: {
  workspaceId: string;
  savedItemId: string;
  key: string;
  value: string | null;
}) {
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return null;

  const now = new Date();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.savedItemAttributes)
      .where(
        and(
          eq(schema.savedItemAttributes.savedItemId, row.item.id),
          eq(schema.savedItemAttributes.key, input.key),
        ),
      )
      .limit(1);

    let updated;
    if (existing) {
      [updated] = await tx
        .update(schema.savedItemAttributes)
        .set({
          currentValue: input.value,
          editedByUserAt: now,
          updatedAt: now,
        })
        .where(eq(schema.savedItemAttributes.id, existing.id))
        .returning();
    } else {
      [updated] = await tx
        .insert(schema.savedItemAttributes)
        .values({
          savedItemId: row.item.id,
          key: input.key,
          currentValue: input.value,
          originalAiValue: null,
          editedByUserAt: now,
        })
        .returning();
    }
    await touchSavedItem(tx as unknown as typeof db, row.item.id, now);
    return savedItemAttributeJson(updated!);
  });
}

async function validateSavedItemSourcePage(input: {
  workspaceId: string;
  savedItemId: string;
  savedItemSourcePageId: string | null | undefined;
}) {
  if (!input.savedItemSourcePageId) return true;
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return false;
  const [page] = await db
    .select({ id: schema.savedItemSourcePages.id })
    .from(schema.savedItemSourcePages)
    .where(
      and(
        eq(schema.savedItemSourcePages.id, input.savedItemSourcePageId),
        eq(schema.savedItemSourcePages.savedItemFileId, row.file.id),
      ),
    )
    .limit(1);
  return Boolean(page);
}

export async function createSavedItemVariant(input: {
  workspaceId: string;
  savedItemId: string;
  partNumber: string;
  size: string;
  secondaryDims?: typeof schema.savedItemVariants.$inferSelect.secondaryDims | null;
  displayLabel: string;
  sortOrder: number;
  isDefaultForSize: boolean;
  savedItemSourcePageId?: string | null;
}) {
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return null;
  const sourceOk = await validateSavedItemSourcePage({
    workspaceId: input.workspaceId,
    savedItemId: input.savedItemId,
    savedItemSourcePageId: input.savedItemSourcePageId,
  });
  if (!sourceOk) return false;

  const now = new Date();
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .insert(schema.savedItemVariants)
      .values({
        savedItemId: row.item.id,
        savedItemSourcePageId: input.savedItemSourcePageId ?? null,
        partNumber: input.partNumber,
        size: input.size,
        secondaryDims: input.secondaryDims ?? null,
        displayLabel: input.displayLabel,
        sortOrder: input.sortOrder,
        isDefaultForSize: input.isDefaultForSize,
      })
      .returning();
    await touchSavedItem(tx as unknown as typeof db, row.item.id, now);
    return savedItemVariantJson(variant!);
  });
}

export async function updateSavedItemVariant(input: {
  workspaceId: string;
  savedItemId: string;
  variantId: string;
  patch: Partial<{
    partNumber: string;
    size: string;
    secondaryDims: typeof schema.savedItemVariants.$inferSelect.secondaryDims | null;
    displayLabel: string;
    sortOrder: number;
    isDefaultForSize: boolean;
    savedItemSourcePageId: string | null;
  }>;
}) {
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return null;
  const sourceOk = await validateSavedItemSourcePage({
    workspaceId: input.workspaceId,
    savedItemId: input.savedItemId,
    savedItemSourcePageId: input.patch.savedItemSourcePageId,
  });
  if (!sourceOk) return false;
  const [existing] = await db
    .select()
    .from(schema.savedItemVariants)
    .where(
      and(
        eq(schema.savedItemVariants.id, input.variantId),
        eq(schema.savedItemVariants.savedItemId, row.item.id),
      ),
    )
    .limit(1);
  if (!existing) return null;

  const now = new Date();
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .update(schema.savedItemVariants)
      .set({
        ...(input.patch.partNumber !== undefined ? { partNumber: input.patch.partNumber } : {}),
        ...(input.patch.size !== undefined ? { size: input.patch.size } : {}),
        ...(input.patch.secondaryDims !== undefined
          ? { secondaryDims: input.patch.secondaryDims }
          : {}),
        ...(input.patch.displayLabel !== undefined
          ? { displayLabel: input.patch.displayLabel }
          : {}),
        ...(input.patch.sortOrder !== undefined ? { sortOrder: input.patch.sortOrder } : {}),
        ...(input.patch.isDefaultForSize !== undefined
          ? { isDefaultForSize: input.patch.isDefaultForSize }
          : {}),
        ...(input.patch.savedItemSourcePageId !== undefined
          ? { savedItemSourcePageId: input.patch.savedItemSourcePageId }
          : {}),
        updatedAt: now,
      })
      .where(eq(schema.savedItemVariants.id, existing.id))
      .returning();
    await touchSavedItem(tx as unknown as typeof db, row.item.id, now);
    return savedItemVariantJson(variant!);
  });
}

export async function deleteSavedItemVariant(input: {
  workspaceId: string;
  savedItemId: string;
  variantId: string;
}) {
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return null;
  const [existing] = await db
    .select({ id: schema.savedItemVariants.id })
    .from(schema.savedItemVariants)
    .where(
      and(
        eq(schema.savedItemVariants.id, input.variantId),
        eq(schema.savedItemVariants.savedItemId, row.item.id),
      ),
    )
    .limit(1);
  if (!existing) return null;
  await db.transaction(async (tx) => {
    await tx.delete(schema.savedItemVariants).where(eq(schema.savedItemVariants.id, existing.id));
    await touchSavedItem(tx as unknown as typeof db, row.item.id);
  });
  return true;
}

export async function deleteSavedItem(input: { workspaceId: string; savedItemId: string }) {
  const row = await findSavedItemInWorkspace(input.workspaceId, input.savedItemId);
  if (!row) return null;

  const [references] = await db
    .select({ value: count() })
    .from(schema.sourcePdfs)
    .where(eq(schema.sourcePdfs.savedItemFileId, row.file.id));
  const hasPackageSnapshots = (references?.value ?? 0) > 0;

  await db.transaction(async (tx) => {
    await tx.delete(schema.savedItems).where(eq(schema.savedItems.id, row.item.id));
    if (!hasPackageSnapshots) {
      await tx.delete(schema.savedItemFiles).where(eq(schema.savedItemFiles.id, row.file.id));
    }
  });

  if (!hasPackageSnapshots) {
    try {
      await getStorage().deleteObject(row.file.storageKey);
    } catch (error) {
      console.warn('saved-item storage delete failed', {
        saved_item_id: row.item.id,
        storage_key: row.file.storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return true;
}

export async function presignSavedItemUpload(input: {
  workspaceId: string;
  filename: string;
  contentType: string;
}) {
  const savedItemFileId = randomUUID();
  const storageKey = savedItemFileStorageKey(input.workspaceId, savedItemFileId);
  const requiredHeaders = { 'content-type': input.contentType };
  const presigned = await getStorage().presignPutUrl({
    key: storageKey,
    contentType: input.contentType,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    requiredHeaders,
  });

  return {
    upload_url: presigned.url,
    storage_key: storageKey,
    expires_at: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    required_headers: presigned.requiredHeaders,
  };
}

function titleFromFilename(filename: string) {
  return filename.replace(/\.pdf$/i, '').trim() || filename;
}

export async function confirmSavedItemUpload(input: {
  workspaceId: string;
  storageKey: string;
  originalFilename: string;
  requestId?: string;
}) {
  if (!isWorkspaceStorageKey(input.workspaceId, input.storageKey)) {
    return jsonError(404, 'not_found', 'Not found');
  }

  const storage = getStorage();
  const head = await storage.headObject(input.storageKey);
  if (!head) return jsonError(409, 'upload_missing', 'Uploaded object was not found');

  const bytes = await storage.getObjectBytes(input.storageKey);
  const sha256 = sha256Hex(bytes);
  const parsed = await parsePdfPages(bytes);

  const [existingFile] = await db
    .select()
    .from(schema.savedItemFiles)
    .where(
      and(
        eq(schema.savedItemFiles.workspaceId, input.workspaceId),
        eq(schema.savedItemFiles.sha256, sha256),
      ),
    )
    .limit(1);

  if (existingFile) {
    const existingItem = await savedItemByFile(input.workspaceId, existingFile.id);
    if (existingItem) {
      try {
        await storage.deleteObject(input.storageKey);
      } catch {
        /* best effort */
      }
      const summary = await savedItemSummary(input.workspaceId, existingItem.id);
      return {
        status: 200,
        body: {
          saved_item: summary!,
          duplicate: true,
          processing_status: existingFile.processingStatus,
        },
      };
    }
  }

  const savedItemId = await db.transaction(async (tx) => {
    const file =
      existingFile ??
      (
        await tx
          .insert(schema.savedItemFiles)
          .values({
            workspaceId: input.workspaceId,
            storageKey: input.storageKey,
            originalFilename: input.originalFilename,
            byteSize: bytes.byteLength,
            sha256,
            pageCount: parsed.pageCount,
            processingStatus: 'uploaded',
          })
          .returning()
      )[0]!;

    if (existingFile) {
      await tx
        .update(schema.savedItemFiles)
        .set({
          originalFilename: input.originalFilename,
          pageCount: parsed.pageCount,
          processingStatus: 'uploaded',
          processingError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.savedItemFiles.id, existingFile.id));
    }

    await tx
      .delete(schema.savedItemSourcePages)
      .where(eq(schema.savedItemSourcePages.savedItemFileId, file.id));
    await tx.insert(schema.savedItemSourcePages).values(
      parsed.pages.map((page) => ({
        savedItemFileId: file.id,
        pageNumber: page.pageNumber,
        ocrText: page.text,
        hasOcr: page.hasOcr,
      })),
    );

    const [savedItem] = await tx
      .insert(schema.savedItems)
      .values({
        workspaceId: input.workspaceId,
        savedItemFileId: file.id,
        title: titleFromFilename(input.originalFilename),
        docType: 'other',
      })
      .returning();
    return savedItem!.id;
  });

  if (existingFile && input.storageKey !== existingFile.storageKey) {
    try {
      await storage.deleteObject(input.storageKey);
    } catch {
      /* best effort */
    }
  }

  await getProcessingQueue().send(
    'saved_item_process',
    { workspaceId: input.workspaceId, savedItemId, requestId: input.requestId },
    {
      singletonKey: `saved_item_process:${savedItemId}`,
      retryLimit: 3,
      retryBackoff: true,
    },
  );

  const summary = await savedItemSummary(input.workspaceId, savedItemId);
  return {
    status: 201,
    body: {
      saved_item: summary!,
      duplicate: false,
      processing_status: summary!.processing_status,
    },
  };
}

export async function listSavedItems(workspaceId: string, q?: string | null) {
  const search = q?.trim();
  let matchingIds: string[] | null = null;
  if (search) {
    const attrMatches = await db
      .select({ savedItemId: schema.savedItemAttributes.savedItemId })
      .from(schema.savedItemAttributes)
      .innerJoin(
        schema.savedItems,
        eq(schema.savedItemAttributes.savedItemId, schema.savedItems.id),
      )
      .where(
        and(
          eq(schema.savedItems.workspaceId, workspaceId),
          inArray(schema.savedItemAttributes.key, [...ATTRIBUTE_SEARCH_KEYS]),
          ilike(schema.savedItemAttributes.currentValue, `%${search}%`),
        ),
      );
    matchingIds = [...new Set(attrMatches.map((row) => row.savedItemId))];
  }

  const filters = [
    eq(schema.savedItems.workspaceId, workspaceId),
    ...(search
      ? [
          or(
            ilike(schema.savedItems.title, `%${search}%`),
            ilike(schema.savedItemFiles.originalFilename, `%${search}%`),
            sql`${schema.savedItems.docType}::text ilike ${`%${search}%`}`,
            matchingIds && matchingIds.length > 0
              ? inArray(schema.savedItems.id, matchingIds)
              : undefined,
          ),
        ]
      : []),
  ].filter((filter): filter is Exclude<typeof filter, undefined> => filter !== undefined);

  const rows = await db
    .select({ item: schema.savedItems, file: schema.savedItemFiles })
    .from(schema.savedItems)
    .innerJoin(
      schema.savedItemFiles,
      eq(schema.savedItems.savedItemFileId, schema.savedItemFiles.id),
    )
    .where(and(...filters))
    .orderBy(desc(schema.savedItems.updatedAt))
    .limit(50);

  return savedItemSummariesFromRows(rows);
}

async function savedItemSummariesFromRows(rows: SavedItemSummaryRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.item.id);
  const [attributes, variantCounts] = await Promise.all([
    db
      .select()
      .from(schema.savedItemAttributes)
      .where(inArray(schema.savedItemAttributes.savedItemId, ids)),
    db
      .select({ savedItemId: schema.savedItemVariants.savedItemId, value: count() })
      .from(schema.savedItemVariants)
      .where(inArray(schema.savedItemVariants.savedItemId, ids))
      .groupBy(schema.savedItemVariants.savedItemId),
  ]);
  const countsById = new Map(variantCounts.map((row) => [row.savedItemId, row.value]));
  return rows.map((row) =>
    savedItemSummaryJson({
      item: row.item,
      file: row.file,
      attributes: attributes.filter((attribute) => attribute.savedItemId === row.item.id),
      variantCount: countsById.get(row.item.id) ?? 0,
    }),
  );
}

export async function saveCommonItem(input: {
  workspaceId: string;
  item: Item;
  duplicateAction?: 'update' | 'keep_existing';
}) {
  const sourcePdfs = await db
    .select()
    .from(schema.sourcePdfs)
    .where(
      and(
        eq(schema.sourcePdfs.workspaceId, input.workspaceId),
        eq(schema.sourcePdfs.packageId, input.item.packageId),
        eq(schema.sourcePdfs.itemId, input.item.id),
      ),
    );

  if (sourcePdfs.length !== 1) {
    return jsonError(
      409,
      'save_common_unsupported_source_count',
      'Only items with exactly one source PDF can be saved as common items',
    );
  }
  const sourcePdf = sourcePdfs[0]!;
  if (sourcePdf.processingStatus !== 'extracted' || !sourcePdf.sha256) {
    return jsonError(
      409,
      'save_common_source_not_ready',
      'Only extracted source PDFs with a hash can be saved as common items',
    );
  }

  const [existingFile] = await db
    .select()
    .from(schema.savedItemFiles)
    .where(
      and(
        eq(schema.savedItemFiles.workspaceId, input.workspaceId),
        eq(schema.savedItemFiles.sha256, sourcePdf.sha256),
      ),
    )
    .limit(1);

  const existingSavedItem = existingFile
    ? await savedItemByFile(input.workspaceId, existingFile.id)
    : null;

  if (existingFile && existingSavedItem && !input.duplicateAction) {
    return jsonError(409, 'saved_item_already_exists', 'This PDF is already saved', {
      saved_item_id: existingSavedItem.id,
    });
  }

  if (existingFile && existingSavedItem && input.duplicateAction === 'keep_existing') {
    const summary = await savedItemSummary(input.workspaceId, existingSavedItem.id);
    return { status: 200, body: { saved_item: summary!, created: false, updated: false } };
  }

  const savedItemId = await db.transaction(async (tx) => {
    const file =
      existingFile ??
      (
        await tx
          .insert(schema.savedItemFiles)
          .values({
            workspaceId: input.workspaceId,
            storageKey: sourcePdf.storageKey,
            originalFilename: sourcePdf.originalFilename,
            byteSize: sourcePdf.byteSize,
            sha256: sourcePdf.sha256!,
            pageCount: sourcePdf.pageCount,
          })
          .returning()
      )[0]!;

    let [savedItem] = await tx
      .select()
      .from(schema.savedItems)
      .where(
        and(
          eq(schema.savedItems.workspaceId, input.workspaceId),
          eq(schema.savedItems.savedItemFileId, file.id),
        ),
      )
      .limit(1);

    if (savedItem) {
      [savedItem] = await tx
        .update(schema.savedItems)
        .set({
          title: input.item.title,
          docType: input.item.docType,
          docTypeConfidence: input.item.docTypeConfidence,
          docTypeOriginalAiValue: input.item.docTypeOriginalAiValue,
          updatedAt: new Date(),
        })
        .where(eq(schema.savedItems.id, savedItem.id))
        .returning();
      await replaceSavedItemSnapshot(tx as unknown as typeof db, {
        savedItem: savedItem!,
        file,
        sourcePdf,
      });
    } else {
      [savedItem] = await tx
        .insert(schema.savedItems)
        .values({
          workspaceId: input.workspaceId,
          savedItemFileId: file.id,
          title: input.item.title,
          docType: input.item.docType,
          docTypeConfidence: input.item.docTypeConfidence,
          docTypeOriginalAiValue: input.item.docTypeOriginalAiValue,
        })
        .returning();
      await replaceSavedItemSnapshot(tx as unknown as typeof db, {
        savedItem: savedItem!,
        file,
        sourcePdf,
      });
    }

    await tx
      .update(schema.sourcePdfs)
      .set({ savedItemFileId: file.id, updatedAt: new Date() })
      .where(eq(schema.sourcePdfs.id, sourcePdf.id));

    return savedItem!.id;
  });

  const summary = await savedItemSummary(input.workspaceId, savedItemId);
  return {
    status: existingFile ? 200 : 201,
    body: { saved_item: summary!, created: !existingFile, updated: Boolean(existingFile) },
  };
}

async function savedItemByFile(workspaceId: string, savedItemFileId: string) {
  const [item] = await db
    .select()
    .from(schema.savedItems)
    .where(
      and(
        eq(schema.savedItems.workspaceId, workspaceId),
        eq(schema.savedItems.savedItemFileId, savedItemFileId),
      ),
    )
    .limit(1);
  return item ?? null;
}

async function replaceSavedItemSnapshot(
  executor: DbExecutor,
  input: {
    savedItem: typeof schema.savedItems.$inferSelect;
    file: typeof schema.savedItemFiles.$inferSelect;
    sourcePdf: SourcePdf;
  },
) {
  await executor
    .delete(schema.savedItemVariants)
    .where(eq(schema.savedItemVariants.savedItemId, input.savedItem.id));
  await executor
    .delete(schema.savedItemAttributes)
    .where(eq(schema.savedItemAttributes.savedItemId, input.savedItem.id));
  await executor
    .delete(schema.savedItemSourcePages)
    .where(eq(schema.savedItemSourcePages.savedItemFileId, input.file.id));

  const sourcePages = await executor
    .select()
    .from(schema.sourcePages)
    .where(eq(schema.sourcePages.sourcePdfId, input.sourcePdf.id))
    .orderBy(asc(schema.sourcePages.pageNumber));
  const pageIdMap = new Map<string, string>();
  if (sourcePages.length > 0) {
    const savedPages = await executor
      .insert(schema.savedItemSourcePages)
      .values(
        sourcePages.map((page) => ({
          savedItemFileId: input.file.id,
          pageNumber: page.pageNumber,
          ocrText: page.ocrText,
          hasOcr: page.hasOcr,
        })),
      )
      .returning();
    sourcePages.forEach((page, i) => {
      pageIdMap.set(page.id, savedPages[i]!.id);
    });
  }

  const variants = await executor
    .select()
    .from(schema.itemVariants)
    .where(eq(schema.itemVariants.itemId, input.sourcePdf.itemId!))
    .orderBy(asc(schema.itemVariants.sortOrder));

  const sourceAttributes = await executor
    .select()
    .from(schema.itemAttributes)
    .where(eq(schema.itemAttributes.itemId, input.sourcePdf.itemId!));

  if (sourceAttributes.length > 0) {
    await executor.insert(schema.savedItemAttributes).values(
      sourceAttributes.map((attribute) => ({
        savedItemId: input.savedItem.id,
        key: attribute.key,
        currentValue: attribute.currentValue,
        originalAiValue: attribute.originalAiValue,
        confidence: attribute.confidence,
        savedItemSourcePageId: attribute.sourcePageId
          ? (pageIdMap.get(attribute.sourcePageId) ?? null)
          : null,
        editedByUserAt: attribute.editedByUserAt,
      })),
    );
  }

  if (variants.length > 0) {
    await executor.insert(schema.savedItemVariants).values(
      variants.map((variant) => ({
        savedItemId: input.savedItem.id,
        savedItemSourcePageId: variant.sourcePageId
          ? (pageIdMap.get(variant.sourcePageId) ?? null)
          : null,
        partNumber: variant.partNumber,
        size: variant.size,
        secondaryDims: variant.secondaryDims ?? null,
        displayLabel: variant.displayLabel,
        partNumberVerification: variant.partNumberVerification,
        sortOrder: variant.sortOrder,
        isDefaultForSize: variant.isDefaultForSize,
      })),
    );
  }
}

export async function importSavedItems(input: {
  workspaceId: string;
  packageId: string;
  savedItemIds: string[];
}) {
  const pkg = await findLivePackage(input.workspaceId, input.packageId);
  if (!pkg) return notFound();

  const uniqueIds = [...new Set(input.savedItemIds)];
  const rows = await db
    .select({ item: schema.savedItems, file: schema.savedItemFiles })
    .from(schema.savedItems)
    .innerJoin(
      schema.savedItemFiles,
      eq(schema.savedItems.savedItemFileId, schema.savedItemFiles.id),
    )
    .where(
      and(
        eq(schema.savedItems.workspaceId, input.workspaceId),
        inArray(schema.savedItems.id, uniqueIds),
      ),
    );
  if (rows.length !== uniqueIds.length) return notFound();
  const notReady = rows.find((row) => row.file.processingStatus !== 'extracted');
  if (notReady) {
    return jsonError(409, 'saved_item_not_ready', 'Saved item processing has not finished', {
      saved_item_id: notReady.item.id,
      processing_status: notReady.file.processingStatus,
    });
  }

  const shas = rows.map((row) => row.file.sha256);
  const duplicateSources = await db
    .select({ id: schema.sourcePdfs.id })
    .from(schema.sourcePdfs)
    .where(
      and(
        eq(schema.sourcePdfs.workspaceId, input.workspaceId),
        eq(schema.sourcePdfs.packageId, input.packageId),
        inArray(schema.sourcePdfs.sha256, shas),
      ),
    );
  if (duplicateSources.length > 0) {
    return jsonError(409, 'duplicate_source_pdf', 'A saved PDF already exists in this package');
  }

  const orderedRows = uniqueIds.map((id) => rows.find((row) => row.item.id === id)!);
  const importedItemIds: string[] = [];

  await db.transaction(async (tx) => {
    const [lastItem] = await tx
      .select({ sortOrder: schema.items.sortOrder })
      .from(schema.items)
      .where(
        and(eq(schema.items.workspaceId, input.workspaceId), eq(schema.items.packageId, pkg.id)),
      )
      .orderBy(desc(schema.items.sortOrder))
      .limit(1);
    let sortOrder = (lastItem?.sortOrder ?? -1) + 1;

    for (const row of orderedRows) {
      const [item] = await tx
        .insert(schema.items)
        .values({
          workspaceId: input.workspaceId,
          packageId: pkg.id,
          docType: row.item.docType,
          docTypeConfidence: row.item.docTypeConfidence,
          docTypeOriginalAiValue: row.item.docTypeOriginalAiValue,
          title: row.item.title,
          sortOrder,
        })
        .returning();
      sortOrder += 1;
      importedItemIds.push(item!.id);

      const [sourcePdf] = await tx
        .insert(schema.sourcePdfs)
        .values({
          workspaceId: input.workspaceId,
          packageId: pkg.id,
          storageKey: row.file.storageKey,
          originalFilename: row.file.originalFilename,
          byteSize: row.file.byteSize,
          sha256: row.file.sha256,
          pageCount: row.file.pageCount,
          savedItemFileId: row.file.id,
          processingStatus: 'extracted',
          itemId: item!.id,
        })
        .returning();

      const savedPages = await tx
        .select()
        .from(schema.savedItemSourcePages)
        .where(eq(schema.savedItemSourcePages.savedItemFileId, row.file.id))
        .orderBy(asc(schema.savedItemSourcePages.pageNumber));
      const savedPageToSourcePage = new Map<string, string>();
      if (savedPages.length > 0) {
        const insertedPages = await tx
          .insert(schema.sourcePages)
          .values(
            savedPages.map((page) => ({
              sourcePdfId: sourcePdf!.id,
              pageNumber: page.pageNumber,
              ocrText: page.ocrText,
              hasOcr: page.hasOcr,
            })),
          )
          .returning();
        savedPages.forEach((page, i) => savedPageToSourcePage.set(page.id, insertedPages[i]!.id));
      }

      const [savedAttributes, savedVariants] = await Promise.all([
        tx
          .select()
          .from(schema.savedItemAttributes)
          .where(eq(schema.savedItemAttributes.savedItemId, row.item.id)),
        tx
          .select()
          .from(schema.savedItemVariants)
          .where(eq(schema.savedItemVariants.savedItemId, row.item.id))
          .orderBy(asc(schema.savedItemVariants.sortOrder)),
      ]);

      if (savedAttributes.length > 0) {
        await tx.insert(schema.itemAttributes).values(
          savedAttributes.map((attribute) => ({
            itemId: item!.id,
            key: attribute.key,
            currentValue: attribute.currentValue,
            originalAiValue: attribute.originalAiValue,
            confidence: attribute.confidence,
            sourcePageId: attribute.savedItemSourcePageId
              ? (savedPageToSourcePage.get(attribute.savedItemSourcePageId) ?? null)
              : null,
            editedByUserAt: attribute.editedByUserAt,
          })),
        );
      }

      if (savedVariants.length > 0) {
        await tx.insert(schema.itemVariants).values(
          savedVariants.map((variant) => ({
            itemId: item!.id,
            sourcePageId: variant.savedItemSourcePageId
              ? (savedPageToSourcePage.get(variant.savedItemSourcePageId) ?? null)
              : null,
            partNumber: variant.partNumber,
            size: variant.size,
            secondaryDims: variant.secondaryDims ?? null,
            displayLabel: variant.displayLabel,
            partNumberVerification: variant.partNumberVerification,
            sortOrder: variant.sortOrder,
            isDefaultForSize: variant.isDefaultForSize,
            selectedAt: null,
          })),
        );
      }
    }

    await tx
      .update(schema.packages)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(schema.packages.id, pkg.id));
  });

  return { imported_item_ids: importedItemIds };
}
