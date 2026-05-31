import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { Item, SourcePdf } from '@submittal/db';
import { db, schema } from '@/server/db';
import { iso, jsonError } from '@/server/api';
import { findLivePackage, notFound } from '@/server/phase2-records';

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
    original_filename: input.file.originalFilename,
    byte_size: input.file.byteSize,
    page_count: input.file.pageCount,
    sha256: input.file.sha256,
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

  if (existingFile && !input.duplicateAction) {
    const existing = await savedItemByFile(input.workspaceId, existingFile.id);
    return jsonError(409, 'saved_item_already_exists', 'This PDF is already saved', {
      saved_item_id: existing?.id ?? null,
    });
  }

  if (existingFile && input.duplicateAction === 'keep_existing') {
    const existing = await savedItemByFile(input.workspaceId, existingFile.id);
    if (!existing) return notFound();
    const summary = await savedItemSummary(input.workspaceId, existing.id);
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
