import { NextResponse } from 'next/server';
import { savedItemUploadConfirmRequestSchema } from '@submittal/shared/api';

import { parseJson } from '@/server/api';
import { confirmSavedItemUpload } from '@/server/saved-items';
import { requestIdFrom } from '@/server/request-id';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request) {
  const body = await parseJson(req, savedItemUploadConfirmRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, (ctx) =>
    confirmSavedItemUpload({
      workspaceId: ctx.workspaceId,
      storageKey: body.storage_key,
      originalFilename: body.original_filename,
      requestId: requestIdFrom(req.headers),
    }),
  );

  if (result instanceof Response) return result;
  return NextResponse.json(result.body, { status: result.status });
}
