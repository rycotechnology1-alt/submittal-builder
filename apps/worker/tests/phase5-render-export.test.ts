import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });
process.env.DATABASE_URL ??= process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;

const { getDb, schema } = await import('@submittal/db');
const { runRenderExportJob } = await import('../src/jobs/render-export.js');

const db = getDb({ url: process.env.DATABASE_URL, max: 1 });

type PutCall = { key: string; body: Uint8Array; contentType: string };

class FakeStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: PutCall[] = [];

  async getObjectBytes(key: string) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`Missing object ${key}`);
    return obj;
  }

  async putObject(input: { key: string; body: Uint8Array; contentType: string }) {
    this.puts.push(input);
    this.objects.set(input.key, input.body);
  }

  async presignPutUrl(): Promise<{ url: string; requiredHeaders: Record<string, string> }> {
    throw new Error('unused');
  }
  async presignGetUrl(): Promise<string> {
    throw new Error('unused');
  }
  async headObject() {
    return null;
  }
  async deleteObject() {
    /* no-op */
  }
}

async function makeFixturePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`page ${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  return doc.save();
}

async function seedReadyPackage(label: string) {
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ name: `Phase 5 ${label} WS`, subCompanyName: `Phase 5 ${label} Sub` })
    .returning();
  const [creator] = await db
    .insert(schema.users)
    .values({
      workspaceId: workspace!.id,
      email: `phase5-${label}-${Date.now()}@example.test`,
      name: `Phase 5 ${label} User`,
      emailVerified: true,
    })
    .returning();
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: workspace!.id, name: `Phase 5 ${label} Project` })
    .returning();
  const [pkg] = await db
    .insert(schema.packages)
    .values({
      workspaceId: workspace!.id,
      projectId: project!.id,
      submittalNumber: '23 81 00-005',
      specSection: '23 81 00',
      title: `Phase 5 ${label}`,
      status: 'ready',
    })
    .returning();
  return { workspace: workspace!, creator: creator!, project: project!, pkg: pkg! };
}

describe('Phase 5 render_export worker job', () => {
  const workspaceIds: string[] = [];

  afterEach(async () => {
    while (workspaceIds.length > 0) {
      const id = workspaceIds.pop();
      if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
  });

  it('renders the package, uploads the assembled PDF, and marks the package exported', async () => {
    const { workspace, creator, pkg } = await seedReadyPackage('happy');
    workspaceIds.push(workspace.id);

    const [item] = await db
      .insert(schema.items)
      .values({
        workspaceId: workspace.id,
        packageId: pkg.id,
        docType: 'product_data',
        title: 'Daikin VRV Cut Sheet',
        sortOrder: 0,
      })
      .returning();
    const pdfBytes = await makeFixturePdf(3);
    const [sourcePdf] = await db
      .insert(schema.sourcePdfs)
      .values({
        workspaceId: workspace.id,
        packageId: pkg.id,
        storageKey: `workspaces/${workspace.id}/source_pdfs/daikin.pdf`,
        originalFilename: 'daikin.pdf',
        byteSize: pdfBytes.byteLength,
        sha256: 'deadbeef',
        pageCount: 3,
        processingStatus: 'extracted',
        itemId: item!.id,
      })
      .returning();

    const exportKey = `workspaces/${workspace.id}/exports/${item!.id}.pdf`;
    const [exportRow] = await db
      .insert(schema.exports)
      .values({
        packageId: pkg.id,
        createdByUserId: creator.id,
        storageKey: exportKey,
        batesPrefix: 'SUB-',
        status: 'pending',
      })
      .returning();

    const storage = new FakeStorage();
    storage.objects.set(sourcePdf!.storageKey, pdfBytes);

    await runRenderExportJob(
      { db, storage },
      { workspaceId: workspace.id, packageId: pkg.id, exportId: exportRow!.id },
    );

    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.key).toBe(exportKey);
    expect(storage.puts[0]!.contentType).toBe('application/pdf');

    const reopened = await PDFDocument.load(storage.puts[0]!.body);
    // 1 cover + 1 toc + 3 source pages
    expect(reopened.getPageCount()).toBe(5);

    const [updatedExport] = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, exportRow!.id))
      .limit(1);
    expect(updatedExport!.status).toBe('ready');
    expect(updatedExport!.pageCount).toBe(5);
    expect(updatedExport!.byteSize).toBe(storage.puts[0]!.body.byteLength);
    expect(updatedExport!.error).toBeNull();

    const [updatedPkg] = await db
      .select({ status: schema.packages.status, latestExportId: schema.packages.latestExportId })
      .from(schema.packages)
      .where(eq(schema.packages.id, pkg.id))
      .limit(1);
    expect(updatedPkg!.status).toBe('exported');
    expect(updatedPkg!.latestExportId).toBe(exportRow!.id);

    const [job] = await db
      .select({ status: schema.processingJobs.status })
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.packageId, pkg.id))
      .limit(1);
    expect(job!.status).toBe('succeeded');
  });

  it('passes each item\'s extracted attributes to the assembler for the TOC', async () => {
    const { workspace, creator, pkg } = await seedReadyPackage('attrs');
    workspaceIds.push(workspace.id);

    const [item] = await db
      .insert(schema.items)
      .values({
        workspaceId: workspace.id,
        packageId: pkg.id,
        docType: 'product_data',
        title: 'Rigid Conduit',
        sortOrder: 0,
      })
      .returning();
    await db.insert(schema.itemAttributes).values([
      { itemId: item!.id, key: 'description', currentValue: 'Rigid galvanized steel conduit, 3/4 in.' },
      { itemId: item!.id, key: 'model_number', currentValue: 'RGS-075' },
      { itemId: item!.id, key: 'manufacturer', currentValue: 'Allied Tube' },
    ]);

    const pdfBytes = await makeFixturePdf(2);
    const [sourcePdf] = await db
      .insert(schema.sourcePdfs)
      .values({
        workspaceId: workspace.id,
        packageId: pkg.id,
        storageKey: `workspaces/${workspace.id}/source_pdfs/conduit.pdf`,
        originalFilename: 'conduit.pdf',
        byteSize: pdfBytes.byteLength,
        sha256: 'feedface',
        pageCount: 2,
        processingStatus: 'extracted',
        itemId: item!.id,
      })
      .returning();

    const [exportRow] = await db
      .insert(schema.exports)
      .values({
        packageId: pkg.id,
        createdByUserId: creator.id,
        storageKey: `workspaces/${workspace.id}/exports/${item!.id}.pdf`,
        status: 'pending',
      })
      .returning();

    const storage = new FakeStorage();
    storage.objects.set(sourcePdf!.storageKey, pdfBytes);

    const captured: { sources: { title: string; description?: string | null; partNumber?: string | null; manufacturer?: string | null; itemId?: string }[] }[] = [];
    const fakeAssemble = async (input: { sources: typeof captured[number]['sources'] }) => {
      captured.push({ sources: input.sources });
      return {
        bytes: new Uint8Array([1, 2, 3]),
        pageCount: 4,
        bookmarks: [],
        batesRange: { first: '', last: '' },
        repairedSourceIndices: [],
      };
    };

    await runRenderExportJob(
      { db, storage, assemble: fakeAssemble as never },
      { workspaceId: workspace.id, packageId: pkg.id, exportId: exportRow!.id },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sources).toHaveLength(1);
    const source = captured[0]!.sources[0]!;
    expect(source.itemId).toBe(item!.id);
    expect(source.description).toBe('Rigid galvanized steel conduit, 3/4 in.');
    expect(source.partNumber).toBe('RGS-075');
    expect(source.manufacturer).toBe('Allied Tube');
  });

  it('marks the export failed and leaves the package status alone when assembly fails', async () => {
    const { workspace, creator, pkg } = await seedReadyPackage('fail');
    workspaceIds.push(workspace.id);

    const [exportRow] = await db
      .insert(schema.exports)
      .values({
        packageId: pkg.id,
        createdByUserId: creator.id,
        storageKey: `workspaces/${workspace.id}/exports/empty.pdf`,
        status: 'pending',
      })
      .returning();

    const storage = new FakeStorage();

    await expect(
      runRenderExportJob(
        { db, storage },
        { workspaceId: workspace.id, packageId: pkg.id, exportId: exportRow!.id },
      ),
    ).rejects.toThrow(/no items/);

    const [updatedExport] = await db
      .select({ status: schema.exports.status, error: schema.exports.error })
      .from(schema.exports)
      .where(eq(schema.exports.id, exportRow!.id))
      .limit(1);
    expect(updatedExport!.status).toBe('failed');
    expect(updatedExport!.error).toMatch(/no items/);

    const [updatedPkg] = await db
      .select({ status: schema.packages.status })
      .from(schema.packages)
      .where(eq(schema.packages.id, pkg.id))
      .limit(1);
    expect(updatedPkg!.status).toBe('ready');
  });
});
