# Design: User-chosen revisions + accessible export history

**Date:** 2026-05-28
**Status:** Approved for implementation planning
**Working directory:** `C:\Repos\submittal-builder`

## Problem

Adding items to an already-exported package works (the old "lock after export"
write-guards were removed in UI Phase 8), but the surrounding revision workflow
is half-built and partly inconsistent with how the product should behave:

- **"Create a revision" isn't a real action.** `packages.revision` is just a
  text label edited via a dropdown on the cover sheet. Changing R0 → R1 relabels
  the live package and snapshots nothing distinctly.
- **Prior exports aren't accessible.** Every export is persisted as its own
  `exports` row (bytes recoverable) and a `GET /packages/[id]/exports` endpoint
  already lists them, but no UI surfaces anything beyond the single
  `latest_export` banner.
- **Leftover lock machinery.** A now-dead `packageExportedError()` helper and an
  orphaned `ExportedPackageView` component remain from the abandoned
  lock-after-export design, and an e2e smoke assertion still expects a `409` on
  re-edit (it now returns `200`), leaving `pnpm smoke:e2e` red.

## Guiding principle

A package is a group of processed PDFs plus a few data points. The user freely
reorders items and edits data, picks a revision label for each export, and gets
a list of past exports to re-download.

Explicitly **not** in this product's model:

- No locking, read-only states, or "exported = legal artifact" enforcement.
- No automatic revision creation. The revision label is always a user choice.
- No cloning or freezing of item/attribute state. The exported PDF bytes are the
  record of "what R0 contained."
- No blocking of duplicate revision labels — a user may export multiple R0s for
  the same package, and that must be allowed.

## Scope

### 1. Data model — one column

Add a nullable `revision text` column to the `exports` table via a new migration
`packages/db/drizzle/0003_export_revision.sql` (plus the matching Drizzle schema
update). Each export records the label it was stamped with so the history list
can show R0 / R1 / R2 next to each PDF.

- No uniqueness or check constraints — duplicate labels are permitted.
- Backfill existing rows to `'R0'` in the migration.
- `packages.revision` is unchanged; it remains the "current / next export" label.

### 2. Export flow — pick the label at export time

- `ExportDialog` (`apps/web/.../editor/export-dialog.tsx`) gains an
  "Export as: [R1 ▾]" selector, reusing the existing `REVISION_OPTIONS` list from
  `cover-sheet-fields.tsx`. It defaults to the package's current `revision`.
- `createExportRequestSchema` (`packages/shared/src/api/exports.ts`, currently
  `.strict()`) gains an optional `revision` field. Allowed values mirror the
  cover-sheet dropdown; an unrecognized free value is accepted as-is to match the
  "don't block the user" principle.
- The `POST /api/v1/packages/[id]/exports` handler
  (`apps/web/.../packages/[id]/exports/route.ts`) writes the chosen `revision` to
  `packages.revision` **and** stamps it onto the new `exports` row at creation
  time. If the request omits `revision`, the package's current value is used.
- The worker is unchanged: `render-export.ts` already builds the cover from
  `pkg.revision` (line ~181), which now reflects the user's pick.
- The cover-sheet revision dropdown remains as a secondary way to set the same
  field. The two never disagree because both read/write `packages.revision`.

**Single source of truth:** the chosen revision is threaded
`export request → packages.revision → cover render`, rather than passed straight
to the worker. The cover-sheet dropdown and the export selector always agree.

### 3. Export history UI — banner + expandable list

- Keep the compact latest-export banner
  (`editor/export-status-banner.tsx`), including its existing two states:
  "Latest export ready" (after export) and "Edited since last export · re-export
  to publish your edits" (after editing a previously-exported package). That
  amber state already covers the add-item-after-export case and needs no change
  beyond optionally showing the revision label.
- Add a collapsible "Previous exports" list beneath the banner, driven by the
  existing `GET /api/v1/packages/[id]/exports` endpoint. Each row shows: revision
  label, date, page count, byte size, and a Download button that reuses the
  existing `/api/v1/exports/[id]/download` flow.
- `exportJson` (`apps/web/src/server/phase2-records.ts`) and the `exportSchema`
  (`packages/shared/src/api/exports.ts`) gain the `revision` field. The
  latest-export summary schema/JSON
  (`packageLatestExportSummarySchema`, `latestExportSummaryJson`) also gains
  `revision` so the banner can display it.

### 4. Cleanup + test fix

- Fix the e2e assertion at `apps/web/tests/e2e-backend.ts:304`: a re-edit on an
  exported package now expects `200` (not `409`). Strengthen the test to also
  assert that a **second export under a bumped revision** succeeds and that both
  export rows are listed with their respective revision labels.
- Delete the dead `packageExportedError()` helper
  (`apps/web/src/server/phase2-records.ts:220`) and the orphaned
  `ExportedPackageView` component.

## Explicitly out of scope

- The worker `'succeeded'`-removal bug fix in `apps/worker/src/index.ts` stays
  as-is. **Do not revert it** — reverting reintroduces the "package stuck in
  `processing` forever after add-item" bug.
- No revision diffing (R0 vs R1).
- No per-item snapshot/clone entities.
- No read-only, lock, or forced-revision behavior.

## Affected files (reference)

| File | Change |
|---|---|
| `packages/db/drizzle/0003_export_revision.sql` (new) | Add `revision` column to `exports`; backfill `'R0'` |
| `packages/db/.../schema` (Drizzle) | Add `revision` to `exports` table definition |
| `packages/shared/src/api/exports.ts` | Add `revision` to `exportSchema` + `createExportRequestSchema` |
| `packages/shared/src/api/packages.ts` | Add `revision` to latest-export summary schema |
| `apps/web/src/server/phase2-records.ts` | Add `revision` to `exportJson` + `latestExportSummaryJson`; delete `packageExportedError()` |
| `apps/web/.../packages/[id]/exports/route.ts` | Write chosen revision to package + stamp export row |
| `apps/web/.../editor/export-dialog.tsx` | "Export as" revision selector |
| `apps/web/.../editor/export-status-banner.tsx` | Show revision label; collapsible previous-exports list (or sibling component) |
| `apps/web/.../editor/` (ExportedPackageView) | Delete orphaned component |
| `apps/web/tests/e2e-backend.ts` | Re-edit expects 200; assert second export under bumped revision |

## Testing

- **e2e smoke (`pnpm smoke:e2e`)**: green again, with the new
  edit-after-export + re-export-as-new-revision assertions.
- **Integration**: export with an explicit `revision` stamps both the package and
  the export row; export list returns rows with correct revision labels; omitting
  `revision` falls back to the package's current label.
- **Manual UI**: export R0 → add an item → export R1 → confirm both appear in the
  Previous exports list with correct labels and both download intact.
