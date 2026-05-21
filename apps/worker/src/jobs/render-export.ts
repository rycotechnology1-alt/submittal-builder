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

    // Order sources by item.sort_order, then by source-pdf created_at for
    // deterministic merging when an item has multiple PDFs.
    const orderedSources: AssembleSourcePdf[] = [];
    for (const item of items) {
      const list = (sourcePdfsByItem.get(item.id) ?? []).slice().sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      for (let i = 0; i < list.length; i++) {
        const pdf = list[i]!;
        const bytes = await deps.storage.getObjectBytes(pdf.storageKey);
        orderedSources.push({
          bytes,
          title: list.length === 1 ? item.title : `${item.title} (${i + 1}/${list.length})`,
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
