import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sourcePdfPresignRequestSchema } from '@submittal/shared/api';

import { parseJson, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { sourcePdfStorageKey, UPLOAD_URL_TTL_SECONDS } from '@/server/file-records';
import { findLivePackage, notFound } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;
  const body = await parseJson(req, sourcePdfPresignRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();

    const sourcePdfId = randomUUID();
    const storageKey = sourcePdfStorageKey(ctx.workspaceId, sourcePdfId);
    const requiredHeaders = { 'content-type': body.content_type };
    const presigned = await getStorage().presignPutUrl({
      key: storageKey,
      contentType: body.content_type,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      requiredHeaders,
    });

    await db.insert(schema.sourcePdfs).values({
      id: sourcePdfId,
      packageId: pkg.id,
      workspaceId: ctx.workspaceId,
      storageKey,
      originalFilename: body.filename,
      processingStatus: 'uploaded',
    });

    return {
      source_pdf_id: sourcePdfId,
      upload_url: presigned.url,
      storage_key: storageKey,
      expires_at: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      required_headers: presigned.requiredHeaders,
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
