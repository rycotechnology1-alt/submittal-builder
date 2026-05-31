# UI Phase 4 Handoff - Package Editor (TOC Review)

You are picking up after Phase 4 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md) except for one additive
field on the source-page preview response (details below). Phase 3 UI context
is in [ui-phase-3-handoff.md](ui-phase-3-handoff.md). UI work is tracked as
numbered UI phases.

## What I built

**Screen 5 - Package Editor (TOC review)** under
[apps/web/src/app/(dashboard)/packages/[id]/_components/editor/](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/):

- `package-editor.tsx` - top-level. Owns the items query, expanded-row state,
  citation-drawer state, optimistic mutations, rollback, and keyboard
  navigation. Replaces the previous `ready` placeholder in
  [page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx).
- `item-list.tsx` - `@dnd-kit` `DndContext` + vertical `SortableContext`. One
  drag/drop fires the parent's `onReorder`.
- `item-row.tsx` - collapsed and expanded states; renders header chips,
  attribute fields, source-PDF list, delete affordance. Overflow menu has
  Delete; drag is gated to the `⋮⋮` handle only.
- `attribute-field.tsx` - inline input/textarea, blur-to-save, the `⚠ low`
  chip on attributes with `confidence < 0.7` AND `edited_by_user_at = null`,
  and the `↳ AI suggested "..." [Revert]` row when the current value differs
  from the original. Description is the only multi-line field.
- `doc-type-menu.tsx` - dropdown for `PATCH /items/:id { doc_type }`.
- `source-pdf-list.tsx` - read-only per-row source-PDF list with `Open ↗`
  fetching a presigned URL from `GET /source-pdfs/:id/download`.
- `citation-drawer.tsx` - right slide-out built on the new Sheet primitive;
  shows the rendered page image + OCR text + an `Open full PDF ↗` button.
- `confirm-delete-dialog.tsx` - thin Dialog wrapper for `DELETE /items/:id`.
- `item-helpers.ts` / `doc-types.ts` - pure helpers and the doc-type /
  attribute label maps. Unit-tested.

**Shared UI primitive added**:

- [apps/web/src/components/ui/sheet.tsx](apps/web/src/components/ui/sheet.tsx)
  is a shadcn-style Sheet wrapping Radix Dialog with a right-side slide
  animation. Used by the citation drawer; reusable for future cover-sheet and
  export-preview flows.

**New dependencies**:

- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers`,
  `@dnd-kit/utilities`. Added via `pnpm --filter @submittal/web add ...`.

**One additive backend change**:

- [apps/web/src/app/api/v1/source-pages/[id]/preview/route.ts](apps/web/src/app/api/v1/source-pages/[id]/preview/route.ts)
  now returns `page_number` and `source_pdf_id` alongside `image_url` and
  `ocr_text`. The matching zod schema in
  [packages/shared/src/api/files.ts](packages/shared/src/api/files.ts) was
  extended in lockstep. The existing
  [phase3.integration.test.ts](apps/web/tests/phase3.integration.test.ts)
  still passes because it only asserts on `image_url`.

  Why: the drawer needs the page number to render "Page N of M", and the
  Open-full-PDF button needs the source PDF id. The package-items response
  exposes `source_page_id` per attribute but not the page number, so the
  preview endpoint was the cleanest place to thread it back to the UI
  without restructuring the items response.

**Tests** under [apps/web/tests/](apps/web/tests/):

- [ui-phase4-editor.test.ts](apps/web/tests/ui-phase4-editor.test.ts) -
  10 unit tests for `attributeNeedsReview`, `countItemsNeedingReview`, and
  `applyReorder`. Started RED on a missing-module import, then GREEN once the
  helpers landed.

## What's wired vs. what's stubbed

- **Wired**: items list, doc-type reclassify, title edit, attribute edit
  (blur-to-save), attribute revert, citation drawer, source-PDF read-only
  list with presigned-URL open, drag-to-reorder via `@dnd-kit`, delete item
  (confirm dialog), arrow-key row focus, Enter/Esc expand-collapse on focused
  rows, full optimistic-update + rollback path on every mutation, toast on
  any `ApiError`.
- **Toolbar buttons render disabled** with a `title="Coming in a later
  phase"` tooltip: `[+ Add item]`, `[Cover sheet]`, `[Export package →]`.
  Slots exist in the layout; functionality lands later.
- **Citation drawer Prev/Next is deferred** - backend has no
  "list pages by PDF" endpoint and the plan was to keep the phase tight. The
  drawer shows the cited page only; users can hit `Open full PDF ↗` for more.
- **Source-PDF detach/reassign deferred** - no backend endpoint exists.
- **Sort dropdown deferred** - only manual sort_order is persisted; a
  client-side sort would mislead users.
- **"Mark reviewed ✓" bulk-clear deferred** - users still clear `⚠` chips
  per-attribute by editing.
- **Exported read-only editor and mobile-warning banner** remain deferred.

## Verification I ran

```powershell
pnpm --filter @submittal/web exec vitest run tests/ui-phase4-editor.test.ts
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/web test
pnpm --filter @submittal/web build
pnpm --filter @submittal/shared typecheck
```

Results:

- Focused phase-4 helper tests: 10/10 passing after a RED missing-module
  import.
- Full web test suite: 9 files / 55 tests passing (was 6 / 32 at the end of
  Phase 3; +10 phase-4 unit tests, plus backend integration suites untouched
  but still green).
- Typecheck (both apps/web and packages/shared), lint, and build pass.
- Build still prints the pre-existing Sentry/global-error warning, Next
  lint-deprecation notice, and optional sharp tracing warnings.
- Tests still print the pre-existing Resend sandbox warnings.

**Manual browser smoke**: not run this session. The dev server starts and
typechecks/builds cleanly. Exercising the editor end-to-end requires walking
a real PDF through upload + processing to reach a `ready` package, which
wasn't part of this slice. Worth running next session before adding new
editor surface area; suggested checks:

- Open a `ready` package; confirm items render, `⚠` badges show only on
  attributes with `confidence < 0.7` and `edited_by_user_at = null`.
- Edit an attribute value; on blur, the `⚠` chip clears and a refresh shows
  the value persisted.
- Click `Source ↗` on an attribute with a citation - drawer opens with image
  and OCR text; Esc closes.
- Drag-reorder two items; refresh shows the order persisted.
- Delete an item via overflow menu - confirm dialog -> item disappears.
- Confirm `[Cover sheet]` and `[Export package →]` render visible-but-
  disabled with the future-phase tooltip.

## Where to start

The natural next slice is **Screen 6 - Cover sheet form** from
[wireframes.md](wireframes.md):

- Wire the disabled `[Cover sheet]` button in the editor toolbar to a slide-
  down or modal form with `PATCH /api/v1/packages/:id` for editable fields
  (submittal #, spec section, revision, date, title).
- Surface project-level fields as read-only with a link back to project
  detail.
- The Sheet primitive added in this phase (`apps/web/src/components/ui/sheet.tsx`)
  is the obvious slide-down host.

Following that, **Screen 7 - Export** wires the `[Export package →]` button
to the existing export endpoints (`POST /packages/:id/exports`,
`GET /exports/:id`, `GET /exports/:id/download`,
`GET /packages/:id/exports`).

Before ending the next session, write `ui-phase-5-handoff.md` at the repo
root with the same structure as this handoff.
