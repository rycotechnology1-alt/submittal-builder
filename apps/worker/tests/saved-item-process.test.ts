import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });
process.env.DATABASE_URL ??= process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;

const { getDb, schema } = await import('@submittal/db');
const { runSavedItemProcessJob } = await import('../src/jobs/saved-item-process.js');

const db = getDb({ url: process.env.DATABASE_URL, max: 1 });

const field = (value: string | null, source_page = 1) => ({
  value,
  confidence: 0.9,
  source_page,
});

async function seedSavedItem(label: string) {
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ name: `Saved Worker ${label}`, subCompanyName: `Saved Worker ${label} Sub` })
    .returning();
  const [file] = await db
    .insert(schema.savedItemFiles)
    .values({
      workspaceId: workspace!.id,
      storageKey: `workspaces/${workspace!.id}/saved_item_files/${label}.pdf`,
      originalFilename: `${label}.pdf`,
      byteSize: 8,
      sha256: `sha-${label}`,
      pageCount: 1,
      processingStatus: 'uploaded',
    })
    .returning();
  const [item] = await db
    .insert(schema.savedItems)
    .values({
      workspaceId: workspace!.id,
      savedItemFileId: file!.id,
      title: `${label}.pdf`,
      docType: 'other',
    })
    .returning();
  const [page] = await db
    .insert(schema.savedItemSourcePages)
    .values({
      savedItemFileId: file!.id,
      pageNumber: 1,
      ocrText: null,
      hasOcr: false,
    })
    .returning();

  return { workspace: workspace!, file: file!, item: item!, page: page! };
}

describe('saved item process job', () => {
  const workspaceIds: string[] = [];

  afterEach(async () => {
    while (workspaceIds.length > 0) {
      const id = workspaceIds.pop();
      if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
  });

  it('classifies and extracts directly into saved tables without package rows', async () => {
    const { workspace, file, item, page } = await seedSavedItem('direct');
    workspaceIds.push(workspace.id);
    const putKeys: string[] = [];

    await runSavedItemProcessJob(
      {
        db,
        bucket: 'test-bucket',
        storage: {
          getObjectBytes: async () => new Uint8Array([1, 2, 3, 4]),
          putObject: async (input: { key: string }) => {
            putKeys.push(input.key);
          },
        },
        ocr: {
          detectPdfText: async () => ({
            pages: [{ pageNumber: 1, text: 'CANTEX PV100 1 in conduit' }],
            raw: { ok: true },
          }),
        },
        renderPageImages: async () => [new Uint8Array([9])],
        reconcilePartNumbers: async (_bytes, targets) =>
          targets.map((target) => ({
            status: 'found',
            partNumber: target.partNumber,
            corrected: false,
          })),
        ai: {
          classifyDocument: async () => ({ doc_type: 'product_data', confidence: 0.96 }),
          extractAttributes: async () => ({
            manufacturer: field('CANTEX'),
            model_number: field('PV100'),
            description: field('PVC conduit'),
            spec_section_ref: field(null),
            variants: [{ part_number: 'PV100', size: '1 in', source_page: 1 }],
          }),
        },
      },
      { workspaceId: workspace.id, savedItemId: item.id },
    );

    const [updatedFile] = await db
      .select()
      .from(schema.savedItemFiles)
      .where(eq(schema.savedItemFiles.id, file.id));
    expect(updatedFile?.processingStatus).toBe('extracted');
    expect(updatedFile?.processingError).toBeNull();

    const [updatedItem] = await db
      .select()
      .from(schema.savedItems)
      .where(eq(schema.savedItems.id, item.id));
    expect(updatedItem).toMatchObject({
      docType: 'product_data',
      docTypeConfidence: 0.96,
      docTypeOriginalAiValue: 'product_data',
    });

    const [updatedPage] = await db
      .select()
      .from(schema.savedItemSourcePages)
      .where(eq(schema.savedItemSourcePages.id, page.id));
    expect(updatedPage?.hasOcr).toBe(true);
    expect(updatedPage?.ocrText).toContain('CANTEX');
    expect(putKeys).toEqual([
      `workspaces/${workspace.id}/textract_raw/saved_items/${file.id}.json`,
    ]);

    const attrs = await db
      .select()
      .from(schema.savedItemAttributes)
      .where(eq(schema.savedItemAttributes.savedItemId, item.id));
    expect(attrs.map((attr) => attr.key).sort()).toEqual([
      'description',
      'manufacturer',
      'model_number',
      'spec_section_ref',
    ]);

    const variants = await db
      .select()
      .from(schema.savedItemVariants)
      .where(eq(schema.savedItemVariants.savedItemId, item.id));
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      partNumber: 'PV100',
      size: '1 in',
      savedItemSourcePageId: page.id,
      partNumberVerification: 'found',
    });

    const sourcePdfs = await db
      .select()
      .from(schema.sourcePdfs)
      .where(eq(schema.sourcePdfs.workspaceId, workspace.id));
    expect(sourcePdfs).toHaveLength(0);
  });
});
