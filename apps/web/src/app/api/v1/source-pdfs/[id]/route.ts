import { count, eq } from 'drizzle-orm';

import { jsonError, noContent, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { findSourcePdfInLivePackage, notFound } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function DELETE(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const sourcePdf = await findSourcePdfInLivePackage(ctx.workspaceId, id);
    if (!sourcePdf) return notFound();

    const [exportCount] = await db
      .select({ value: count() })
      .from(schema.exports)
      .where(eq(schema.exports.packageId, sourcePdf.packageId));
    if ((exportCount?.value ?? 0) > 0) {
      return jsonError(409, 'source_pdf_exported', 'Source PDF is referenced by an export');
    }

    await getStorage().deleteObject(sourcePdf.storageKey);
    await db.delete(schema.sourcePdfs).where(eq(schema.sourcePdfs.id, sourcePdf.id));
    return noContent();
  });

  return result instanceof Response ? result : noContent();
}
