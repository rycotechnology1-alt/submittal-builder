import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/server/db';
import { getStorage } from '@/server/storage';

type DbExecutor = typeof db;

export async function collectPackageStorageKeys(
  packageId: string,
  workspaceId: string,
): Promise<string[]> {
  const [pdfs, exportRows] = await Promise.all([
    db
      .select({ key: schema.sourcePdfs.storageKey })
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.packageId, packageId),
          eq(schema.sourcePdfs.workspaceId, workspaceId),
        ),
      ),
    db
      .select({ key: schema.exports.storageKey })
      .from(schema.exports)
      .where(eq(schema.exports.packageId, packageId)),
  ]);

  return [...pdfs, ...exportRows].map((r) => r.key).filter((k): k is string => Boolean(k));
}

export async function bestEffortDeleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const storage = getStorage();
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.deleteObject(key);
      } catch (error) {
        console.warn(`Failed to delete storage object ${key}:`, error);
      }
    }),
  );
}

export async function updatePackageStatusAfterContentRemoval(
  executor: DbExecutor,
  input: { packageId: string; workspaceId: string },
): Promise<void> {
  const [pkg] = await executor
    .select({ status: schema.packages.status })
    .from(schema.packages)
    .where(
      and(
        eq(schema.packages.id, input.packageId),
        eq(schema.packages.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!pkg) return;

  let nextStatus: typeof pkg.status | null = null;
  if (pkg.status === 'exported') {
    nextStatus = 'ready';
  } else if (pkg.status === 'processing') {
    const sourcePdfs = await executor
      .select({
        itemId: schema.sourcePdfs.itemId,
        processingStatus: schema.sourcePdfs.processingStatus,
      })
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.packageId, input.packageId),
          eq(schema.sourcePdfs.workspaceId, input.workspaceId),
        ),
      );

    if (sourcePdfs.length === 0) {
      nextStatus = 'draft';
    } else if (
      sourcePdfs.every((pdf) => pdf.itemId && pdf.processingStatus === 'extracted')
    ) {
      nextStatus = 'ready';
    }
  }

  if (!nextStatus || nextStatus === pkg.status) return;
  await executor
    .update(schema.packages)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(
      and(
        eq(schema.packages.id, input.packageId),
        eq(schema.packages.workspaceId, input.workspaceId),
      ),
    );
}
