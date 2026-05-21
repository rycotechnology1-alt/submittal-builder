import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });
process.env.DATABASE_URL ??= process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;

const { getDb, schema } = await import('@submittal/db');
const { runBatchOrderJob } = await import('../src/jobs/batch-order.js');
const { runClassifyJob } = await import('../src/jobs/classify.js');
const { runExtractJob } = await import('../src/jobs/extract.js');
const { markJobFailed, markJobRunning, markJobSucceeded } = await import('../src/jobs/common.js');

const db = getDb({ url: process.env.DATABASE_URL, max: 1 });

type JobData = {
  workspaceId: string;
  packageId: string;
  sourcePdfId: string;
};

type StoredObject = {
  body: Uint8Array;
  contentType: string;
};

class FakeStorage {
  readonly objects = new Map<string, StoredObject>();

  async getObjectBytes(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing object ${key}`);
    return object.body;
  }
}

async function insertPackage() {
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      name: 'Phase 4 Worker Workspace',
      subCompanyName: 'Phase 4 Worker Sub',
    })
    .returning();
  expect(workspace).toBeDefined();

  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: workspace!.id,
      name: 'Phase 4 Worker Project',
    })
    .returning();
  expect(project).toBeDefined();

  const [pkg] = await db
    .insert(schema.packages)
    .values({
      workspaceId: workspace!.id,
      projectId: project!.id,
      submittalNumber: '23 81 00-004',
      specSection: '23 81 00',
      title: 'Worker Package',
      status: 'processing',
    })
    .returning();
  expect(pkg).toBeDefined();

  return { workspace: workspace!, project: project!, pkg: pkg! };
}

async function insertSourcePdf(input: { workspaceId: string; packageId: string; filename: string }) {
  const [pdf] = await db
    .insert(schema.sourcePdfs)
    .values({
      workspaceId: input.workspaceId,
      packageId: input.packageId,
      storageKey: `workspaces/${input.workspaceId}/source_pdfs/${input.filename}`,
      originalFilename: input.filename,
      byteSize: 7,
      sha256: input.filename.replaceAll(/[^a-z0-9]/gi, ''),
      pageCount: 1,
      processingStatus: 'classifying',
    })
    .returning();
  expect(pdf).toBeDefined();

  const [page] = await db
    .insert(schema.sourcePages)
    .values({
      sourcePdfId: pdf!.id,
      pageNumber: 1,
      ocrText: 'Johnson Controls VAHR072B31S 6-ton VRF heat recovery outdoor unit.',
      hasOcr: true,
    })
    .returning();
  expect(page).toBeDefined();

  return { pdf: pdf!, page: page! };
}

async function insertQueuedJob(input: {
  packageId: string;
  sourcePdfId: string | null;
  kind: 'classify' | 'extract' | 'batch_order';
}) {
  await db.insert(schema.processingJobs).values({
    packageId: input.packageId,
    sourcePdfId: input.sourcePdfId,
    kind: input.kind,
    status: 'queued',
    attempts: 1,
  });
}

describe('Phase 4 worker jobs', () => {
  const workspaceIds: string[] = [];

  afterEach(async () => {
    while (workspaceIds.length > 0) {
      const id = workspaceIds.pop();
      if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
  });

  it('classifies, extracts attributes with immutable original AI values, and orders the package', async () => {
    const { workspace, pkg } = await insertPackage();
    workspaceIds.push(workspace.id);
    const { pdf, page } = await insertSourcePdf({
      workspaceId: workspace.id,
      packageId: pkg.id,
      filename: 'daikin.pdf',
    });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: pdf.id, kind: 'classify' });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: pdf.id, kind: 'extract' });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: null, kind: 'batch_order' });

    const storage = new FakeStorage();
    storage.objects.set(pdf.storageKey, {
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
      contentType: 'application/pdf',
    });

    const data: JobData = {
      workspaceId: workspace.id,
      packageId: pkg.id,
      sourcePdfId: pdf.id,
    };

    await runClassifyJob(
      {
        db,
        storage,
        renderPageImages: async () => [new Uint8Array([9])],
        ai: {
          classifyDocument: async () => ({
            doc_type: 'product_data',
            confidence: 0.97,
          }),
        },
      },
      data,
    );

    const [item] = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.packageId, pkg.id), eq(schema.items.workspaceId, workspace.id)))
      .limit(1);
    expect(item).toMatchObject({
      docType: 'product_data',
      docTypeConfidence: 0.97,
      docTypeOriginalAiValue: 'product_data',
      title: 'daikin.pdf',
    });

    await runExtractJob(
      {
        db,
        storage,
        renderPageImages: async () => [new Uint8Array([9])],
        ai: {
          extractAttributes: async () => ({
            manufacturer: { value: 'Johnson Controls', confidence: 0.99, source_page: 1 },
            model_number: { value: 'VAHR072B31S', confidence: 0.98, source_page: 1 },
            description: {
              value: '6-ton VRF heat recovery outdoor unit',
              confidence: 0.95,
              source_page: 1,
            },
            spec_section_ref: { value: '23 81 00', confidence: 0.9, source_page: 1 },
          }),
        },
      },
      data,
    );

    const attrs = await db
      .select()
      .from(schema.itemAttributes)
      .where(eq(schema.itemAttributes.itemId, item!.id));
    expect(attrs).toHaveLength(4);
    expect(
      attrs.map((attr) => ({
        key: attr.key,
        currentValue: attr.currentValue,
        originalAiValue: attr.originalAiValue,
        sourcePageId: attr.sourcePageId,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          key: 'manufacturer',
          currentValue: 'Johnson Controls',
          originalAiValue: 'Johnson Controls',
          sourcePageId: page.id,
        },
        {
          key: 'model_number',
          currentValue: 'VAHR072B31S',
          originalAiValue: 'VAHR072B31S',
          sourcePageId: page.id,
        },
      ]),
    );

    await runBatchOrderJob({ db }, { workspaceId: workspace.id, packageId: pkg.id });

    const [updatedPackage] = await db
      .select({ status: schema.packages.status })
      .from(schema.packages)
      .where(eq(schema.packages.id, pkg.id))
      .limit(1);
    expect(updatedPackage?.status).toBe('ready');

    const jobs = await db
      .select({ kind: schema.processingJobs.kind, status: schema.processingJobs.status })
      .from(schema.processingJobs)
      .where(
        and(
          eq(schema.processingJobs.packageId, pkg.id),
          inArray(schema.processingJobs.kind, ['classify', 'extract', 'batch_order']),
        ),
      );
    expect(jobs.every((job) => job.status === 'succeeded')).toBe(true);
  });

  it('enqueues batch ordering only after every source PDF has extracted', async () => {
    const { workspace, pkg } = await insertPackage();
    workspaceIds.push(workspace.id);
    const first = await insertSourcePdf({
      workspaceId: workspace.id,
      packageId: pkg.id,
      filename: 'first.pdf',
    });
    const second = await insertSourcePdf({
      workspaceId: workspace.id,
      packageId: pkg.id,
      filename: 'second.pdf',
    });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: first.pdf.id, kind: 'classify' });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: first.pdf.id, kind: 'extract' });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: second.pdf.id, kind: 'classify' });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: second.pdf.id, kind: 'extract' });

    const storage = new FakeStorage();
    storage.objects.set(first.pdf.storageKey, {
      body: new Uint8Array([1]),
      contentType: 'application/pdf',
    });
    storage.objects.set(second.pdf.storageKey, {
      body: new Uint8Array([2]),
      contentType: 'application/pdf',
    });

    const enqueued: string[] = [];
    const classifyAi = {
      classifyDocument: async () => ({
        doc_type: 'product_data',
        confidence: 0.96,
      }),
    };
    const extractAi = {
      extractAttributes: async () => ({
        manufacturer: { value: 'Johnson Controls', confidence: 0.99, source_page: 1 },
        model_number: { value: crypto.randomUUID(), confidence: 0.98, source_page: 1 },
        description: { value: 'VRF heat recovery outdoor unit', confidence: 0.95, source_page: 1 },
        spec_section_ref: { value: '23 81 00', confidence: 0.9, source_page: 1 },
      }),
    };

    await runClassifyJob(
      { db, storage, renderPageImages: async () => [new Uint8Array([9])], ai: classifyAi },
      { workspaceId: workspace.id, packageId: pkg.id, sourcePdfId: first.pdf.id },
    );
    await runExtractJob(
      {
        db,
        storage,
        renderPageImages: async () => [new Uint8Array([9])],
        ai: extractAi,
        enqueue: async (name) => enqueued.push(name),
      },
      { workspaceId: workspace.id, packageId: pkg.id, sourcePdfId: first.pdf.id },
    );
    expect(enqueued).toEqual([]);

    await runClassifyJob(
      { db, storage, renderPageImages: async () => [new Uint8Array([9])], ai: classifyAi },
      { workspaceId: workspace.id, packageId: pkg.id, sourcePdfId: second.pdf.id },
    );
    await runExtractJob(
      {
        db,
        storage,
        renderPageImages: async () => [new Uint8Array([9])],
        ai: extractAi,
        enqueue: async (name) => enqueued.push(name),
      },
      { workspaceId: workspace.id, packageId: pkg.id, sourcePdfId: second.pdf.id },
    );
    expect(enqueued).toEqual(['batch_order']);
  });

  it('records a separate processing job row for each retry attempt', async () => {
    const { workspace, pkg } = await insertPackage();
    workspaceIds.push(workspace.id);
    const { pdf } = await insertSourcePdf({
      workspaceId: workspace.id,
      packageId: pkg.id,
      filename: 'retry.pdf',
    });
    await insertQueuedJob({ packageId: pkg.id, sourcePdfId: pdf.id, kind: 'classify' });

    const data = { workspaceId: workspace.id, packageId: pkg.id };

    await markJobRunning(db, data, 'classify', pdf.id);
    await markJobFailed(db, data, 'classify', new Error('first attempt failed'), pdf.id);
    await markJobRunning(db, data, 'classify', pdf.id);
    await markJobSucceeded(db, data, 'classify', pdf.id);

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
          eq(schema.processingJobs.sourcePdfId, pdf.id),
          eq(schema.processingJobs.kind, 'classify'),
        ),
      )
      .orderBy(schema.processingJobs.attempts);

    expect(attempts).toEqual([
      { attempts: 1, status: 'failed', error: 'first attempt failed' },
      { attempts: 2, status: 'succeeded', error: null },
    ]);
  });
});
