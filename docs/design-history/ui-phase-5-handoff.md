# UI Phase 5 Handoff - Cover Sheet Form

You are picking up after Phase 5 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md) and the small additive
field that landed in Phase 4. Phase 4 UI context is in
[ui-phase-4-handoff.md](ui-phase-4-handoff.md). UI work is tracked as numbered
UI phases.

## What I built

**Screen 6 - Cover sheet form** under
[apps/web/src/app/(dashboard)/packages/[id]/_components/editor/](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/):

- `cover-sheet-drawer.tsx` - top-level drawer hosted in the Sheet primitive.
  Owns the workspace query, the per-field `PATCH /api/v1/packages/:id`
  mutation, and optimistic-update + rollback against the `['package', id]`
  TanStack Query cache. Renders three sections: project (read-only with a
  link back to project detail), package (editable), and workspace defaults
  (read-only).
- `cover-sheet-fields.tsx` - presentational pieces:
  - `ReadOnlyField` - label + value row with muted "—" placeholder.
  - `EditableTextField` - input with blur-to-save, Enter to commit, Esc to
    revert. Mirrors the interaction model from `attribute-field.tsx`.
  - `RevisionSelect` - native `<select>` with `R0`–`R5`, plus a graceful
    fallback that prepends the current value if it falls outside the list.
  - `DateField` - native `<input type="date">` that fires the same commit
    path on change.
- `cover-sheet-helpers.ts` - pure helpers (`buildPackagePatch`,
  `normalizeFieldValue`, `isEmptyRequiredField`, `hasChanged`) that encode
  the nullable vs required-field rules from the shared schema. Unit-tested.

**Wired into the editor**:

- [package-editor.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx)
  now accepts a `project: ProjectResponse | null` prop alongside `pkg`. The
  `[Cover sheet]` toolbar button is enabled and toggles `coverSheetOpen`;
  the `<CoverSheetDrawer>` mounts next to the existing `<CitationDrawer>`.
- [page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx) passes the
  existing `project` value (already fetched via `projectQuery`) down into
  `<PackageEditor>`. No other page changes.

**No backend changes**:

- `PATCH /api/v1/packages/:id` already accepted all editable fields via
  `updatePackageRequestSchema`. The workspace defaults section reads from
  the existing `GET /api/v1/workspace` (returns `sub_company_name` and a
  presigned `sub_company_logo_url`). No shared zod-schema changes.

**Tests** under [apps/web/tests/](apps/web/tests/):

- [ui-phase5-cover-sheet.test.ts](apps/web/tests/ui-phase5-cover-sheet.test.ts)
  - 16 unit tests across `isEmptyRequiredField`, `normalizeFieldValue`,
  `buildPackagePatch`, and `hasChanged`. Covers required vs nullable field
  handling, trim/whitespace behavior, and null-vs-empty-string change
  detection.

## What's wired vs. what's stubbed

- **Wired**: opening the drawer from the toolbar; project read-only fields
  with link to `/projects/${pkg.project_id}`; editable Submittal #, Spec
  section, Revision (select), Date (date input), Title - all save on blur /
  change via `PATCH /api/v1/packages/:id` with optimistic update + rollback
  against the `['package', id]` cache; workspace defaults render the
  current `sub_company_name` and logo image (presigned URL); empty submits
  on required fields revert with a toast.
- **"Change in workspace settings" affordance renders disabled** with a
  `title="Coming in a later phase"` tooltip. The Settings route does not
  exist yet.
- **"Edit project metadata →" link** routes to `/projects/${id}`. The
  project detail page exists but does not currently expose an edit form
  for the read-only project fields (name, project number, GC, architect)
  - the `PATCH /api/v1/projects/:id` endpoint is ready, so wiring that
  surface is a small follow-on slice.
- **Live preview is deferred** - the drawer renders a muted "Live preview
  lands with export work." placeholder card in the live-preview slot.
- **Per-package overrides of sub company / logo are deferred** - wireframe
  MVP says workspace-level only; per-package data model not extended.
- **Read-only mode after export** still hands off to the existing
  `ExportedPlaceholder` in `page.tsx`. The cover-sheet drawer is only
  reachable from the `ready` editor, matching where the Cover sheet button
  lives.

## Verification I ran

```powershell
pnpm --filter @submittal/web exec vitest run tests/ui-phase5-cover-sheet.test.ts
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/web test
pnpm --filter @submittal/web build
pnpm --filter @submittal/shared typecheck
```

Results:

- Focused phase-5 helper tests: 16/16 passing.
- Full web test suite: 10 files / 71 tests passing (was 9 / 55 at the end
  of Phase 4; +16 phase-5 unit tests, prior suites still green).
- Typecheck (both apps/web and packages/shared), lint, and build pass.
- Build still prints the pre-existing Sentry/global-error warning, Next
  lint-deprecation notice, and optional sharp tracing warnings.
- Tests still print the pre-existing Resend sandbox warnings.

**Manual browser smoke**: not run this session. The dev server starts and
typechecks/builds cleanly. Exercising the drawer end-to-end requires
walking a real PDF through upload + processing to reach a `ready` package
and then clicking through the cover sheet form. Worth running next session
before adding new editor surface area; suggested checks:

- Open a `ready` package, click `[Cover sheet]` - drawer slides in from
  the right.
- Confirm project fields render read-only with `—` for missing values, and
  the "Edit project metadata →" link goes to `/projects/${project_id}`.
- Edit Submittal #, blur the input - value persists after a hard refresh;
  the cached `PackageHeader` reflects the change (it reads the same
  `['package', id]` cache).
- Change Revision via the dropdown - same persistence check.
- Pick a date, then clear it - second save sends `submittal_date: null`
  (verify in the Network tab).
- Clear Submittal #, blur - field reverts and a toast fires.
- Workspace logo image renders when uploaded; "No logo uploaded" otherwise.
- "Change in workspace settings" affordance shows the future-phase tooltip.
- Close drawer with Esc and the ✕ button.

## Where to start

The natural next slice is **Screen 7 - Export** from
[wireframes.md](wireframes.md) lines 329–411:

- Wire the still-disabled `[Export package →]` toolbar button (at
  [package-editor.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx))
  to the export-confirmation modal (Phase A), the rendering-progress
  panel (Phase B), and the ready-to-download state (Phase C).
- Backend support already exists: `POST /packages/:id/exports`,
  `GET /exports/:id`, `GET /exports/:id/download`, and
  `GET /packages/:id/exports` (per the Phase 4 handoff).
- The Sheet primitive can host the slide-out, or this can be a Dialog -
  the wireframe is amenable to either.

A small follow-on worth picking up alongside the cover sheet is wiring
**project metadata editing** on `/projects/[id]` - the cover sheet's "Edit
project metadata →" link currently lands on a read-only page. Backend
`PATCH /api/v1/projects/:id` is ready.

Also worth a quick pass when the **live preview** lands: the cover-sheet
drawer has a placeholder card sized roughly to the wireframe's preview
slot. Drop the SVG/canvas rendering into that slot.

Before ending the next session, write `ui-phase-6-handoff.md` at the repo
root with the same structure as this handoff.
