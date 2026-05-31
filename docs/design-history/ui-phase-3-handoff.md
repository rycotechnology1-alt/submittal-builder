# UI Phase 3 Handoff - Package Upload + Processing

You are picking up after Phase 3 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md); Phase 2 UI context is in
[ui-phase-2-handoff.md](ui-phase-2-handoff.md). UI work is tracked as numbered
UI phases.

## What I built

**Screen 4 - upload + processing** at
[apps/web/src/app/(dashboard)/packages/[id]/page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx):

- Client route for `/packages/[id]` using TanStack Query.
- Reads `GET /api/v1/packages/:id`, then reads
  `GET /api/v1/projects/:project_id` for the project breadcrumb.
- Renders package not-found, generic error, and skeleton states matching the
  existing dashboard/project detail style.
- Branches by package status:
  - `draft` / `processing`: upload + processing screen.
  - `ready`: explicit placeholder for the next editor phase with item/source
    counts.
  - `exported`: explicit read-only placeholder with latest export summary when
    available.

**Package route components** under
[apps/web/src/app/(dashboard)/packages/[id]/_components/](apps/web/src/app/(dashboard)/packages/[id]/_components/):

- `package-header.tsx` - project back link, package number/revision/title,
  spec section, neutral status badge.
- `upload-processing-panel.tsx` - drag/drop zone, file picker, batch upload
  queue, presign/direct-S3/confirm flow, one process request per successful
  batch, and status polling.
- `upload-file-row.tsx` - stable file rows with icons, status badges, upload
  progress, page count, processing status, and row-level errors.

**Upload utilities and primitive**:

- [apps/web/src/lib/upload.ts](apps/web/src/lib/upload.ts) contains
  `partitionUploadBatch`, PDF/size/count validation constants, and
  `putFileWithProgress` using `XMLHttpRequest` for direct S3 PUT progress.
- [apps/web/src/components/ui/progress.tsx](apps/web/src/components/ui/progress.tsx)
  is a small shadcn-style progress primitive.
- [apps/web/tests/ui-phase3-upload.test.ts](apps/web/tests/ui-phase3-upload.test.ts)
  covers batch validation, required S3 headers, and progress callbacks.

## What's wired vs. what's stubbed

- Direct upload uses the existing backend contract:
  `POST /api/v1/packages/:id/source-pdfs/presign`, direct PUT to S3, then
  `POST /api/v1/packages/:id/source-pdfs/:sourcePdfId/confirm`.
- Direct browser PUT requires the bucket CORS config in
  [infra/s3-cors.json](infra/s3-cors.json). It now includes
  `http://localhost:3000` and `http://localhost:3100` because this repo may run
  on 3100 when another local app already owns 3000.
- After a batch finishes, the UI calls `POST /api/v1/packages/:id/process`
  once if at least one file confirmed.
- Polling uses `GET /api/v1/packages/:id/status` every 2 seconds while active
  and stops when the server reports `ready` or any source PDF reports `error`.
- Existing source PDFs on a draft/processing package can only be shown as
  `Source PDF {short-id}` because the backend intentionally has no rich
  source-PDF list endpoint yet.
- The package editor, read-only exported editor, cover sheet, and export flow
  are still deferred to later UI phases.
- The mobile-warning banner is still not implemented.

## Verification I ran

```powershell
pnpm --filter @submittal/web exec vitest run tests/ui-phase3-upload.test.ts
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/web build
pnpm --filter @submittal/web test
```

Results:

- Focused upload tests: 3/3 passing after a RED import failure for the new
  helper.
- Full web test suite: 6 files / 32 tests passing.
- Typecheck, lint, and build pass.
- Build still prints the pre-existing Sentry/global-error warning, Next lint
  plugin warning, and optional sharp tracing warnings.
- Tests still print the pre-existing Resend sandbox warnings.

Manual browser smoke:

- Started this repo on `http://localhost:3100` because port 3000 was already
  serving another app.
- Signed up through the UI, created a project, created a package, and landed on
  `/packages/65e4f8c2-004a-428c-9524-f35299b88453`.
- Confirmed the draft package screen rendered the project breadcrumb, package
  header, drop zone, Browse files button, and empty files state.

## Where to start

The natural next slice is **Screen 5 - Package Editor (TOC review)** from
[wireframes.md](wireframes.md):

- Reuse the `/packages/[id]` route and replace the current `ready` placeholder.
- Read `GET /api/v1/packages/:id/items` for the item list with attributes,
  confidence, citations, and source PDF links.
- Build collapsed/expanded item rows, low-confidence badges, doc-type
  reclassification, attribute edits/reverts, citation drawer, source PDF
  reassignment affordances, delete item, and reorder.
- Keep the `exported` placeholder until the read-only editor/banner behavior is
  implemented.

Before ending the next session, write `ui-phase-4-handoff.md` at the repo root
with the same structure as this handoff.
