import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { jsonError, type RouteContext, uuidParam } from '@/server/api';
import { db, schema } from '@/server/db';
import { notFound } from '@/server/phase2-records';
import { getStorage } from '@/server/storage';
import { withWorkspaceFromHeaders } from '@/server/workspace';

export async function GET(req: Request, context: RouteContext<{ id: string }>) {
  const id = await uuidParam(context, 'id');
  if (id instanceof Response) return id;

  const url = new URL(req.url);
  const dispositionParam = url.searchParams.get('disposition');
  const disposition: 'attachment' | 'inline' =
    dispositionParam === 'inline' ? 'inline' : 'attachment';

  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const [row] = await db
      .select({
        export: schema.exports,
        packageTitle: schema.packages.title,
        submittalNumber: schema.packages.submittalNumber,
        revision: schema.packages.revision,
      })
      .from(schema.exports)
      .innerJoin(schema.packages, eq(schema.exports.packageId, schema.packages.id))
      .where(and(eq(schema.exports.id, id), eq(schema.packages.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!row) return notFound();
    if (row.export.status !== 'ready') {
      return jsonError(409, 'export_not_ready', `Export is ${row.export.status}`);
    }

    const responseContentDisposition =
      disposition === 'attachment'
        ? `attachment; filename="${buildDownloadFilename({
            title: row.packageTitle,
            submittalNumber: row.submittalNumber,
            revision: row.revision,
          })}"`
        : 'inline';

    const url = await getStorage().presignGetUrl({
      key: row.export.storageKey,
      expiresInSeconds: 5 * 60,
      responseContentDisposition,
    });
    return { url };
  });

  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

function buildDownloadFilename(opts: {
  title: string | null;
  submittalNumber: string;
  revision: string;
}): string {
  const base = opts.title?.trim()
    ? opts.title.trim()
    : `${opts.submittalNumber} ${opts.revision}`.trim();
  const sanitized = sanitizeFilename(base) || 'package';
  return `${sanitized}.pdf`;
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);
}
