import { NextResponse } from 'next/server';
import { savedItemUploadPresignRequestSchema } from '@submittal/shared/api';

import { parseJson } from '@/server/api';
import { presignSavedItemUpload } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request) {
  const body = await parseJson(req, savedItemUploadPresignRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, (ctx) =>
    presignSavedItemUpload({
      workspaceId: ctx.workspaceId,
      filename: body.filename,
      contentType: body.content_type,
    }),
  );

  if (result instanceof Response) return result;
  return NextResponse.json(result, { status: 201 });
}
