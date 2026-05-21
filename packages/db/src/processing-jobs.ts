import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { type Db, schema } from './client.js';
import type { ProcessingJob } from './schema.js';

export type ProcessingJobKind = ProcessingJob['kind'];
export type ProcessingJobStatus = ProcessingJob['status'];

export type ProcessingJobIdentity = {
  packageId: string;
  sourcePdfId: string | null;
  kind: ProcessingJobKind;
};

function sourcePdfPredicate(identity: ProcessingJobIdentity) {
  return identity.sourcePdfId
    ? eq(schema.processingJobs.sourcePdfId, identity.sourcePdfId)
    : isNull(schema.processingJobs.sourcePdfId);
}

function identityPredicate(identity: ProcessingJobIdentity) {
  return and(
    eq(schema.processingJobs.packageId, identity.packageId),
    eq(schema.processingJobs.kind, identity.kind),
    sourcePdfPredicate(identity),
  );
}

function logicalKey(job: Pick<ProcessingJob, 'kind' | 'packageId' | 'sourcePdfId'>) {
  return `${job.kind}:${job.packageId}:${job.sourcePdfId ?? 'package'}`;
}

function isNewer(a: ProcessingJob, b: ProcessingJob) {
  if (a.attempts !== b.attempts) return a.attempts > b.attempts;
  return a.createdAt.getTime() > b.createdAt.getTime();
}

export async function getLatestProcessingJob(db: Db, identity: ProcessingJobIdentity) {
  const [job] = await db
    .select()
    .from(schema.processingJobs)
    .where(identityPredicate(identity))
    .orderBy(desc(schema.processingJobs.attempts), desc(schema.processingJobs.createdAt))
    .limit(1);
  return job ?? null;
}

export async function createQueuedProcessingJobAttempt(db: Db, identity: ProcessingJobIdentity) {
  const latest = await getLatestProcessingJob(db, identity);
  const [job] = await db
    .insert(schema.processingJobs)
    .values({
      packageId: identity.packageId,
      sourcePdfId: identity.sourcePdfId,
      kind: identity.kind,
      status: 'queued',
      attempts: (latest?.attempts ?? 0) + 1,
    })
    .returning();
  return job;
}

export async function startProcessingJobAttempt(db: Db, identity: ProcessingJobIdentity) {
  const latest = await getLatestProcessingJob(db, identity);

  if (latest?.status === 'queued') {
    const [job] = await db
      .update(schema.processingJobs)
      .set({
        status: 'running',
        startedAt: new Date(),
        finishedAt: null,
        error: null,
      })
      .where(eq(schema.processingJobs.id, latest.id))
      .returning();
    return job ?? null;
  }

  if (latest?.status === 'running') return latest;

  const [job] = await db
    .insert(schema.processingJobs)
    .values({
      packageId: identity.packageId,
      sourcePdfId: identity.sourcePdfId,
      kind: identity.kind,
      status: 'running',
      attempts: (latest?.attempts ?? 0) + 1,
      startedAt: new Date(),
    })
    .returning();
  return job ?? null;
}

export async function finishProcessingJobAttempt(
  db: Db,
  identity: ProcessingJobIdentity,
  status: Extract<ProcessingJobStatus, 'succeeded' | 'failed'>,
  error?: unknown,
) {
  const [latestRunning] = await db
    .select()
    .from(schema.processingJobs)
    .where(and(identityPredicate(identity), eq(schema.processingJobs.status, 'running')))
    .orderBy(desc(schema.processingJobs.attempts), desc(schema.processingJobs.createdAt))
    .limit(1);

  if (!latestRunning) return null;

  const [job] = await db
    .update(schema.processingJobs)
    .set({
      status,
      finishedAt: new Date(),
      error: status === 'failed' ? (error instanceof Error ? error.message : String(error)) : null,
    })
    .where(eq(schema.processingJobs.id, latestRunning.id))
    .returning();
  return job ?? null;
}

export type ProcessingJobsHealth = {
  /** Failed attempts in the last 5 minutes / total finished in the same window. 0 when there are no finished jobs. */
  errorRate5m: number;
  /** Age in seconds of the oldest 'queued' or 'running' attempt. 0 when nothing is in flight. */
  oldestJobAgeS: number;
  /** Number of failed attempts in the last 5 minutes (for log/observability). */
  failed5m: number;
  /** Total attempts that reached a terminal state (succeeded|failed) in the last 5 minutes. */
  finished5m: number;
};

/**
 * Aggregate stats for the worker /healthz endpoint. Reads directly from the
 * app-owned `processing_jobs` table — pg-boss internal tables are intentionally
 * not consulted so this matches what users see in the status APIs.
 */
export async function getProcessingJobsHealth(db: Db): Promise<ProcessingJobsHealth> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const [windowRow] = await db
    .select({
      finished: sql<number>`count(*) filter (where ${schema.processingJobs.status} in ('succeeded','failed'))`,
      failed: sql<number>`count(*) filter (where ${schema.processingJobs.status} = 'failed')`,
    })
    .from(schema.processingJobs)
    .where(gte(schema.processingJobs.finishedAt, fiveMinAgo));

  const finished5m = Number(windowRow?.finished ?? 0);
  const failed5m = Number(windowRow?.failed ?? 0);
  const errorRate5m = finished5m === 0 ? 0 : failed5m / finished5m;

  const [oldestRow] = await db
    .select({
      oldest: sql<Date | null>`min(${schema.processingJobs.createdAt})`,
    })
    .from(schema.processingJobs)
    .where(
      sql`${schema.processingJobs.status} in ('queued','running')`,
    );

  const oldest = oldestRow?.oldest ? new Date(oldestRow.oldest) : null;
  const oldestJobAgeS = oldest ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 1000)) : 0;

  return { errorRate5m, oldestJobAgeS, failed5m, finished5m };
}

export async function latestProcessingJobsForPackage(db: Db, packageId: string) {
  const jobs = await db
    .select()
    .from(schema.processingJobs)
    .where(eq(schema.processingJobs.packageId, packageId));

  const latestByKey = new Map<string, ProcessingJob>();
  for (const job of jobs) {
    const key = logicalKey(job);
    const current = latestByKey.get(key);
    if (!current || isNewer(job, current)) latestByKey.set(key, job);
  }

  return [...latestByKey.values()];
}
