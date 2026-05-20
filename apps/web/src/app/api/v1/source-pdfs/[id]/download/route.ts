import { NextResponse } from 'next/server';

import { type RouteContext, uuidParam } from '@/server/api';
import { DOWNLOAD_URL_TTL_SECONDS } from '@/server/file-records';
import { findSourcePdfInLivePackage, notFound } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const sourcePdf = await findSourcePdfInLivePackage(ctx.workspaceId, id);
    if (!sourcePdf) return notFound();

    return {
      url: await getStorage().presignGetUrl({
        key: sourcePdf.storageKey,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      }),
    };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
