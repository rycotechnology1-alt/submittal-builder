# UI Phase 8 Handoff — "+ Add item" wired to upload + AI classify

You are picking up after Phase 8 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md). Phase 7 UI context is in
[ui-phase-7-handoff.md](ui-phase-7-handoff.md). UI work is tracked as
numbered UI phases.

## What I built

**Reframed the slice.** Phase 7's handoff flagged "manual item creation" as
the next slice. The user redirected: manual entry defeats the product's
purpose — the tool exists to classify automatically. Phase 8 ships the actual
vision: **pick a PDF → tool ingests, classifies, creates the item**. Crucially,
this required **zero backend changes** — every endpoint in the loop already
existed.

**Screen — Package editor `+ Add item`** ([packages/[id]](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx)):
the disabled affordance from Phase 7 is now a single-file PDF picker that
drives the upload → ingest → classify → extract pipeline.

New files under
[apps/web/src/app/(dashboard)/packages/[id]/_components/editor/](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/):

- `add-item-button.tsx` — client component. Hidden `<input type="file"
  accept="application/pdf,.pdf">` triggered by the visible button. Local
  `stage` state cycles `idle → presigning → uploading → confirming →
  requesting-process`, reflected in the button label
  ("Preparing…", "Uploading 73%", "Saving…", "Processing…"). On success
  invalidates `['package', packageId]` and `['package-status', packageId]`;
  the page then re-renders into the existing `<UploadProcessingPanel />`
  (because `pkg.status` flipped to `'processing'`) and the existing polling
  + invalidation infrastructure takes over. Two variants: outline `+ Add
  item` (toolbar) and primary `+ Add PDF` (empty-state CTA).
- `add-item-helpers.ts` — pure helpers, mirroring Phase 7's
  `workspace-settings-helpers.ts` shape:
  - `ALLOWED_PDF_CONTENT_TYPES = ['application/pdf'] as const`.
  - `MAX_PDF_BYTES` (re-exported from
    [lib/upload.ts](apps/web/src/lib/upload.ts) `MAX_UPLOAD_FILE_BYTES` —
    50 MB; deliberately tied to the onboarding cap so they can't drift).
  - `isValidPdfContentType(type)`, `isPdfFilename(name)` (case-insensitive
    `.pdf` extension check, used as a fallback when the browser omits a
    content type), `isWithinPdfSizeLimit(bytes)`.
  - `validateAddItemFile(file)` — single entry point returning
    `AddItemRejection | null`, with discriminated `kind:
    'invalid_type' | 'empty_file' | 'too_large'`. The component surfaces
    `message` as a `sonner` toast.

**Wired into existing pages**:

- [package-editor.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx) —
  toolbar button `<Button variant="outline" size="sm" disabled
  title={futurePhase}>` replaced with `<AddItemButton
  packageId={packageId} />`. The local `futurePhase` constant was deleted
  (only used here). The `EmptyState` was rewritten: copy changed from "AI
  couldn't pull items from these PDFs. Manual item creation is coming in a
  later phase." to "Add a PDF and we'll classify it and create the item
  automatically." with a primary `<AddItemButton variant="default"
  label="+ Add PDF" />` CTA.

**Reused, not refactored**:

- [apps/web/src/lib/upload.ts](apps/web/src/lib/upload.ts) —
  `putFileWithProgress` and `MAX_UPLOAD_FILE_BYTES` imported directly. The
  near-identical upload sequence inside
  [upload-processing-panel.tsx:136-188](apps/web/src/app/(dashboard)/packages/[id]/_components/upload-processing-panel.tsx)
  (`uploadOne`) was *not* extracted. Considered, declined: the
  onboarding-wizard upload logic interleaves with that panel's
  drag-and-drop, batch partitioning, and per-row state — extracting risks
  destabilizing the panel for a single in-editor caller. A future cleanup
  phase could lift the presign→PUT→confirm trio into
  `lib/upload-source-pdf.ts` if a third caller appears.

**Backend reused** (no new endpoints):

- `POST /api/v1/packages/[id]/source-pdfs/presign` —
  [route.ts](apps/web/src/app/api/v1/packages/[id]/source-pdfs/presign/route.ts).
  No `pkg.status` guard, so adding a PDF to a `ready` package works
  unchanged.
- `POST /api/v1/packages/[id]/source-pdfs/[sourcePdfId]/confirm` — same,
  runs parse + OCR on confirm.
- `POST /api/v1/packages/[id]/process` —
  [process/route.ts:91-93](apps/web/src/app/api/v1/packages/[id]/process/route.ts)
  flips `pkg.status` `ready → processing` unconditionally and enqueues
  `classify` for any source PDF with no `itemId`.
- Classify worker
  [classify.ts:65-102](apps/worker/src/jobs/classify.ts) inserts the item
  row (`title = sourcePdf.originalFilename`, AI-classified `docType` and
  `docTypeConfidence`), links the source PDF, and transitions to
  `extracting`. `extract` follows and fills attributes.

**Backend bug fixes shipped alongside Phase 8** (surfaced once "+ Add item"
made the second-process path reachable from the UI):

- [apps/worker/src/index.ts:56-85](apps/worker/src/index.ts) — dropped
  `'succeeded'` from `enqueueChainedJob`'s blocking statuses. Before this
  fix, `batch_order` would silently not re-enqueue after a prior success,
  so adding a second item to an already-`ready` package left
  `pkg.status='processing'` forever even after the new PDF reached
  `extracted`. `batch_order` is the package-level finalizer that flips
  status back to `ready`; it legitimately needs to re-run for every fresh
  pipeline iteration. Per-PDF jobs (ocr/classify/extract) are still
  filtered upstream by `processingStatus`, so they don't re-run for
  unchanged PDFs.
- Removed `packageExportedError()` checks from all item/source-pdf
  mutation endpoints (items POST/PATCH/DELETE, attribute PUT/revert,
  source-pdfs PATCH/DELETE/cancel-processing, items reorder). Exported
  packages are no longer write-locked; the user can keep editing and
  re-export to publish changes. The "any export exists" guard on
  source-pdf DELETE stays — exports physically reference the source PDFs.

**Tests** under [apps/web/tests/](apps/web/tests/):

- [ui-phase8-add-item.test.ts](apps/web/tests/ui-phase8-add-item.test.ts) —
  12 unit tests across `isValidPdfContentType`, `isPdfFilename`,
  `isWithinPdfSizeLimit`, `MAX_PDF_BYTES` (cap-match guard), and
  `validateAddItemFile` (incl. content-type/extension fallback, empty,
  over-cap, happy path). Mirrors the Phase 6/7 helper-test pattern.
- [phase5.integration.test.ts](apps/web/tests/phase5.integration.test.ts) —
  inverted the two cases that previously asserted 409
  `package_exported` on item PATCH/attribute PUT/revert/reorder and on
  source-pdf PATCH. They now assert 200, matching the new "exported is
  editable" rule.

## What's wired vs. what's stubbed

- **Wired**: complete loop — pick PDF → presign → upload → confirm → process
  → classify (creates item, links source PDF) → extract (fills attributes)
  → package back to `ready` with the new item present in the editor on the
  status-poll round-trip. No bespoke polling logic in the new component —
  the existing `<UploadProcessingPanel />` covers it.
- **Stubbed: initial title is always the PDF filename.** Classify uses
  `sourcePdf.originalFilename` as the item title. Users rename via the
  existing inline editable title in
  [item-row.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/item-row.tsx).
  Same behavior as the onboarding flow.
- **Stubbed: no progress bar inside the editor while the AI runs.** The
  page swaps to `<UploadProcessingPanel />` during `pkg.status ===
  'processing'`, which already has its own progress UI. The in-editor button
  only shows the pre-process stages (presign/upload/confirm/process-request).
- **Stubbed: single file at a time** from the editor. Bulk add is the
  onboarding wizard's job — different mental model.
- **Stubbed: server-side byte cap.** Same as Phase 7's logo: the schema
  (`sourcePdfPresignRequestSchema` in
  [packages/shared/src/api/files.ts:15](packages/shared/src/api/files.ts))
  validates `byte_size: z.number().int().positive()` with no upper bound.
  Client-side 50 MB cap fires before any network call. Tightening server-side
  is a one-line change.
- **Exported packages now editable.** [page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx)
  routes both `'ready'` and `'exported'` to `<PackageEditor />`. The
  former `<ExportedPackageView />` is no longer mounted from any page
  (file kept as a reference but harmless dead code; the orphan
  [pdf-preview.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/pdf-preview.tsx) likewise stays for now).
  A new `<ExportStatusBanner />`
  ([export-status-banner.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-status-banner.tsx))
  mounts at the top of the editor when `pkg.latest_export` exists:
  - `status === 'exported'`: neutral banner — "Latest export ready · N pages · X MB · rendered Yh ago [Download export]".
  - `status === 'ready'` + an export exists (edited since): amber banner — "Edited since last export · re-export to publish your edits [Download last export]".
  - No export ever: no banner.

## Verification I ran

```powershell
pnpm --filter @submittal/web exec vitest run tests/ui-phase8-add-item.test.ts
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/shared typecheck
pnpm --filter @submittal/web test
pnpm --filter @submittal/web build
```

Results:

- Focused Phase 8 helper tests: 12/12 passing.
- Full web test suite: **14 files / 128 tests passing** (was 13 / 116 at the
  end of Phase 7; +12 phase-8-add-item, prior suites still green).
- Typecheck (both apps/web and packages/shared), lint, and build pass.
- Build still prints the pre-existing Sentry global-error warning,
  source-map advisory, and Next lint-deprecation notice.
- Tests still print the pre-existing Resend sandbox warnings.
- `/packages/[id]` route size: **38.2 kB / 202 kB First Load JS** (modest
  bump from the new component + helpers; was 37-ish at the end of Phase 7).

**Manual browser smoke**: not run this session. Suggested checks for the
next session:

1. From a `ready` package's editor, click `+ Add item` in the toolbar — file
   picker opens.
2. Cancel the picker — no state change, no toast.
3. Pick a non-PDF (e.g. `.png`) — client toast `"Only PDF files can be
   added."`, no network call.
4. Pick a PDF over 50 MB — client toast `"PDFs must be 50 MB or smaller."`,
   no network call.
5. Pick a valid PDF — button cycles `Preparing… → Uploading N% → Saving… →
   Processing…`. Page swaps to `<UploadProcessingPanel />`. After classify +
   extract complete, page returns to `<PackageEditor />` with the new item
   present (title = filename, `doc_type` AI-classified, confidence on the
   doc-type chip).
6. From a package with no items (status='ready' but empty), click `+ Add
   PDF` in the empty-state card — same outcome, item list goes from 0 to 1.
7. Confirm exported packages still render `<ExportedPackageView />` (button
   not visible).

## Where to start

Remaining slices from prior handoffs:

- **Toughen the export polling for slow renders** — the export dialog exits
  to background when the user clicks `Run in background`, but the page won't
  pick up the eventual completion without a manual refresh. A page-level
  "exports in flight" indicator on the `ready` editor that polls
  `GET /packages/:id/exports` and toasts on completion would close that loop.
  Reference: exploration during Phase 8 planning noted
  [exported-package-view.tsx:44-54](apps/web/src/app/(dashboard)/packages/[id]/_components/exported-package-view.tsx)
  already lists exports with most of the necessary logic — would be a fairly
  small lift.
- **Workspace settings polish** — global "Settings" nav entry on the
  dashboard header
  ([_components/header.tsx](apps/web/src/app/(dashboard)/_components/header.tsx)),
  logo remove endpoint + control (no DELETE route yet), server-side logo
  byte cap, server-side source-PDF byte cap.
- **Upload helper consolidation** — extract the presign→PUT→confirm trio
  shared by
  [upload-processing-panel.tsx:136-188](apps/web/src/app/(dashboard)/packages/[id]/_components/upload-processing-panel.tsx)
  and
  [add-item-button.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/add-item-button.tsx)
  into a shared helper. Low priority — wait for a third caller.
- **Phase 8 follow-ups specific to "+ Add item"**:
  - Drag-and-drop into the editor (currently only the file picker works).
  - Show a transient "Adding *filename.pdf*…" affordance in the items list
    *before* the processing panel swap, so the user has a beat to confirm
    the right file was picked.
  - Server-side size cap on `sourcePdfPresignRequestSchema`.

Before ending the next session, write `ui-phase-9-handoff.md` at the repo
root with the same structure as this handoff.
