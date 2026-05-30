import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { Db } from '@submittal/db';
import { schema } from '@submittal/db';
import type { AppStorage } from '@submittal/shared/storage';
import {
  assembleSubmittalPdf,
  type AssembleSourcePdf,
  type CoverMetadata,
  repairPdfWithQpdf,
  QpdfNotInstalledError,
} from '@submittal/shared/pdf';

import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  type RenderExportJobData,
} from './common.js';

type RenderExportDeps = {
  db: Db;
  storage: AppStorage;
  /** Allow tests to inject a custom assembler. */
  assemble?: typeof assembleSubmittalPdf;
  /** Allow tests to override the repair pass. */
  repair?: typeof repairPdfWithQpdf;
  /** Hook for structured logging. */
  log?: (event: Record<string, unknown>) => void;
};

function logoContentType(key: string): 'image/png' | 'image/jpeg' | null {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

export async function runRenderExportJob(deps: RenderExportDeps, data: RenderExportJobData) {
  const log = deps.log ?? ((event) => console.log({ level: 'info', component: 'render_export', ...event }));
  const assemble = deps.assemble ?? assembleSubmittalPdf;
  const repair = deps.repair ?? repairPdfWithQpdf;

  // Flip export to 'rendering' before marking the processing-job row so a
  // crash between the two leaves a recoverable state.
  await deps.db
    .update(schema.exports)
    .set({ status: 'rendering', error: null, updatedAt: new Date() })
    .where(eq(schema.exports.id, data.exportId));

  await markJobRunning(deps.db, data, 'render_export');

  try {
    const [exportRow] = await deps.db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, data.exportId))
      .limit(1);
    if (!exportRow) throw new Error(`export row not found: ${data.exportId}`);

    const [pkg] = await deps.db
      .select()
      .from(schema.packages)
      .where(
        and(
          eq(schema.packages.id, data.packageId),
          eq(schema.packages.workspaceId, data.workspaceId),
        ),
      )
      .limit(1);
    if (!pkg) throw new Error(`package not found: ${data.packageId}`);

    const [project] = await deps.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, pkg.projectId))
      .limit(1);
    if (!project) throw new Error(`project not found: ${pkg.projectId}`);

    const [workspace] = await deps.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, data.workspaceId))
      .limit(1);
    if (!workspace) throw new Error(`workspace not found: ${data.workspaceId}`);

    const items = await deps.db
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.workspaceId, data.workspaceId),
          eq(schema.items.packageId, data.packageId),
          isNull(schema.items.deletedAt),
        ),
      )
      .orderBy(asc(schema.items.sortOrder), asc(schema.items.createdAt));

    if (items.length === 0) {
      throw new Error('package has no items to export');
    }

    const itemIds = items.map((item) => item.id);
    const sourcePdfs = await deps.db
      .select()
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.workspaceId, data.workspaceId),
          eq(schema.sourcePdfs.packageId, data.packageId),
          inArray(schema.sourcePdfs.itemId, itemIds),
        ),
      );

    const sourcePdfsByItem = new Map<string, typeof sourcePdfs>();
    for (const pdf of sourcePdfs) {
      const list = sourcePdfsByItem.get(pdf.itemId!) ?? [];
      list.push(pdf);
      sourcePdfsByItem.set(pdf.itemId!, list);
    }

    // Pull the AI-extracted attributes used in the TOC table. Prefer the
    // current (possibly user-edited) value over the original AI value.
    const attributeRows = await deps.db
      .select({
        itemId: schema.itemAttributes.itemId,
        key: schema.itemAttributes.key,
        currentValue: schema.itemAttributes.currentValue,
      })
      .from(schema.itemAttributes)
      .where(inArray(schema.itemAttributes.itemId, itemIds));

    const attributesByItem = new Map<
      string,
      { description: string | null; partNumber: string | null; manufacturer: string | null }
    >();
    for (const row of attributeRows) {
      const entry =
        attributesByItem.get(row.itemId) ??
        { description: null, partNumber: null, manufacturer: null };
      if (row.key === 'description') entry.description = row.currentValue;
      else if (row.key === 'model_number') entry.partNumber = row.currentValue;
      else if (row.key === 'manufacturer') entry.manufacturer = row.currentValue;
      attributesByItem.set(row.itemId, entry);
    }

    // Selected size variants: drive the on-page callouts and override the TOC
    // "Part #" cell with the actual submitted part numbers.
    const variantRows = await deps.db
      .select()
      .from(schema.itemVariants)
      .where(inArray(schema.itemVariants.itemId, itemIds))
      .orderBy(asc(schema.itemVariants.sortOrder));
    const selectedVariants = variantRows.filter((v) => v.selectedAt !== null);

    const sourcePageIds = selectedVariants
      .map((v) => v.sourcePageId)
      .filter((id): id is string => id !== null);
    const sourcePageById = new Map<string, { sourcePdfId: string; pageNumber: number }>();
    if (sourcePageIds.length > 0) {
      const pages = await deps.db
        .select({
          id: schema.sourcePages.id,
          sourcePdfId: schema.sourcePages.sourcePdfId,
          pageNumber: schema.sourcePages.pageNumber,
        })
        .from(schema.sourcePages)
        .where(inArray(schema.sourcePages.id, sourcePageIds));
      for (const page of pages) {
        sourcePageById.set(page.id, { sourcePdfId: page.sourcePdfId, pageNumber: page.pageNumber });
      }
    }

    // Selected part numbers per item (for the TOC cell), in sort order.
    const selectedPartNumbersByItem = new Map<string, string[]>();
    // Callouts keyed by the source PDF whose page carries the part number.
    const calloutsBySourcePdf = new Map<
      string,
      { partNumber: string; label: string; sourcePage: number }[]
    >();
    for (const variant of selectedVariants) {
      const partList = selectedPartNumbersByItem.get(variant.itemId) ?? [];
      partList.push(variant.partNumber);
      selectedPartNumbersByItem.set(variant.itemId, partList);

      const page = variant.sourcePageId ? sourcePageById.get(variant.sourcePageId) : undefined;
      // Without a resolved source page, stamp page 1 of the item's first source.
      const targetPdfId = page?.sourcePdfId ?? sourcePdfsByItem.get(variant.itemId)?.[0]?.id;
      if (!targetPdfId) continue;
      const list = calloutsBySourcePdf.get(targetPdfId) ?? [];
      list.push({
        partNumber: variant.partNumber,
        label: variant.displayLabel,
        sourcePage: page?.pageNumber ?? 1,
      });
      calloutsBySourcePdf.set(targetPdfId, list);
    }

    // Order sources by item.sort_order, then by source-pdf created_at for
    // deterministic merging when an item has multiple PDFs.
    const orderedSources: AssembleSourcePdf[] = [];
    for (const item of items) {
      const attrs = attributesByItem.get(item.id);
      const selectedParts = selectedPartNumbersByItem.get(item.id);
      // When the user picked size(s), the submitted part numbers replace the
      // full model-number string in the TOC.
      const tocPartNumber =
        selectedParts && selectedParts.length > 0
          ? selectedParts.join(', ')
          : attrs?.partNumber ?? null;
      const list = (sourcePdfsByItem.get(item.id) ?? []).slice().sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      for (let i = 0; i < list.length; i++) {
        const pdf = list[i]!;
        const bytes = await deps.storage.getObjectBytes(pdf.storageKey);
        orderedSources.push({
          bytes,
          title: list.length === 1 ? item.title : `${item.title} (${i + 1}/${list.length})`,
          itemId: item.id,
          description: attrs?.description ?? null,
          partNumber: tocPartNumber,
          manufacturer: attrs?.manufacturer ?? null,
          selectedVariants: calloutsBySourcePdf.get(pdf.id),
          repair: async (input) => {
            try {
              const repaired = await repair(input);
              log({
                msg: 'pdf_repair_used',
                source_pdf_id: pdf.id,
                package_id: data.packageId,
                export_id: data.exportId,
              });
              return repaired;
            } catch (err) {
              if (err instanceof QpdfNotInstalledError) {
                log({
                  level: 'warn',
                  msg: 'pdf_repair_unavailable',
                  source_pdf_id: pdf.id,
                  error: err.message,
                });
              }
              throw err;
            }
          },
        });
      }
    }

    let logoBytes: Uint8Array | null = null;
    let logoMime: 'image/png' | 'image/jpeg' | null = null;
    if (workspace.subCompanyLogoStorageKey) {
      logoMime = logoContentType(workspace.subCompanyLogoStorageKey);
      if (logoMime) {
        try {
          logoBytes = await deps.storage.getObjectBytes(workspace.subCompanyLogoStorageKey);
        } catch (err) {
          log({ level: 'warn', msg: 'logo_fetch_failed', error: String(err) });
          logoBytes = null;
        }
      }
    }

    const cover: CoverMetadata = {
      workspaceName: workspace.name,
      subCompanyName: workspace.subCompanyName,
      projectName: project.name,
      submittalNumber: pkg.submittalNumber,
      specSection: pkg.specSection,
      revision: pkg.revision,
      packageTitle: pkg.title,
      logoBytes,
      logoContentType: logoMime,
      addressStreet: workspace.addressStreet,
      addressCity: workspace.addressCity,
      addressState: workspace.addressState,
      addressZip: workspace.addressZip,
      contactPhone: workspace.contactPhone,
      contactEmail: workspace.contactEmail,
      contactWebsite: workspace.contactWebsite,
    };

    const result = await assemble({
      cover,
      sources: orderedSources,
      batesPrefix: exportRow.batesPrefix ?? '',
    });

    await deps.storage.putObject({
      key: exportRow.storageKey,
      body: result.bytes,
      contentType: 'application/pdf',
    });

    await deps.db
      .update(schema.exports)
      .set({
        status: 'ready',
        byteSize: result.bytes.byteLength,
        pageCount: result.pageCount,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.exports.id, exportRow.id));

    await deps.db
      .update(schema.packages)
      .set({
        status: 'exported',
        latestExportId: exportRow.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.packages.id, pkg.id));

    await markJobSucceeded(deps.db, data, 'render_export');

    log({
      msg: 'render_export_succeeded',
      export_id: exportRow.id,
      package_id: pkg.id,
      page_count: result.pageCount,
      byte_size: result.bytes.byteLength,
      repaired_source_indices: result.repairedSourceIndices,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db
      .update(schema.exports)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(eq(schema.exports.id, data.exportId));
    await markJobFailed(deps.db, data, 'render_export', error);
    log({ level: 'error', msg: 'render_export_failed', export_id: data.exportId, error: message });
    throw error;
  }
}
