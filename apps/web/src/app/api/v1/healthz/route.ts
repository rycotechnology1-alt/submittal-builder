import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/server/db';

const gitSha =
  process.env.GIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.FLY_MACHINE_VERSION ??
  null;

const release = process.env.SENTRY_RELEASE ?? gitSha;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ts = new Date().toISOString();
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const status = dbOk ? 200 : 503;
  return NextResponse.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      ts,
      git_sha: gitSha,
      release,
      node_env: process.env.NODE_ENV ?? 'development',
      db_ok: dbOk,
      ...(dbError ? { db_error: dbError } : {}),
    },
    { status },
  );
}
