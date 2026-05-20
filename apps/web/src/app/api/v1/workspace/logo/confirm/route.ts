import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { logoConfirmRequestSchema } from '@submittal/shared/api';

import { jsonError, parseJson } from '@/server/api';
import { db, schema } from '@/server/db';
import { isWorkspaceStorageKey } from '@/server/file-records';
import { workspaceJson } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function POST(req: Request) {
  const body = await parseJson(req, logoConfirmRequestSchema);
  if (body instanceof Response) return body;

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    if (
      !isWorkspaceStorageKey(ctx.workspaceId, body.storage_key) ||
      !body.storage_key.includes('/logos/')
    ) {
      return jsonError(404, 'not_found', 'Not found');
    }

    const head = await getStorage().headObject(body.storage_key);
    if (!head) return jsonError(409, 'upload_missing', 'Uploaded object was not found');

    const [workspace] = await db
      .update(schema.workspaces)
      .set({ subCompanyLogoStorageKey: body.storage_key, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .returning();

    return workspaceJson(workspace!);
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
