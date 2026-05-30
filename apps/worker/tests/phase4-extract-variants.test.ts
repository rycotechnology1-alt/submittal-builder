import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });
process.env.DATABASE_URL ??= process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;

const { getDb, schema } = await import('@submittal/db');
const { runExtractJob } = await import('../src/jobs/extract.js');

const db = getDb({ url: process.env.DATABASE_URL, max: 1 });

const field = (value: string | null, source_page = 1) => ({ value, confidence: 0.9, source_page });

async function seedClassifiedSource(label: string) {
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ name: `Extract ${label} WS`, subCompanyName: `Extract ${label} Sub` })
    .returning();
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: workspace!.id, name: `Extract ${label} Project` })
    .returning();
  const [pkg] = await db
    .insert(schema.packages)
    .values({
      workspaceId: workspace!.id,
      projectId: project!.id,
      submittalNumber: '26 05 00',
      specSection: '26 05 00',
      title: `Extract ${label}`,
      status: 'processing',
    })
    .returning();
  const [item] = await db
    .insert(schema.items)
    .values({ workspaceId: workspace!.id, packageId: pkg!.id, docType: 'product_data', title: 'Conduit' })
    .returning();
  const [sourcePdf] = await db
    .insert(schema.sourcePdfs)
    .values({
      workspaceId: workspace!.id,
      packageId: pkg!.id,
      storageKey: `workspaces/${workspace!.id}/source_pdfs/${label}.pdf`,
      originalFilename: `${label}.pdf`,
      byteSize: 100,
      sha256: `sha-${label}`,
      pageCount: 1,
      processingStatus: 'classifying',
      itemId: item!.id,
    })
    .returning();
  await db.insert(schema.sourcePages).values({ sourcePdfId: sourcePdf!.id, pageNumber: 1 });
  return { workspace: workspace!, pkg: pkg!, item: item!, sourcePdf: sourcePdf! };
}

function makeDeps(extractResult: unknown) {
  return {
    db,
    storage: { getObjectBytes: async () => new Uint8Array([1]) },
    ai: { extractAttributes: async () => extractResult },
    renderPageImages: async () => [new Uint8Array([1])],
    enqueue: async () => {},
  } as never;
}

describe('Phase 4 extract job — variants', () => {
  const workspaceIds: string[] = [];
  afterEach(async () => {
    while (workspaceIds.length > 0) {
      const id = workspaceIds.pop();
      if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
  });

  it('persists extracted variants with a smart default per size and a page link', async () => {
    const { workspace, pkg, item, sourcePdf } = await seedClassifiedSource('vars');
    workspaceIds.push(workspace.id);

    await runExtractJob(
      makeDeps({
        manufacturer: field('CANTEX'),
        model_number: field('Enviro-Flex (V06BAA1, V06AEJ1)'),
        description: field('Liquidtight flexible conduit.'),
        spec_section_ref: field(null),
        variants: [
          { part_number: 'V06BAA1', size: '1/2"', secondary_dims: { packaging: 'Coil' }, source_page: 1 },
          { part_number: 'V06AEJ1', size: '1/2"', secondary_dims: { packaging: 'Reel' }, source_page: 1 },
        ],
      }),
      { workspaceId: workspace.id, packageId: pkg.id, sourcePdfId: sourcePdf.id },
    );

    const variants = await db
      .select()
      .from(schema.itemVariants)
      .where(eq(schema.itemVariants.itemId, item.id))
      .orderBy(asc(schema.itemVariants.sortOrder));

    expect(variants.map((v) => v.partNumber)).toEqual(['V06BAA1', 'V06AEJ1']);
    expect(variants.map((v) => v.displayLabel)).toEqual(['1/2" – Coil', '1/2" – Reel']);
    // One default within the 1/2" group — the first-listed (Coil).
    expect(variants.filter((v) => v.isDefaultForSize).map((v) => v.partNumber)).toEqual(['V06BAA1']);
    // source_page 1 mapped to a real source_pages row.
    expect(variants.every((v) => v.sourcePageId !== null)).toBe(true);
  });

  it('replaces variants on re-extraction without leaving duplicates', async () => {
    const { workspace, pkg, item, sourcePdf } = await seedClassifiedSource('replace');
    workspaceIds.push(workspace.id);

    const data = { workspaceId: workspace.id, packageId: pkg.id, sourcePdfId: sourcePdf.id };
    const first = {
      manufacturer: field('CANTEX'),
      model_number: field('A'),
      description: field('d'),
      spec_section_ref: field(null),
      variants: [{ part_number: 'OLD1', size: '1"', source_page: 1 }],
    };
    await runExtractJob(makeDeps(first), data);

    const second = {
      ...first,
      variants: [
        { part_number: 'NEW1', size: '1"', source_page: 1 },
        { part_number: 'NEW2', size: '2"', source_page: 1 },
      ],
    };
    await runExtractJob(makeDeps(second), data);

    const variants = await db
      .select({ partNumber: schema.itemVariants.partNumber })
      .from(schema.itemVariants)
      .where(eq(schema.itemVariants.itemId, item.id));
    expect(variants.map((v) => v.partNumber).sort()).toEqual(['NEW1', 'NEW2']);
  });
});
