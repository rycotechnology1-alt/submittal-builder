import { NextResponse } from 'next/server';
import { renderPdfPageToWebp } from '@submittal/shared/pdf';

import { type RouteContext, uuidParam } from '@/server/api';
import { DOWNLOAD_URL_TTL_SECONDS, pagePreviewStorageKey } from '@/server/file-records';
import { findSourcePageInLivePackage, notFound } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const row = await findSourcePageInLivePackage(ctx.workspaceId, id);
    if (!row) return notFound();

    const storage = getStorage();
    const previewKey = pagePreviewStorageKey(ctx.workspaceId, row.page.id);
    const existing = await storage.headObject(previewKey);
    if (!existing) {
      const pdfBytes = await storage.getObjectBytes(row.sourcePdf.storageKey);
      const webp = await renderPdfPageToWebp({
        bytes: pdfBytes,
        pageNumber: row.page.pageNumber,
      });
      await storage.putObject({ key: previewKey, body: webp, contentType: 'image/webp' });
    }

    return {
      image_url: await storage.presignGetUrl({
        key: previewKey,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      }),
      ocr_text: row.page.ocrText,
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
