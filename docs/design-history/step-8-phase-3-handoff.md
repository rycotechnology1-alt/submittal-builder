# Phase 3 Handoff - File handling, source PDFs, source pages, downloads

Phase 3 wires the file-ingest path up to the point where Phase 4 can treat confirmed `source_pdfs` rows as AI-processing input. A signed-in user can presign a PDF upload, confirm the uploaded object, persist source page text readiness, preview a page image, download the original PDF, delete a source PDF before export, and upload a workspace logo.

## What was built

- Shared storage adapter in `packages/shared/src/storage/index.ts`:
  - `createS3Storage()`
  - `presignPutUrl()`
  - `presignGetUrl()`
  - `headObject()`, `getObjectBytes()`, `putObject()`, `deleteObject()`
- Shared PDF utilities in `packages/shared/src/pdf/`:
  - `parsePdfPages()` via `pdfjs-dist`
  - `renderPdfPageToWebp()` via `pdf-to-img` + `sharp`
- Shared API schemas in `packages/shared/src/api/files.ts`.
- Web storage adapter in `apps/web/src/server/storage.ts`.
- File key/hash helpers in `apps/web/src/server/file-records.ts`.
- Workspace logo endpoints:
  - `POST /api/v1/workspace/logo/presign`
  - `POST /api/v1/workspace/logo/confirm`
  - `GET /api/v1/workspace` now returns a presigned `sub_company_logo_url` when a logo is configured.
- Source PDF/page endpoints:
  - `POST /api/v1/packages/:id/source-pdfs/presign`
  - `POST /api/v1/packages/:id/source-pdfs/:sourcePdfId/confirm`
  - `DELETE /api/v1/source-pdfs/:id`
  - `GET /api/v1/source-pages/:id/preview`
  - `GET /api/v1/source-pdfs/:id/download`
- `GET /api/v1/packages/:id/status` now reports real `source_pdfs` and `processing_jobs` counts.
- S3 CORS config committed at `infra/s3-cors.json`.
- Phase 3 integration coverage in `apps/web/tests/phase3.integration.test.ts`.
- Bruno flow notes in `apps/web/tests/bruno/phase-3-files/README.md`.

## Where it lives

- Storage:
  - `packages/shared/src/storage/index.ts`
  - `apps/web/src/server/storage.ts`
- PDF:
  - `packages/shared/src/pdf/parse.ts`
  - `packages/shared/src/pdf/render.ts`
- API contracts:
  - `packages/shared/src/api/files.ts`
- Routes:
  - `apps/web/src/app/api/v1/workspace/logo/*`
  - `apps/web/src/app/api/v1/packages/[id]/source-pdfs/*`
  - `apps/web/src/app/api/v1/source-pdfs/[id]/*`
  - `apps/web/src/app/api/v1/source-pages/[id]/preview/route.ts`

## Bucket layout

- Source PDFs: `workspaces/{workspace_id}/source_pdfs/{source_pdf_id}.pdf`
- Page previews: `workspaces/{workspace_id}/page_previews/{source_page_id}.webp`
- Workspace logos: `workspaces/{workspace_id}/logos/{uuid}-{safe_filename}`

The Phase 4 input contract is: confirmed source PDFs remain at `processing_status='uploaded'`, have `byte_size`, `sha256`, `page_count`, and one `source_pages` row per page.

## Page text and preview contract

`confirm` downloads the original PDF bytes from S3, computes SHA-256, parses text with PDF.js, and inserts `source_pages`.

- If page text is at least 50 characters, `source_pages.ocr_text` is populated and `has_ocr=true`.
- If page text is shorter than 50 characters, `ocr_text=null` and `has_ocr=false`; Phase 4 OCR should pick those pages up.
- `GET /source-pages/:id/preview` lazily renders a WebP to `page_previews/{source_page_id}.webp`, caches it in S3, and returns a 5-minute presigned read URL.

## Env vars / secrets added

No new secret names were added beyond Phase 0, but the web runtime now reads:

- `AWS_REGION`
- `S3_BUCKET` or `S3_BUCKET_DEV`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

`S3_BUCKET_DEV` already exists in `.env.example`; `S3_BUCKET` can be used by hosted environments that expose one effective bucket variable.

## S3 CORS

Committed literal JSON: `infra/s3-cors.json`

It allows direct browser `PUT` from:

- `http://localhost:3000`
- `http://localhost:3100`
- `https://app.example.com`

Required upload headers are:

- `content-type`
- `x-amz-server-side-encryption`

Update the production origin before applying this config to the production bucket.

## What is stubbed / deferred

- `POST /packages/:id/process` is still Phase 4.
- `processing_status` transitions beyond `uploaded` are Phase 4.
- Textract OCR backfill for `source_pages.has_ocr=false` is Phase 4.
- Source PDF reassignment to items is Phase 5.
- Export-aware source PDF deletion currently blocks when any export row exists for the package; Phase 5 can tighten this once export status fields exist.
- There is still no dedicated `GET /packages/:id/source-pdfs` list endpoint in the Step 5 contract. Use `GET /packages/:id/status` for source PDF IDs until the frontend asks for a richer list.

## Known gaps and risks

- The automated tests mock the storage adapter; they do not hit live AWS S3. Apply `infra/s3-cors.json` manually and run the Bruno flow against the dev bucket for live-service verification.
- The existing Resend sandbox warning still appears during auth-backed integration tests and does not fail the run.
- `pdf-to-img` and `pdfjs-dist` must stay version-aligned; Phase 3 pins `pdfjs-dist` to `5.6.205` to match the renderer.
- Page preview rendering is synchronous in the request path. It is lazy and cached, but very large drawings may make first preview slower; move this behind a small job if pilot usage shows slow citation drawers.

## Verification

Run from the repo root:

```powershell
pnpm --filter @submittal/web exec vitest run tests/phase3.integration.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Latest local verification on 2026-05-20:

- `pnpm --filter @submittal/web exec vitest run tests/phase3.integration.test.ts` passed: 4 tests.
- `pnpm test` passed: web has 3 files / 15 tests passing; db and worker keep placeholder test scripts; shared has no tests.
- `pnpm typecheck` passed across db, shared, web, and worker.
- `pnpm lint` passed; Next.js still prints its existing `next lint` deprecation/plugin warnings.
- `pnpm build` passed; Next.js still prints existing Sentry/OpenTelemetry warnings and now also warns while tracing `sharp` optional native packages, but the build exits 0.

## Next phase starting point

Phase 4 should start with confirmed source PDFs:

- Query: `source_pdfs.processing_status='uploaded'`
- Join pages via `source_pages.source_pdf_id`
- Pages where `has_ocr=false` need Textract OCR.
- Pages where `has_ocr=true` already have usable `ocr_text`.

Key files to read first:

- `apps/web/src/app/api/v1/packages/[id]/status/route.ts`
- `apps/web/src/app/api/v1/packages/[id]/source-pdfs/[sourcePdfId]/confirm/route.ts`
- `packages/shared/src/pdf/parse.ts`
- `packages/shared/src/pdf/render.ts`
- `packages/shared/src/storage/index.ts`
