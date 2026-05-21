import { and, desc, eq, isNull } from 'drizzle-orm';

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
