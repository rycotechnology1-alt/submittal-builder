import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { parsePdfPages } from '@submittal/shared/pdf';
import { sourcePdfConfirmRequestSchema } from '@submittal/shared/api';

import { jsonError, parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { sha256Hex } from '@/server/file-records';
import { findLivePackage, notFound, sourcePdfJson } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(
  req: Request,
  context: RouteContext<{ id: string; sourcePdfId: string }>,
) {
  const packageId = await uuidParam(context, 'id');
  if (packageId instanceof Response) return packageId;
  const sourcePdfId = await uuidParam(context, 'sourcePdfId');
  if (sourcePdfId instanceof Response) return sourcePdfId;
  const body = await parseJson(req, sourcePdfConfirmRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, packageId);
    if (!pkg) return notFound();

    const [sourcePdf] = await db
      .select()
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.id, sourcePdfId),
          eq(schema.sourcePdfs.packageId, pkg.id),
          eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1);
    if (!sourcePdf) return notFound();

    const storage = getStorage();
    const head = await storage.headObject(sourcePdf.storageKey);
    if (!head) return jsonError(409, 'upload_missing', 'Uploaded object was not found');

    const bytes = await storage.getObjectBytes(sourcePdf.storageKey);
    const sha256 = sha256Hex(bytes);
    const [duplicate] = await db
      .select({ id: schema.sourcePdfs.id })
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.packageId, pkg.id),
          eq(schema.sourcePdfs.workspaceId, ctx.workspaceId),
          eq(schema.sourcePdfs.sha256, sha256),
          ne(schema.sourcePdfs.id, sourcePdf.id),
        ),
      )
      .limit(1);
    if (duplicate) {
      return jsonError(409, 'duplicate_source_pdf', 'Source PDF already exists in this package', {
        existing_source_pdf_id: duplicate.id,
      });
    }

    const parsed = await parsePdfPages(bytes);
    await db.transaction(async (tx) => {
      await tx.delete(schema.sourcePages).where(eq(schema.sourcePages.sourcePdfId, sourcePdf.id));
      await tx.insert(schema.sourcePages).values(
        parsed.pages.map((page) => ({
          sourcePdfId: sourcePdf.id,
          pageNumber: page.pageNumber,
          ocrText: page.text,
          hasOcr: page.hasOcr,
        })),
      );
      await tx
        .update(schema.sourcePdfs)
        .set({
          byteSize: bytes.byteLength,
          sha256,
          pageCount: parsed.pageCount,
          processingStatus: 'uploaded',
          processingError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.sourcePdfs.id, sourcePdf.id));
    });

    const [updated] = await db
      .select()
      .from(schema.sourcePdfs)
      .where(eq(schema.sourcePdfs.id, sourcePdf.id))
      .limit(1);
    return sourcePdfJson(updated!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
