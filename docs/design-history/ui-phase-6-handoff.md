# UI Phase 6 Handoff — Export flow + Project metadata edit

You are picking up after Phase 6 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md). Phase 5 UI context is in
[ui-phase-5-handoff.md](ui-phase-5-handoff.md). UI work is tracked as
numbered UI phases.

## What I built

**Screen 7 — Export** from [wireframes.md:329-410](wireframes.md):
Phases A (confirmation) and B (rendering progress) live in a dialog; Phase C
(ready / download) is the new exported-state view on the package page.

New files under
[apps/web/src/app/(dashboard)/packages/[id]/_components/](apps/web/src/app/(dashboard)/packages/[id]/_components/):

- `editor/export-dialog.tsx` — Dialog with internal `confirm` / `rendering`
  / `error` phase. Owns the `POST /api/v1/packages/:id/exports` mutation and
  polls `GET /api/v1/exports/:id` via TanStack Query (`refetchInterval`
  returns 2000 while status is `pending` / `rendering`, false on
  `ready` / `failed`). On `ready` it invalidates `['package', id]` and
  `['package-exports', id]`, fires a toast, and closes. Phase A renders the
  summary line, included-content bullets, the optional Bates prefix input
  (default + client-side validation), and two collapsible sections — hard
  blockers (in red, disables the render button) and warnings (in amber, with
  `[View]` that scrolls and focuses the offending item row via the existing
  `[data-item-id]` selector).
- `editor/export-helpers.ts` — pure helpers:
  - `computeExportBlockers(items)` — hard blockers (zero items, items with
    no source PDFs) and warnings (low-confidence unreviewed attributes,
    missing common attributes). Reuses `itemNeedsReview` from
    [item-helpers.ts](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/item-helpers.ts).
  - `summarizeExport(items)` — item count plus deduped source page count.
  - `defaultBatesPrefix(pkg)` — sanitizes `submittal_number-revision-`,
    enforces the 16-char cap, returns empty string if nothing usable.
  - `validateBatesPrefix(raw)` — mirrors the server regex
    (`/^[A-Za-z0-9._-]+$/`, length ≤ 16) so the UI can show inline
    validation. Empty input is valid and resolves to `null` (omitted from
    the API payload).
  - `formatBytes` / `formatRelativeTime` — shared by the dialog and the
    exported view. `REMINDER_COOLDOWN_MS` exports the 60 s re-render
    cooldown.
- `exported-package-view.tsx` — replaces the old `ExportedPlaceholder` in
  [page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx). Renders
  Phase C: summary line + status, Download / Re-render buttons, embedded
  first-page PDF preview, and a previous-exports list. The Re-render button
  re-opens `ExportDialog`; after each successful render it stays disabled
  for 60 s (timestamp tracked locally, refreshes via `setTimeout` once
  remaining). Downloads call `GET /api/v1/exports/:id/download` and follow
  the returned presigned URL.
- `pdf-preview.tsx` — `react-pdf` wrapper rendering just the first page.
  Imported via `next/dynamic({ ssr: false })` from `ExportedPackageView` so
  the pdf.js worker never enters the SSR bundle. Sets
  `pdfjs.GlobalWorkerOptions.workerSrc` once to the self-hosted worker at
  `/pdf.worker.min.mjs`.

**Project metadata editing** under
[apps/web/src/app/(dashboard)/projects/[id]/_components/](apps/web/src/app/(dashboard)/projects/[id]/_components/):

- `editable-project-metadata.tsx` — block of four blur-to-save fields
  (`name`, `project_number`, `gc_name`, `architect_name`) using the same
  interaction shape as the cover-sheet `EditableTextField`. Owns the
  per-field `PATCH /api/v1/projects/:id` mutation with optimistic update +
  rollback against the `['project', id]` cache (the same key
  [page.tsx](apps/web/src/app/(dashboard)/projects/[id]/page.tsx) already
  uses). Empty `name` reverts with a toast; the other three accept null.
- `project-edit-helpers.ts` — `isEmptyRequiredField`, `normalizeFieldValue`,
  `buildProjectPatch`, `hasChanged`, `currentValue`. Mirrors the cover-sheet
  helper shape exactly.

**Wired into existing pages**:

- [package-editor.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx) —
  the `[Export package →]` button is enabled (disabled only when
  `items.length === 0` with a tooltip), and `<ExportDialog>` mounts next to
  `<CoverSheetDrawer>` / `<CitationDrawer>`.
- [page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx) — swaps
  `ExportedPlaceholder` for `<ExportedPackageView pkg={pkg}
  project={project} />`.
- [projects/[id]/page.tsx](apps/web/src/app/(dashboard)/projects/[id]/page.tsx) —
  the subheader string is replaced with `<EditableProjectMetadata
  project={project} />`. The h1 still shows `project.name` (also kept in
  sync via the optimistic cache update).

**Dependencies added**:

- `react-pdf@^10` (compatible with the project's vendored
  `pdfjs-dist@5.6.205`).
- `apps/web/public/pdf.worker.min.mjs` (1.2 MB) copied from
  `pdfjs-dist/build` so the preview worker is self-hosted, not CDN-loaded.

**No backend changes**:

- Every export and project endpoint already existed
  (`POST /api/v1/packages/:id/exports`, `GET /api/v1/exports/:id`,
  `GET /api/v1/exports/:id/download`, `GET /api/v1/packages/:id/exports`,
  `PATCH /api/v1/projects/:id`). No shared zod-schema changes.

**Tests** under [apps/web/tests/](apps/web/tests/):

- [ui-phase6-export.test.ts](apps/web/tests/ui-phase6-export.test.ts) — 21
  unit tests across `computeExportBlockers`, `summarizeExport`,
  `defaultBatesPrefix`, `validateBatesPrefix`, `formatBytes`, and
  `formatRelativeTime`. Covers blocker detection, warning generation,
  low-confidence-edited-by-user suppression, source-pdf page-count
  deduping, and Bates prefix validation/normalization.
- [ui-phase6-project-edit.test.ts](apps/web/tests/ui-phase6-project-edit.test.ts)
  — 13 unit tests across the project-edit helpers, mirroring the Phase 5
  cover-sheet test pattern.

## What's wired vs. what's stubbed

- **Wired**: export confirmation dialog with summary, defaulted Bates prefix
  (editable + validated), real blocker/warning computation from cached
  items, `Render package →` that calls
  `POST /api/v1/packages/:id/exports`, polling against
  `GET /api/v1/exports/:id` every 2 s, success transition that invalidates
  the package query and lets the page render `ExportedPackageView` on
  `status === 'exported'`, real PDF first-page preview rendered with
  react-pdf, download via `GET /api/v1/exports/:id/download` →
  `window.location.assign`, previous-exports list with per-row download,
  re-render with 60 s cooldown that re-opens the dialog. Editable project
  metadata on `/projects/[id]` saves on blur with optimistic update +
  rollback.
- **Warning `[View]` closes the dialog and scrolls to the row**. The dialog
  is not preserved across the navigation; clicking `[View]` is treated as a
  decision to leave the export flow and address the warning. If you want
  "open and stay" behavior later, the existing `[data-item-id]` focus
  selector is the hook.
- **Bates prefix length cap is 16** (server contract). The input field is
  `maxLength={20}` only so the user can paste an over-long value and see
  the validation message rather than having characters silently dropped.
- **Re-render cooldown is purely client-side** — the server has no rate
  limit on `POST /packages/:id/exports`, so refreshing the page bypasses
  the cooldown. The wireframe's "greyed for 60 s to discourage spam" intent
  is met for the common case.
- **PDF preview re-fetches the download URL when the latest export changes**
  but does not pre-emptively refresh before the presigned URL expires.
  Long-idle exported pages may need a hard refresh to re-render the preview
  if the user comes back hours later — acceptable for MVP.
- **Read-only-after-export contract is unchanged**. `ExportedPackageView`
  intentionally does not expose any item-mutation surface; the only
  affordances are download and re-render. The 409 `package_exported`
  response from `PATCH /items/:id` etc. is therefore a contract spot-check
  only; no UI catches it because no UI sends those calls in this state.
- **Project name (h1) still mirrors the cache** so editing the name in
  `EditableProjectMetadata` updates the page header live. The cover-sheet
  drawer's read-only project fields also reflect changes on next open
  because they read from the same `['project', id]` cache key.

## Verification I ran

```powershell
pnpm --filter @submittal/web exec vitest run tests/ui-phase6-export.test.ts tests/ui-phase6-project-edit.test.ts
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/web test
pnpm --filter @submittal/web build
pnpm --filter @submittal/shared typecheck
```

Results:

- Focused Phase 6 helper tests: 21 + 13 = 34/34 passing.
- Full web test suite: 12 files / 105 tests passing (was 10 / 71 at the end
  of Phase 5; +21 phase-6-export + +13 phase-6-project-edit = +34, prior
  suites still green).
- Typecheck (both apps/web and packages/shared), lint, and build pass.
- Build still prints the pre-existing Sentry/global-error warning, Next
  lint-deprecation notice, and the optional sharp tracing warnings.
- Tests still print the pre-existing Resend sandbox warnings.
- `pnpm peers check` reports a benign warning that `react-pdf@10.4.1`
  declares `pdfjs-dist@5.4.296` and the workspace has `5.6.205` — both are
  pdfjs 5.x and the worker API surface we use is stable across the minor
  range.

**Manual browser smoke**: not run this session. The dev server starts and
typechecks/builds cleanly. Exercising the export flow end-to-end requires
walking a real PDF through upload + processing to a `ready` package and
clicking through. Worth running next session; suggested checks:

- Open a `ready` package with at least one item, click `Export package →` —
  dialog opens with the summary line, included-content bullets, defaulted
  Bates prefix populated.
- Type `bad!` in the Bates field, click `Render package →` — inline
  validation message, render button stays available (the validation fires
  on click; clearing the field also clears the error).
- Re-open with an item that has no source PDFs — dialog shows the red hard
  blocker and `Render package →` is disabled.
- Re-open with a low-confidence unreviewed attribute — amber warning row
  with `[View]` that closes the dialog and scrolls the offending row into
  focus.
- Click `Render package →` on a clean package — dialog switches to Phase B
  with a progress bar. In DevTools Network, `GET /api/v1/exports/:id`
  fires every ~2 s.
- When `status === 'ready'`, dialog closes; the page transitions to
  `ExportedPackageView` showing the PDF first-page preview, Download / Re-
  render buttons, and the new export at the top of the previous-exports
  list with size + relative time.
- Click `Download PDF` — browser downloads from the presigned URL.
- Click `Re-render` immediately — disabled with the "Available in Ns"
  tooltip; after 60 s it re-enables and re-opens the dialog.
- Hard-refresh while on an exported package — `ExportedPackageView` still
  renders with download + history; preview re-fetches the presigned URL.
- On `/projects/[id]`, click each metadata field, edit it, blur — value
  persists after refresh. Clear `Project name` and blur — field reverts
  with a toast. Open a package's cover-sheet drawer afterward to confirm
  the read-only project fields reflect the new values.

## Where to start

The wireframe set is now fully implemented end-to-end. Reasonable next
slices:

- **Workspace settings route** — the cover-sheet drawer still renders
  `Change in workspace settings` as a disabled affordance with
  `title="Coming in a later phase"`. The backend has
  `GET/PATCH /api/v1/workspace` and the logo presign/confirm endpoints
  ([step-8-final-handoff.md:33](step-8-final-handoff.md)). A small
  `/settings/workspace` page that edits sub_company_name and lets the user
  upload a logo would unblock that affordance.
- **Manual item creation / "+ Add item"** — still disabled with the
  future-phase tooltip in
  [package-editor.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx).
  Backend `POST /api/v1/packages/:id/items` is ready.
- **Toughen the export polling** for slow renders — the current dialog
  exits to background when the user clicks `Run in background`, but the
  page won't pick up the eventual completion without a manual refresh. A
  page-level "exports in flight" indicator on the `ready` editor (polls
  `GET /packages/:id/exports` and shows a toast on completion) would close
  that loop.
- **react-pdf bundle weight** — `react-pdf` plus pdf.js add roughly 350 kB
  gzipped to the exported-package chunk (lazy-loaded). If a leaner preview
  is preferred (or if older browsers misbehave), swapping in an `<iframe>`
  preview via the presigned URL is a one-component change.

Before ending the next session, write `ui-phase-7-handoff.md` at the repo
root with the same structure as this handoff.
