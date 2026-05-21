import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { Db } from '@submittal/db';
import { schema } from '@submittal/db';

import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  type PackageJobData,
} from './common.js';

type BatchOrderDeps = {
  db: Db;
};

function attrValue(
  attrs: Array<{ itemId: string; key: string; currentValue: string | null }>,
  itemId: string,
  key: string,
) {
  return attrs.find((attr) => attr.itemId === itemId && attr.key === key)?.currentValue ?? '';
}

export async function runBatchOrderJob(deps: BatchOrderDeps, data: PackageJobData) {
  await markJobRunning(deps.db, data, 'batch_order');

  try {
    const sourcePdfs = await deps.db
      .select({
        id: schema.sourcePdfs.id,
        processingStatus: schema.sourcePdfs.processingStatus,
        itemId: schema.sourcePdfs.itemId,
      })
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.workspaceId, data.workspaceId),
          eq(schema.sourcePdfs.packageId, data.packageId),
        ),
      );

    const unfinished = sourcePdfs.find((pdf) => pdf.processingStatus !== 'extracted' || !pdf.itemId);
    if (unfinished) {
      throw new Error(`batch_order cannot run before extraction finishes: ${unfinished.id}`);
    }

    const items = await deps.db
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.workspaceId, data.workspaceId),
          eq(schema.items.packageId, data.packageId),
          isNull(schema.items.deletedAt),
        ),
      )
      .orderBy(asc(schema.items.createdAt));

    const itemIds = items.map((item) => item.id);
    const attrs =
      itemIds.length === 0
        ? []
        : await deps.db
            .select({
              itemId: schema.itemAttributes.itemId,
              key: schema.itemAttributes.key,
              currentValue: schema.itemAttributes.currentValue,
            })
            .from(schema.itemAttributes)
            .where(inArray(schema.itemAttributes.itemId, itemIds));

    const canonicalByProduct = new Map<string, string>();
    for (const item of items) {
      const manufacturer = attrValue(attrs, item.id, 'manufacturer').toLowerCase().trim();
      const model = attrValue(attrs, item.id, 'model_number').toLowerCase().trim();
      if (!manufacturer || !model) continue;

      const productKey = `${manufacturer}:${model}`;
      const canonicalId = canonicalByProduct.get(productKey);
      if (!canonicalId) {
        canonicalByProduct.set(productKey, item.id);
        continue;
      }

      await deps.db
        .update(schema.sourcePdfs)
        .set({ itemId: canonicalId, updatedAt: new Date() })
        .where(eq(schema.sourcePdfs.itemId, item.id));
      await deps.db
        .update(schema.items)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.items.id, item.id));
    }

    const liveItems = items.filter((item) => !item.deletedAt);
    const ordered = [...liveItems].sort((a, b) => {
      const specCompare = attrValue(attrs, a.id, 'spec_section_ref').localeCompare(
        attrValue(attrs, b.id, 'spec_section_ref'),
        undefined,
        { numeric: true },
      );
      if (specCompare !== 0) return specCompare;
      return attrValue(attrs, a.id, 'manufacturer').localeCompare(
        attrValue(attrs, b.id, 'manufacturer'),
      );
    });

    await Promise.all(
      ordered.map((item, sortOrder) =>
        deps.db
          .update(schema.items)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(schema.items.id, item.id)),
      ),
    );

    await deps.db
      .update(schema.packages)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(
        and(
          eq(schema.packages.id, data.packageId),
          eq(schema.packages.workspaceId, data.workspaceId),
        ),
      );

    await markJobSucceeded(deps.db, data, 'batch_order');
  } catch (error) {
    await deps.db
      .update(schema.packages)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(schema.packages.id, data.packageId));
    await markJobFailed(deps.db, data, 'batch_order', error);
    throw error;
  }
}
