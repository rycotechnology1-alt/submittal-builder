import { and, eq, isNull } from 'drizzle-orm';

import type { Package, Project, Workspace, Item, ItemAttribute, SourcePdf } from '@submittal/db';
import { db, schema } from '@/server/db';
import { iso, jsonError } from '@/server/api';

export function workspaceJson(row: Workspace) {
  return {
    id: row.id,
    name: row.name,
    sub_company_name: row.subCompanyName,
    sub_company_logo_url: null,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

export function projectJson(row: Project) {
  return {
    id: row.id,
    name: row.name,
    project_number: row.projectNumber,
    gc_name: row.gcName,
    architect_name: row.architectName,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

export function projectPackageSummaryJson(row: Package) {
  return {
    id: row.id,
    submittal_number: row.submittalNumber,
    revision: row.revision,
    status: row.status,
    updated_at: iso(row.updatedAt),
  };
}

export function packageJson(row: Package) {
  return {
    id: row.id,
    project_id: row.projectId,
    submittal_number: row.submittalNumber,
    spec_section: row.specSection,
    revision: row.revision,
    submittal_date: row.submittalDate,
    title: row.title,
    status: row.status,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

export function itemJson(row: Item) {
  return {
    id: row.id,
    package_id: row.packageId,
    doc_type: row.docType,
    doc_type_confidence: row.docTypeConfidence,
    doc_type_original_ai_value: row.docTypeOriginalAiValue,
    sort_order: row.sortOrder,
    title: row.title,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

export function itemAttributeJson(row: ItemAttribute) {
  return {
    key: row.key,
    current_value: row.currentValue,
    original_ai_value: row.originalAiValue,
    confidence: row.confidence,
    source_page_id: row.sourcePageId,
    edited_by_user_at: iso(row.editedByUserAt),
  };
}

export function itemSourcePdfJson(row: SourcePdf) {
  return {
    id: row.id,
    original_filename: row.originalFilename,
    page_count: row.pageCount,
  };
}

export async function findLiveProject(workspaceId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.workspaceId, workspaceId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}

export async function findLivePackage(workspaceId: string, packageId: string) {
  const [pkg] = await db
    .select()
    .from(schema.packages)
    .where(
      and(
        eq(schema.packages.id, packageId),
        eq(schema.packages.workspaceId, workspaceId),
        isNull(schema.packages.deletedAt),
      ),
    )
    .limit(1);
  if (!pkg) return null;
  const parent = await findLiveProject(workspaceId, pkg.projectId);
  return parent ? pkg : null;
}

export async function findLiveItem(workspaceId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(schema.items)
    .where(
      and(
        eq(schema.items.id, itemId),
        eq(schema.items.workspaceId, workspaceId),
        isNull(schema.items.deletedAt),
      ),
    )
    .limit(1);
  if (!item) return null;
  const pkg = await findLivePackage(workspaceId, item.packageId);
  return pkg ? item : null;
}

export function notFound() {
  return jsonError(404, 'not_found', 'Not found');
}
