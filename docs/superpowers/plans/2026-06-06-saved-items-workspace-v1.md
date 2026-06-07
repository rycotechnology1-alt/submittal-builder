# Saved Items Workspace V1 Implementation Plan

> For agentic workers: implement task-by-task. Keep V1 scoped to the core saved/common item library. Do not add tags, categories, spec-section mapping, usage history, review status, archive, duplicate fuzzy matching, or bulk actions.

**Goal:** Build a workspace-level Saved Items area where construction managers can search, upload, edit, import-compatible saved/common submittal sheets, and delete library entries without damaging package-local snapshots.

**Current architecture findings:**
- Saved item tables already exist in `packages/db/src/schema.ts`: `saved_item_files`, `saved_items`, `saved_item_source_pages`, `saved_item_attributes`, `saved_item_variants`.
- Package import already copies the latest saved metadata/attributes/variants and writes imported package variants with `selectedAt: null` in `apps/web/src/server/saved-items.ts`.
- Existing package upload/process is package-owned end-to-end: `source_pdfs.package_id` is non-null, `processing_jobs.package_id` is non-null, and `runClassifyJob` creates package `items`.
- Direct library upload should therefore use a dedicated saved-library process path instead of hidden packages or package-owned `source_pdfs`.
- Saved item deletion needs special storage handling because imported package snapshots currently reuse the saved file's `storage_key`. Deleting the object while any package source still points at it would break old packages.

**Recommended direct-upload approach:** Add saved-library upload endpoints and a saved-item worker job that processes `saved_item_files`/`saved_item_source_pages` directly. Reuse shared PDF parsing, OCR, AI, variant derivation, and part-number reconciliation logic, but keep package-owned rows out of direct library upload.

---

## Data And API Shape

### New/changed shared schemas

Modify `packages/shared/src/api/saved-items.ts`.

- Extend summary responses for dashboard use:
  - `manufacturer` can remain derived client-side from attributes, but keep full attributes in the response.
  - Add `processing_status` and `processing_error` once DB columns are added.
  - Keep `variant_count`, `page_count`, `updated_at`, `original_filename`.
- Add `savedItemDetailResponseSchema`:
  - `saved_item`: summary/base row.
  - `file`: id, original filename, byte size, sha256, page count, processing status/error.
  - `source_pages`: id, page number, has OCR.
  - `attributes`: saved attributes using `saved_item_source_page_id`.
  - `variants`: saved variants using `saved_item_source_page_id`.
  - No `selected`, `selectedAt`, or submitted-size fields.
- Add mutation request schemas:
  - `updateSavedItemRequestSchema`: optional `title`, `doc_type`.
  - `updateSavedItemAttributeRequestSchema`: `{ value: string | null }`.
  - `savedItemVariantRequestSchema`: `part_number`, `size`, `secondary_dims`, `display_label`, `sort_order`, `is_default_for_size`, optional `saved_item_source_page_id`.
  - `savedItemUploadPresignRequestSchema`: filename, byte_size, content_type.
  - `savedItemUploadConfirmRequestSchema`: storage_key, original filename if not encoded elsewhere.
- Add upload response schemas:
  - Presign returns `{ upload_url, storage_key, expires_at, required_headers }`.
  - Confirm returns `{ saved_item, duplicate: boolean, processing_status }`.

### DB migration

Modify `packages/db/src/schema.ts` and generate a migration.

- Add processing fields to `saved_item_files`:
  - `processing_status pdf_processing_status not null default 'extracted'`
  - `processing_error text`
- Existing saved-common rows backfill to `extracted`.
- Consider an index on `(workspace_id, processing_status)` if dashboard filtering or polling needs it.
- Do not add selected/submitted state to `saved_item_variants`.

---

## Task 1: Backend Saved Item Read/Edit API

**Files:**
- Modify: `packages/shared/src/api/saved-items.ts`
- Modify: `apps/web/src/server/saved-items.ts`
- Create: `apps/web/src/app/api/v1/saved-items/[id]/route.ts`
- Create: `apps/web/src/app/api/v1/saved-items/[id]/attributes/[key]/route.ts`
- Create: `apps/web/src/app/api/v1/saved-items/[id]/variants/route.ts`
- Create: `apps/web/src/app/api/v1/saved-items/[id]/variants/[variantId]/route.ts`
- Test: `apps/web/tests/saved-items.integration.test.ts`

- [ ] Add `findSavedItemInWorkspace(workspaceId, savedItemId)` and return `404` for cross-workspace ids.
- [ ] Add `savedItemDetail(workspaceId, savedItemId)` that loads item, file, pages, attributes, variants ordered by `sort_order`.
- [ ] Add `PATCH /api/v1/saved-items/:id` for title/doc type.
- [ ] Add `PUT /api/v1/saved-items/:id/attributes/:key` mirroring item attribute editing. Set `edited_by_user_at` and never touch package items.
- [ ] Add variant create/update/delete endpoints.
- [ ] Variant create/update must validate ownership of any `saved_item_source_page_id`.
- [ ] Variant responses must omit selected/submitted state entirely.
- [ ] Updating saved rows must update `saved_items.updated_at` so dashboard sorting reflects edits.

**Tests:**
- [ ] Listing saved items includes dashboard summary fields.
- [ ] Loading detail returns file, pages, attributes, and variants.
- [ ] Editing title/doc type persists.
- [ ] Editing attributes persists and sets `edited_by_user_at`.
- [ ] Adding/editing/deleting variants persists.
- [ ] Saved variant API responses do not contain selected/submitted state.
- [ ] Cross-workspace detail/edit/variant mutations return `404`.

---

## Task 2: Delete Saved Items Safely

**Files:**
- Modify: `apps/web/src/server/saved-items.ts`
- Modify/Create: `apps/web/src/app/api/v1/saved-items/[id]/route.ts`
- Test: `apps/web/tests/saved-items.integration.test.ts`

Deletion rule:
- Delete `saved_items` and its attributes/variants.
- If no package `source_pdfs` rows reference the `saved_item_file_id`, delete saved source pages, delete `saved_item_files`, and best-effort delete the storage object.
- If any package `source_pdfs` rows reference the file, keep `saved_item_files` and `saved_item_source_pages` as backing data, and do not delete the storage object. The item disappears from the library because `saved_items` is gone, but imported package snapshots retain `saved_item_file_id` and remain safe.

Implementation details:
- [ ] Add `DELETE /api/v1/saved-items/:id`.
- [ ] Load saved item with workspace filter first; cross-workspace returns `404`.
- [ ] Count referencing `source_pdfs` by `saved_item_file_id` before deletion.
- [ ] In a transaction, delete `saved_items`; if no references, also delete the file row.
- [ ] After the transaction, delete the storage object only if the file row was deleted.
- [ ] Update package delete/item delete behavior only if tests reveal retained saved-file rows need special treatment. Do not make saved-backed package source deletion delete shared storage.
- [ ] Update duplicate save/upload logic to handle a retained `saved_item_files` row without a `saved_items` row by recreating a saved item instead of returning an unusable duplicate id.

**Tests:**
- [ ] Deleting a saved item with no imported snapshots deletes saved rows and storage.
- [ ] Deleting a saved item with existing imported package snapshots removes it from the library but keeps package source rows, package attributes/variants, saved backing file row, and storage object.
- [ ] Deleting an imported package after the library item is deleted still does not delete storage if other imported snapshots depend on it.
- [ ] Cross-workspace delete returns `404`.

---

## Task 3: Direct Upload To Library

**Files:**
- Modify: `apps/web/src/server/file-records.ts`
- Modify: `apps/web/src/server/saved-items.ts`
- Create: `apps/web/src/app/api/v1/saved-items/uploads/presign/route.ts`
- Create: `apps/web/src/app/api/v1/saved-items/uploads/confirm/route.ts`
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/jobs/saved-item-process.ts`
- Refactor as needed: `apps/worker/src/jobs/classify.ts`, `apps/worker/src/jobs/extract.ts`, `apps/worker/src/jobs/ocr.ts`
- Test: `apps/web/tests/saved-items.integration.test.ts`
- Test: `apps/worker/tests/saved-item-process.test.ts`

Storage:
- [ ] Add `savedItemFileStorageKey(workspaceId, savedItemFileId)` returning `workspaces/{workspaceId}/saved_item_files/{savedItemFileId}.pdf`.
- [ ] Presign route generates a UUID/file id, presigns PUT to that key, and does not insert DB rows yet because sha256 is not known.
- [ ] Confirm route checks object exists, reads bytes, computes sha256, and parses pages.

Dedupe:
- [ ] On confirm, search `saved_item_files` by `(workspace_id, sha256)`.
- [ ] If a saved item already exists for that file, best-effort delete the newly uploaded duplicate object and return the existing saved item with `duplicate: true`.
- [ ] If a file row exists but no saved item exists, reuse that file row and recreate/process the saved item.
- [ ] If no file exists, insert `saved_item_files` with `processing_status='uploaded'`, insert `saved_item_source_pages`, and insert a `saved_items` placeholder titled from the original filename with doc type `other`.
- [ ] Enqueue `saved_item_process` for the saved item.

Worker:
- [ ] Add a `saved_item_process` queue in `apps/worker/src/index.ts`.
- [ ] Job data: `{ workspaceId, savedItemId, requestId? }`.
- [ ] Load saved item/file by workspace and saved item id.
- [ ] If any saved source page has `has_ocr=false`, run Textract against `saved_item_files.storage_key`, update saved pages, and write raw Textract JSON under a saved-item-specific key.
- [ ] Render page images from the saved file bytes.
- [ ] Classify and update `saved_items.doc_type`, `doc_type_confidence`, `doc_type_original_ai_value`.
- [ ] Extract attributes and variants into saved tables.
- [ ] Use `deriveVariantRows` and `reconcilePartNumbers` exactly as package extraction does.
- [ ] Set `saved_item_files.processing_status` through `ocr_running`, `classifying`, `extracting`, `extracted`, or `error`.
- [ ] Do not create `packages`, `source_pdfs`, `items`, or `processing_jobs` rows for direct library uploads.

**Tests:**
- [ ] Direct upload creates saved file/item/pages/attributes/variants.
- [ ] Direct upload exact duplicate returns duplicate and does not create another blob or saved item.
- [ ] Direct upload reuses retained file rows correctly.
- [ ] Direct upload worker failure sets saved file status `error`.
- [ ] Existing package upload/process tests still pass.

---

## Task 4: Import Compatibility After Edits

**Files:**
- Modify: `apps/web/src/server/saved-items.ts`
- Test: `apps/web/tests/saved-items.integration.test.ts`

- [ ] Ensure `importSavedItems` rejects saved items whose file `processing_status` is not `extracted`.
- [ ] Ensure import uses the latest edited saved title/doc type/attributes/variants.
- [ ] Ensure imported package variants still write `selectedAt: null`.
- [ ] Ensure existing imported package-local snapshots do not change when the library item is edited later.
- [ ] Keep duplicate-in-package SHA behavior unchanged.

**Tests:**
- [ ] Importing after editing uses latest saved snapshot.
- [ ] Previously imported package rows do not change retroactively after saved item edit.
- [ ] Importing a processing/error saved item returns `409` with a clear error.
- [ ] Existing package-owned delete behavior remains unchanged.
- [ ] Existing saved-backed package delete behavior remains unchanged.

---

## Task 5: Saved Items Dashboard UI

**Files:**
- Modify: `apps/web/src/app/(dashboard)/_components/header.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/page.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/_components/saved-items-upload.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/_components/saved-items-list.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/_components/delete-saved-item-dialog.tsx`

Dashboard behavior:
- [ ] Add a top nav link to `/saved-items`.
- [ ] Fetch `GET /api/v1/saved-items?q=`.
- [ ] Search title, filename, doc type, and common attributes via the existing backend search.
- [ ] Show title, manufacturer, model/part/series, doc type, original filename, page count, variant count, last updated, and processing/error state.
- [ ] Provide row actions: view/edit and delete.
- [ ] Provide direct PDF upload/drop area.
- [ ] Upload component uses presign -> PUT -> confirm for one or more PDFs.
- [ ] Duplicate upload shows a clear toast/message and links/focuses the existing item.
- [ ] Invalidate `['saved-items']` after upload, edit, or delete.

Design notes:
- Keep the surface operational and dense, similar to the Projects page.
- Use icons from `lucide-react` for upload, search, edit, delete, file, and loading states.
- Avoid card-heavy marketing layout; this is a workspace table/list.

---

## Task 6: Saved Item Detail/Edit UI

**Files:**
- Create: `apps/web/src/app/(dashboard)/saved-items/[id]/page.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/[id]/_components/saved-item-editor.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/[id]/_components/saved-attributes-editor.tsx`
- Create: `apps/web/src/app/(dashboard)/saved-items/[id]/_components/saved-variants-editor.tsx`

Detail behavior:
- [ ] Load `GET /api/v1/saved-items/:id`.
- [ ] Edit title and doc type.
- [ ] Edit common attributes.
- [ ] Edit variants inline or in a compact dialog.
- [ ] Add/delete variants.
- [ ] Expose sort order if shown in package variant workflow; otherwise keep it as an advanced numeric field in the variant editor.
- [ ] Do not show selected/submitted size state.
- [ ] Show original filename, page count, sha256, and processing status as read-only file metadata.
- [ ] Disable editing while direct-upload processing is active unless the mutation endpoint safely allows it.

---

## Task 7: Verification

Run focused checks after implementation:

- [ ] `pnpm --filter @submittal/shared run typecheck`
- [ ] `pnpm --filter @submittal/db run typecheck`
- [ ] `pnpm --filter @submittal/web run test -- saved-items.integration`
- [ ] `pnpm --filter @submittal/worker run test -- saved-item-process`
- [ ] `pnpm --filter @submittal/web run test -- saved-items-ui`
- [ ] `pnpm --filter @submittal/web run typecheck`
- [ ] `pnpm typecheck`
- [ ] Run the app and manually verify:
  - `/saved-items` dashboard loads.
  - Upload one new PDF and watch it become available.
  - Upload the same PDF again and see the duplicate message.
  - Edit attributes/variants, import into a package, and confirm latest values copy in.
  - Select package sizes after import and confirm the saved library item still has no selected/submitted state.
  - Delete a saved item with an existing imported package snapshot and confirm the package still exports/downloads.

---

## Out Of Scope For V1

- Tags/categories.
- Spec-section mapping.
- Fuzzy duplicate matching.
- Usage history.
- Review/approval status.
- Archive.
- Bulk actions.
- Package-specific selected sizes in saved item data.
- Retroactive updates to existing package-local snapshots.
