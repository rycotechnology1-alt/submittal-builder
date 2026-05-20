import { NextResponse } from 'next/server';
import { logoPresignRequestSchema } from '@submittal/shared/api';

import { parseJson } from '@/server/api';
import { logoStorageKey, UPLOAD_URL_TTL_SECONDS } from '@/server/file-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request) {
  const body = await parseJson(req, logoPresignRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const storageKey = logoStorageKey(ctx.workspaceId, body.filename);
    const presigned = await getStorage().presignPutUrl({
      key: storageKey,
      contentType: body.content_type,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      requiredHeaders: { 'content-type': body.content_type },
    });

    return {
      upload_url: presigned.url,
      storage_key: storageKey,
      expires_at: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      required_headers: presigned.requiredHeaders,
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
