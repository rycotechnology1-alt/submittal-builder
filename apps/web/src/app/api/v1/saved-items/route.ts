import { NextResponse } from 'next/server';

import { listSavedItems } from '@/server/saved-items';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request) {
  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const url = new URL(req.url);
    return { data: await listSavedItems(ctx.workspaceId, url.searchParams.get('q')) };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
