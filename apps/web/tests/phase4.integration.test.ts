import '@/env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { POST as signupPOST } from '@/app/api/v1/auth/signup/route';
import { POST as projectsPOST } from '@/app/api/v1/projects/route';
import { POST as projectPackagesPOST } from '@/app/api/v1/projects/[id]/packages/route';
import { GET as packageStatusGET } from '@/app/api/v1/packages/[id]/status/route';
import { POST as cancelProcessingPOST } from '@/app/api/v1/packages/[id]/cancel-processing/route';
import { POST as cancelSourcePdfProcessingPOST } from '@/app/api/v1/source-pdfs/[id]/cancel-processing/route';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'phase-4-test-pass-1234';

type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

type QueueCall = {
  name: string;
  data: Record<string, unknown>;
  options: Record<string, unknown>;
};

const queueCalls: QueueCall[] = [];

function ctx<T extends Record<string, string>>(params: T): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

function fakeReq(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${pathname}`, init);
}

function jsonReq(pathname: string, cookie: string, body: unknown = {}, method = 'POST'): Request {
  return fakeReq(pathname, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://localhost:3000',
      'idempotency-key': `test-${randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
}

function authedReq(pathname: string, cookie: string, init?: RequestInit): Request {
  return fakeReq(pathname, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie, origin: 'http://localhost:3000' },
  });
}

async function flipEmailVerified(email: string): Promise<void> {
  await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
}

async function loadProcessRoute() {
  vi.resetModules();
  queueCalls.length = 0;
  vi.doMock('@/server/processing-queue', () => ({
    getProcessingQueue: () => ({
      send: async (name: string, data: Record<string, unknown>, options: Record<string, unknown>) => {
        queueCalls.push({ name, data, options });
        return `job-${queueCalls.length}`;
      },
    }),
  }));
  return import('@/app/api/v1/packages/[id]/process/route');
}

async function createAuthedUser(label: string) {
  const email = `phase4-${label}-${randomUUID()}@example.test`;
  const signup = await signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `Phase 4 ${label}`,
        workspace_name: `Phase 4 ${label} Workspace`,
        sub_company_name: `Phase 4 ${label} Sub`,
      }),
    }),
  );
  expect(signup.status).toBe(200);
  await flipEmailVerified(email);

  const signin = (await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  })) as Response;
  expect(signin.status).toBe(200);
  const jar = new CookieJar();
  jar.ingest(signin);

  const [user] = await db
    .select({ workspaceId: schema.users.workspaceId })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  expect(user).toBeDefined();

  return { email, cookie: jar.header(), workspaceId: user!.workspaceId };
}

async function createPackage(cookie: string) {
  const projectRes = await projectsPOST(
    jsonReq('/api/v1/projects', cookie, {
      name: `Phase 4 Project ${randomUUID()}`,
      project_number: 'P-400',
      gc_name: 'Turner',
      architect_name: 'SOM',
    }),
  );
  expect(projectRes.status).toBe(201);
  const project = (await projectRes.json()) as { id: string };

  const packageRes = await projectPackagesPOST(
    jsonReq(`/api/v1/projects/${project.id}/packages`, cookie, {
      submittal_number: '23 81 00-004',
      spec_section: '23 81 00',
      title: 'Phase 4 Package',
    }),
    ctx({ projectId: project.id }),
  );
  expect(packageRes.status).toBe(201);
  return (await packageRes.json()) as { id: string };
}

async function insertConfirmedSourcePdf(input: {
  workspaceId: string;
  packageId: string;
  filename: string;
  hasOcr: boolean;
}) {
  const [pdf] = await db
    .insert(schema.sourcePdfs)
    .values({
      workspaceId: input.workspaceId,
      packageId: input.packageId,
      storageKey: `workspaces/${input.workspaceId}/source_pdfs/${randomUUID()}.pdf`,
      originalFilename: input.filename,
      byteSize: 1234,
      sha256: randomUUID().replaceAll('-', ''),
      pageCount: 1,
      processingStatus: 'uploaded',
    })
    .returning();
  expect(pdf).toBeDefined();

  const [page] = await db
    .insert(schema.sourcePages)
    .values({
      sourcePdfId: pdf!.id,
      pageNumber: 1,
      ocrText: input.hasOcr ? 'Manufacturer: Johnson Controls. Model: VAHR072B31S.' : null,
      hasOcr: input.hasOcr,
    })
    .returning();
  expect(page).toBeDefined();
  return { pdf: pdf!, page: page! };
}

describe('Phase 4 processing pipeline', () => {
  const emails: string[] = [];

  afterEach(async () => {
    vi.doUnmock('@/server/processing-queue');
    while (emails.length > 0) {
      const email = emails.pop();
      if (email) await deleteUserByEmail(email);
    }
  });

  it('enqueues the first needed jobs, records queued processing rows, and is idempotent', async () => {
    const { POST: processPOST } = await loadProcessRoute();
    const user = await createAuthedUser('process');
    emails.push(user.email);
    const pkg = await createPackage(user.cookie);
    const textReady = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'text-ready.pdf',
      hasOcr: true,
    });
    const needsOcr = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'scan.pdf',
      hasOcr: false,
    });

    const first = await processPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/process`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toEqual({
      status: 'processing',
      enqueued: {
        ocr: 1,
        classify: 1,
        extract: 0,
        batch_order: 0,
      },
    });

    expect(queueCalls.map((call) => call.name).sort()).toEqual([
      'classify',
      'ocr',
    ]);
    expect(queueCalls.find((call) => call.name === 'ocr')?.options).toMatchObject({
      singletonKey: `ocr:${needsOcr.pdf.id}`,
      retryLimit: 3,
      retryBackoff: true,
    });
    expect(queueCalls.find((call) => call.name === 'classify')?.options).toMatchObject({
      singletonKey: `classify:${textReady.pdf.id}`,
      retryLimit: 3,
      retryBackoff: true,
    });

    const rows = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.packageId, pkg.id));
    expect(
      rows
        .map(
          (row) =>
            `${row.kind}:${row.sourcePdfId ?? 'package'}:${row.status}:attempt-${row.attempts}`,
        )
        .sort(),
    ).toEqual([
      `classify:${textReady.pdf.id}:queued:attempt-1`,
      `ocr:${needsOcr.pdf.id}:queued:attempt-1`,
    ]);

    const status = await packageStatusGET(
      authedReq(`/api/v1/packages/${pkg.id}/status`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      status: 'processing',
      jobs_summary: { queued: 2, running: 0, failed: 0 },
      source_pdfs: expect.arrayContaining([
        { id: textReady.pdf.id, processing_status: 'classifying', processing_error: null },
        { id: needsOcr.pdf.id, processing_status: 'ocr_running', processing_error: null },
      ]),
    });

    const second = await processPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/process`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toEqual({
      status: 'processing',
      enqueued: { ocr: 0, classify: 0, extract: 0, batch_order: 0 },
    });
    expect(queueCalls).toHaveLength(2);

    const after = await db
      .select()
      .from(schema.processingJobs)
      .where(
        and(
          eq(schema.processingJobs.packageId, pkg.id),
          eq(schema.processingJobs.status, 'queued'),
        ),
      );
    expect(after).toHaveLength(2);
  });

  it('allows a new queued attempt after the latest matching job failed', async () => {
    const { POST: processPOST } = await loadProcessRoute();
    const user = await createAuthedUser('retry');
    emails.push(user.email);
    const pkg = await createPackage(user.cookie);
    const source = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'retry-after-fail.pdf',
      hasOcr: true,
    });

    await db.insert(schema.processingJobs).values({
      packageId: pkg.id,
      sourcePdfId: source.pdf.id,
      kind: 'classify',
      status: 'failed',
      attempts: 1,
      error: 'first attempt failed',
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    const res = await processPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/process`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({
      status: 'processing',
      enqueued: { classify: 1 },
    });

    const attempts = await db
      .select({
        status: schema.processingJobs.status,
        attempts: schema.processingJobs.attempts,
        error: schema.processingJobs.error,
      })
      .from(schema.processingJobs)
      .where(
        and(
          eq(schema.processingJobs.packageId, pkg.id),
          eq(schema.processingJobs.sourcePdfId, source.pdf.id),
          eq(schema.processingJobs.kind, 'classify'),
        ),
      );

    expect(attempts).toEqual(
      expect.arrayContaining([
        { attempts: 1, status: 'failed', error: 'first attempt failed' },
        { attempts: 2, status: 'queued', error: null },
      ]),
    );
  });

  it('summarizes only the latest processing attempt per logical job', async () => {
    const user = await createAuthedUser('status-latest');
    emails.push(user.email);
    const pkg = await createPackage(user.cookie);
    const source = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'status-latest.pdf',
      hasOcr: true,
    });

    await db.insert(schema.processingJobs).values([
      {
        packageId: pkg.id,
        sourcePdfId: source.pdf.id,
        kind: 'classify',
        status: 'failed',
        attempts: 1,
        error: 'first attempt failed',
        startedAt: new Date(),
        finishedAt: new Date(),
      },
      {
        packageId: pkg.id,
        sourcePdfId: source.pdf.id,
        kind: 'classify',
        status: 'running',
        attempts: 2,
        startedAt: new Date(),
      },
    ]);

    const status = await packageStatusGET(
      authedReq(`/api/v1/packages/${pkg.id}/status`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      jobs_summary: { queued: 0, running: 1, failed: 0 },
    });
  });

  it('summarizes active, blocked, and cancellable package processing state', async () => {
    const user = await createAuthedUser('status-summary');
    emails.push(user.email);
    const pkg = await createPackage(user.cookie);
    const active = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'active.pdf',
      hasOcr: true,
    });
    const failed = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'failed.pdf',
      hasOcr: true,
    });

    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'classifying' })
      .where(eq(schema.sourcePdfs.id, active.pdf.id));
    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'error', processingError: 'S3 denied' })
      .where(eq(schema.sourcePdfs.id, failed.pdf.id));

    const activeStatus = await packageStatusGET(
      authedReq(`/api/v1/packages/${pkg.id}/status`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(activeStatus.status).toBe(200);
    await expect(activeStatus.json()).resolves.toMatchObject({
      processing_state: 'active',
      has_active_processing: true,
      has_errors: true,
      can_cancel: true,
      terminal_counts: { extracted: 0, error: 1, cancelled: 0 },
    });

    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'error', processingError: 'Worker failed' })
      .where(eq(schema.sourcePdfs.id, active.pdf.id));

    const blockedStatus = await packageStatusGET(
      authedReq(`/api/v1/packages/${pkg.id}/status`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(blockedStatus.status).toBe(200);
    await expect(blockedStatus.json()).resolves.toMatchObject({
      processing_state: 'blocked',
      has_active_processing: false,
      has_errors: true,
      can_cancel: false,
      terminal_counts: { extracted: 0, error: 2, cancelled: 0 },
    });
  });

  it('cancels active package processing without deleting uploaded PDFs', async () => {
    const user = await createAuthedUser('cancel');
    emails.push(user.email);
    const pkg = await createPackage(user.cookie);
    const active = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'active.pdf',
      hasOcr: true,
    });
    const done = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'done.pdf',
      hasOcr: true,
    });

    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'classifying' })
      .where(eq(schema.sourcePdfs.id, active.pdf.id));
    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'extracted' })
      .where(eq(schema.sourcePdfs.id, done.pdf.id));
    await db.insert(schema.processingJobs).values({
      packageId: pkg.id,
      sourcePdfId: active.pdf.id,
      kind: 'classify',
      status: 'running',
      attempts: 1,
      startedAt: new Date(),
    });

    const cancel = await cancelProcessingPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/cancel-processing`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(cancel.status).toBe(202);
    await expect(cancel.json()).resolves.toMatchObject({
      processing_state: 'cancelled',
      cancelled_source_pdf_count: 1,
    });

    const pdfs = await db
      .select({
        id: schema.sourcePdfs.id,
        status: schema.sourcePdfs.processingStatus,
        error: schema.sourcePdfs.processingError,
      })
      .from(schema.sourcePdfs)
      .where(eq(schema.sourcePdfs.packageId, pkg.id));
    expect(pdfs).toEqual(
      expect.arrayContaining([
        { id: active.pdf.id, status: 'cancelled', error: 'Processing cancelled by user.' },
        { id: done.pdf.id, status: 'extracted', error: null },
      ]),
    );

    const [job] = await db
      .select({ status: schema.processingJobs.status, error: schema.processingJobs.error })
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.sourcePdfId, active.pdf.id))
      .limit(1);
    expect(job).toEqual({ status: 'failed', error: 'Processing cancelled by user.' });
  });

  it('cancels a single active source PDF without cancelling its siblings', async () => {
    const user = await createAuthedUser('cancel-source');
    emails.push(user.email);
    const pkg = await createPackage(user.cookie);
    const target = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'target.pdf',
      hasOcr: true,
    });
    const sibling = await insertConfirmedSourcePdf({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
      filename: 'sibling.pdf',
      hasOcr: true,
    });

    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'extracting' })
      .where(eq(schema.sourcePdfs.id, target.pdf.id));
    await db
      .update(schema.sourcePdfs)
      .set({ processingStatus: 'classifying' })
      .where(eq(schema.sourcePdfs.id, sibling.pdf.id));
    await db.insert(schema.processingJobs).values([
      {
        packageId: pkg.id,
        sourcePdfId: target.pdf.id,
        kind: 'extract',
        status: 'running',
        attempts: 1,
        startedAt: new Date(),
      },
      {
        packageId: pkg.id,
        sourcePdfId: sibling.pdf.id,
        kind: 'classify',
        status: 'running',
        attempts: 1,
        startedAt: new Date(),
      },
    ]);

    const cancel = await cancelSourcePdfProcessingPOST(
      jsonReq(`/api/v1/source-pdfs/${target.pdf.id}/cancel-processing`, user.cookie),
      ctx({ id: target.pdf.id }),
    );
    expect(cancel.status).toBe(202);
    await expect(cancel.json()).resolves.toMatchObject({
      id: target.pdf.id,
      processing_status: 'cancelled',
      processing_error: 'Processing cancelled by user.',
    });

    const pdfs = await db
      .select({
        id: schema.sourcePdfs.id,
        status: schema.sourcePdfs.processingStatus,
        error: schema.sourcePdfs.processingError,
      })
      .from(schema.sourcePdfs)
      .where(eq(schema.sourcePdfs.packageId, pkg.id));
    expect(pdfs).toEqual(
      expect.arrayContaining([
        { id: target.pdf.id, status: 'cancelled', error: 'Processing cancelled by user.' },
        { id: sibling.pdf.id, status: 'classifying', error: null },
      ]),
    );

    const jobs = await db
      .select({
        sourcePdfId: schema.processingJobs.sourcePdfId,
        status: schema.processingJobs.status,
        error: schema.processingJobs.error,
      })
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.packageId, pkg.id));
    expect(jobs).toEqual(
      expect.arrayContaining([
        {
          sourcePdfId: target.pdf.id,
          status: 'failed',
          error: 'Processing cancelled by user.',
        },
        { sourcePdfId: sibling.pdf.id, status: 'running', error: null },
      ]),
    );
  });
});
