import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/server/db';
import { getStorage } from '@/server/storage';

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
