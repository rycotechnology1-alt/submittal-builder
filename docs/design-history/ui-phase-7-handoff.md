# UI Phase 7 Handoff — Workspace settings route

You are picking up after Phase 7 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md). Phase 6 UI context is in
[ui-phase-6-handoff.md](ui-phase-6-handoff.md). UI work is tracked as
numbered UI phases.

## What I built

**Screen — Workspace settings** (`/settings/workspace`): the page the
cover-sheet drawer's "Change in workspace settings →" link used to be a
disabled stub for. It edits the two cover-sheet-bound workspace fields and
uploads/replaces the workspace logo.

New files under
[apps/web/src/app/(dashboard)/settings/workspace/](apps/web/src/app/(dashboard)/settings/workspace/):

- `page.tsx` — minimal server component: "Back to projects" breadcrumb,
  `<h1>Workspace settings</h1>`, caption, and `<WorkspaceSettingsForm />`.
  Auth is enforced by the existing
  [(dashboard)/layout.tsx](apps/web/src/app/(dashboard)/layout.tsx).
- `_components/workspace-settings-form.tsx` — client component. Fetches
  workspace via `useQuery({ queryKey: ['workspace'] })` (same key the
  cover-sheet drawer uses, so edits propagate to any open drawer's cache).
  Renders two `EditableRow`s (`name`, `sub_company_name`), each blur-to-save
  via `PATCH /api/v1/workspace` with optimistic update + rollback. Mirrors
  the shape of
  [editable-project-metadata.tsx](apps/web/src/app/(dashboard)/projects/[id]/_components/editable-project-metadata.tsx)
  — the two are intentionally parallel-but-separate (different field set,
  query key, patch shape; abstraction would have cost more than it saved).
- `_components/workspace-logo-upload.tsx` — client component. Renders the
  current logo (or a "No logo" placeholder) and an Upload / Replace button.
  On file pick: client-side validation against
  [logoContentTypeSchema](packages/shared/src/api/files.ts:8) and a 5 MB
  cap, then `POST /api/v1/workspace/logo/presign` → S3 `PUT` via
  `putFileWithProgress` from [apps/web/src/lib/upload.ts](apps/web/src/lib/upload.ts)
  → `POST /api/v1/workspace/logo/confirm`. Stages
  (`presigning`/`uploading`/`confirming`) are reflected in the button
  label (e.g. `Uploading 73%`). On success the returned
  `WorkspaceResponse` is written straight into the `['workspace']` cache so
  the preview + cover-sheet drawer reflect the new logo without an extra
  GET. **No remove control** — backend has no delete endpoint; re-uploading
  replaces the storage key, which is the only flow users need for MVP.
- `_components/workspace-settings-helpers.ts` — pure helpers:
  - `ALLOWED_LOGO_CONTENT_TYPES` / `MAX_LOGO_BYTES` (5 MB).
  - `isValidLogoContentType(type)` / `isWithinLogoSizeLimit(bytes)`.
  - `normalizeWorkspaceFieldValue(value)` — trim.
  - `isEmptyWorkspaceField(value)`.
  - `buildWorkspacePatch(field, value)` — single-field
    `UpdateWorkspaceRequest`.
  - `hasWorkspaceChanged(draft, current)`.
  - `currentWorkspaceValue(workspace, field)`.
  - `WORKSPACE_FIELD_LABELS` for toast/label copy.

**Wired into existing pages**:

- [cover-sheet-drawer.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/cover-sheet-drawer.tsx) —
  the disabled `<span title="Coming in a later phase">Change in workspace
  settings</span>` is now a real `next/link` to `/settings/workspace` with
  the same `ArrowUpRight` icon. The local `FUTURE_PHASE_LABEL` constant
  became unused and was deleted (the equivalent string still lives inline
  in
  [package-editor.tsx:338](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx)
  for the other future-phase affordance).

**Shared schema**:

- [packages/shared/src/api/files.ts](packages/shared/src/api/files.ts) —
  added `LogoPresignResponse` and `LogoConfirmRequest` type exports so the
  upload component can type the presign/confirm round-trip. The underlying
  zod schemas existed already; only the `z.infer<>` aliases were missing.

**No backend changes**:

- `GET/PATCH /api/v1/workspace`,
  `POST /api/v1/workspace/logo/presign`, and
  `POST /api/v1/workspace/logo/confirm` were already complete (see
  [step-8-final-handoff.md:33](step-8-final-handoff.md)). All three are
  tenant-scoped via `withWorkspaceFromHeaders`.

**Tests** under [apps/web/tests/](apps/web/tests/):

- [ui-phase7-workspace.test.ts](apps/web/tests/ui-phase7-workspace.test.ts) —
  11 unit tests across `isValidLogoContentType`, `isWithinLogoSizeLimit`,
  `normalizeWorkspaceFieldValue`, `isEmptyWorkspaceField`,
  `buildWorkspacePatch`, and `hasWorkspaceChanged`. Mirrors the Phase 6
  helper-test pattern.

## Correction to the Phase 6 handoff (read this)

Phase 6's handoff says
[pdf-preview.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/pdf-preview.tsx)
is a `react-pdf` wrapper with a self-hosted pdf.js worker at
`/pdf.worker.min.mjs`, imported via `next/dynamic({ ssr: false })`. **That's
not what actually shipped.** The file as merged is a 26-line plain
`<iframe>` of the presigned download URL — the lightweight approach
suggested as "future work" in the same handoff. Verified during Phase 7
planning:

- [apps/web/package.json](apps/web/package.json) has no `react-pdf` dep.
- `apps/web/public/` does not exist; no `pdf.worker.min.mjs` is shipped.
- No source file in `apps/web/` imports `react-pdf` or `pdfjs-dist` at
  runtime.
- `pdfjs-dist@5.6.205` *is* still listed in
  [apps/web/package.json:40](apps/web/package.json) but it's used
  server-side only by `@submittal/shared/pdf/render` in
  `apps/web/src/app/api/v1/source-pages/[id]/preview/route.ts`. It is
  externalized in
  [next.config.mjs:9](apps/web/next.config.mjs) and that arrangement is
  asserted by
  [sharp-warning-config.test.ts:9](apps/web/tests/sharp-warning-config.test.ts).
  **Do not remove it.**

So the "lighten react-pdf preview" follow-up Phase 6 suggested is
effectively already done. Don't try to "complete" the swap.

## What's wired vs. what's stubbed

- **Wired**: workspace settings page accessible from the cover-sheet drawer
  link, two blur-to-save fields with optimistic update + rollback,
  presign→PUT→confirm logo upload with a 5 MB cap and four allowed image
  types (PNG/JPEG/WebP/SVG), inline progress label on the upload button,
  cache write that propagates the new logo URL to the cover-sheet drawer's
  read-only view.
- **No logo remove control.** Re-upload replaces the key; that's enough for
  MVP. Adding a remove affordance needs a new backend endpoint (e.g.
  `DELETE /api/v1/workspace/logo` that nulls `subCompanyLogoStorageKey`).
- **No global settings nav.** Entry point is the cover-sheet drawer link
  and direct URL only. A top-level "Settings" header item would be the next
  ergonomic improvement if more settings pages land.
- **Logo size cap is 5 MB**, validated client-side. The server-side
  `logoPresignRequestSchema` does not currently enforce a byte cap — if you
  paste an over-cap value the client toast catches it before any network
  call. Tightening server-side would be a one-line schema change in
  [packages/shared/src/api/files.ts](packages/shared/src/api/files.ts).
- **Presigned logo URL has a ~1 h TTL** (`DOWNLOAD_URL_TTL_SECONDS` in
  [apps/web/src/server/file-records.ts](apps/web/src/server/file-records.ts)).
  After a long idle on the settings page the preview will eventually fail
  to load; the cover-sheet drawer refetches on open so it's not an issue
  there.
- **Workspace `['workspace']` query key is shared** with the cover-sheet
  drawer and the new settings form. Both write the same cache; edits made
  in either surface are visible to the other on next render.

## Verification I ran

```powershell
pnpm --filter @submittal/web exec vitest run tests/ui-phase7-workspace.test.ts
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/web test
pnpm --filter @submittal/web build
pnpm --filter @submittal/shared typecheck
```

Results:

- Focused Phase 7 helper tests: 11/11 passing.
- Full web test suite: 13 files / 116 tests passing (was 12 / 105 at the
  end of Phase 6; +11 phase-7-workspace, prior suites still green).
- Typecheck (both apps/web and packages/shared), lint, and build pass.
- Build still prints the pre-existing Sentry/global-error warning and Next
  lint-deprecation notice.
- Tests still print the pre-existing Resend sandbox warnings.
- `/settings/workspace` shows up in the build output at 5.81 kB / 141 kB
  First Load JS.

**Manual browser smoke**: not run this session. Suggested checks for the
next session:

1. From any package page, open the cover-sheet drawer → click "Change in
   workspace settings →" — lands on `/settings/workspace`.
2. Edit `Workspace name`, blur — value persists after refresh.
3. Edit `Sub-company name`, blur — reopen any package's cover-sheet drawer,
   confirm the read-only `Sub company` field reflects the new value.
4. Clear either field and blur — field reverts, error toast (server
   rejects empty via the `trim().min(1)` schema).
5. Upload a PNG logo — progress label cycles `Preparing… → Uploading N% →
   Saving…`, then the preview updates inline. Reopen the cover-sheet
   drawer → `WorkspaceLogoRow` shows the new logo.
6. Try uploading a PDF or an over-5 MB image — rejected client-side with a
   toast, no network call.
7. Upload another PNG — replaces the previous one (the storage key changes,
   preview updates).

## Where to start

Remaining slices from the Phase 6 handoff are unchanged:

- **Manual item creation / "+ Add item"** — still disabled with the
  future-phase tooltip in
  [package-editor.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx).
  Backend `POST /api/v1/packages/:id/items` is ready.
- **Toughen the export polling for slow renders** — the export dialog
  exits to background when the user clicks `Run in background`, but the
  page won't pick up the eventual completion without a manual refresh. A
  page-level "exports in flight" indicator on the `ready` editor that
  polls `GET /packages/:id/exports` and toasts on completion would close
  that loop.
- **Workspace settings polish** — global "Settings" nav entry, logo remove
  endpoint + control, server-side logo byte cap, and possibly a sub-route
  for any future workspace concerns (members, billing, integrations).

Before ending the next session, write `ui-phase-8-handoff.md` at the repo
root with the same structure as this handoff.
