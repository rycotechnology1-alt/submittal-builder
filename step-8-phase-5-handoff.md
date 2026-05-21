# Step 8 Phase 5 Handoff

## What was built

Phase 5 turns the Phase 4 AI output into editable, exportable submittal
packages. The flow is:

```text
PATCH /items/:id                     -> doc_type change preserves
                                       doc_type_original_ai_value (first
                                       change only)
PUT   /items/:id/attributes/:key     -> sets current_value, stamps
                                       edited_by_user_at, leaves
                                       original_ai_value untouched
POST  /items/:id/attributes/:key/revert
                                     -> current_value := original_ai_value,
                                       clears edited_by_user_at
PATCH /source-pdfs/:id { item_id }   -> reassigns a PDF within the same
                                       package
POST  /packages/:id/exports          -> inserts exports row (status=pending),
                                       enqueues render_export pg-boss job
                                       worker render_export:
                                         cover (with logo) +
                                         TOC (clickable text) +
                                         source PDFs merged via copyPages
                                         (no re-encoding) +
                                         outline / bookmarks +
                                         Bates stamp on every page
                                       on success:
                                         exports.status = 'ready'
                                         packages.status = 'exported'
                                         packages.latest_export_id = id
GET   /packages/:id                  -> now includes latest_export summary
GET   /packages/:id/exports          -> list of past exports (newest first)
GET   /exports/:id                   -> single export status row (polled)
GET   /exports/:id/download          -> { url } presigned 5 min S3 read
```

All item mutation endpoints (PATCH /items/:id, DELETE /items/:id, POST
/packages/:id/items, POST /packages/:id/items/reorder, PUT and revert
attribute, PATCH /source-pdfs/:id) return `409 package_exported` when the
package status is `exported`. The client uses this to render the "Create R1
to edit" banner from step-6.

POST /packages/:id/exports is allowed when the package status is `ready`
or `exported` (re-rendering is fine); it is rejected with
`409 package_not_ready` for `draft` and `processing`.

The PDF assembler is a fresh module (`packages/shared/src/pdf/assemble.ts`)
adapted from the Phase 0 spike. It copies source pages by reference via
`pdf-lib.copyPages`, so the byte stream of each individual source page is
preserved — the snapshot test asserts page-count structure and Bates range
rather than byte equality, per step-7 §10.

If pdf-lib refuses to parse a source PDF, the assembler calls the
per-source `repair` hook; the worker wires that hook to `qpdf --linearize`
and logs a `pdf_repair_used` event. If `qpdf` is not installed in the
worker environment, the repair throws `QpdfNotInstalledError`, the
assembler bubbles, the export row is marked `failed`, and the package
status is left untouched.

## Where it lives

- `apps/web/src/app/api/v1/items/[id]/route.ts` — PATCH adds doc_type
  preservation + export guard; DELETE adds export guard.
- `apps/web/src/app/api/v1/items/[id]/attributes/[key]/route.ts` — PUT
  attribute (new file).
- `apps/web/src/app/api/v1/items/[id]/attributes/[key]/revert/route.ts` —
  revert attribute (new file).
- `apps/web/src/app/api/v1/source-pdfs/[id]/route.ts` — adds PATCH; DELETE
  retains existing 409 `source_pdf_exported` and gains the
  `package_exported` guard.
- `apps/web/src/app/api/v1/packages/[id]/items/route.ts` and
  `.../items/reorder/route.ts` — export guard.
- `apps/web/src/app/api/v1/packages/[id]/route.ts` — GET enriched with
  `latest_export` summary.
- `apps/web/src/app/api/v1/packages/[id]/exports/route.ts` — POST/GET
  exports (new).
- `apps/web/src/app/api/v1/exports/[id]/route.ts` — GET single export
  status (new).
- `apps/web/src/app/api/v1/exports/[id]/download/route.ts` — presigned
  download URL (new).
- `apps/web/src/server/processing-queue.ts` — adds `render_export` to the
  shared queue list.
- `apps/web/src/server/phase2-records.ts` — adds `packageExportedError`,
  `exportJson`, `latestExportSummaryJson` helpers.
- `apps/worker/src/jobs/render-export.ts` — new pg-boss handler.
- `apps/worker/src/jobs/common.ts` — `JobKind` gains `'render_export'`;
  `RenderExportJobData` type added.
- `apps/worker/src/index.ts` — registers the `render_export` queue and
  worker.
- `packages/shared/src/pdf/assemble.ts` — cover + TOC + merge + bookmarks +
  Bates stamping.
- `packages/shared/src/pdf/repair.ts` — qpdf fallback (spawn-based, throws
  `QpdfNotInstalledError` when the binary is absent).
- `packages/shared/src/pdf/index.ts` and `packages/shared/package.json` —
  export the new modules; `pdf-lib@^1.17.1` added as a dependency.
- `packages/shared/src/api/exports.ts` — new Zod schemas for exports.
- `packages/shared/src/api/items.ts` — adds
  `updateItemAttributeRequestSchema` and `reassignSourcePdfRequestSchema`.
- `packages/shared/src/api/packages.ts` — `packageLatestExportSummarySchema`
  and updated `packageDetailResponseSchema`.
- `packages/db/src/schema.ts` — adds `export_status` enum, `render_export`
  to `job_kind`, `exports.status`/`error`/`updated_at`,
  `exports_package_created_idx` index.
- `packages/db/drizzle/0001_phase_5_exports.sql` — generated Drizzle
  migration.
- `packages/shared/src/pdf/assemble.test.ts` — unit test (no DB, no
  network) that exercises the assembler with synthetic PDFs.
- `apps/worker/tests/phase5-render-export.test.ts` — worker integration
  test (needs DB env) covering happy path and the no-items failure path.
- `apps/web/tests/phase5.integration.test.ts` — web integration test
  covering audit-aware edits, doc_type preservation, read-only-after-export
  on every mutation endpoint, source-pdf reassign, and the export endpoint
  contract (pg-boss is mocked).

## Env vars/secrets added

No new required env vars. Existing values are reused:

- `DATABASE_URL` / `DATABASE_URL_DIRECT_DEV` / `DATABASE_URL_DIRECT`
- `S3_BUCKET` / `S3_BUCKET_DEV` / `S3_BUCKET_PROD`
- `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

Operational note: the Fly worker image MUST install `qpdf` so the repair
fallback works. Without it, any source PDF that pdf-lib cannot parse will
mark the export `failed` with an error message indicating the binary is
missing. The web app does not need `qpdf`.

## Database migration

`pnpm db:migrate` must be applied before deploying. The migration is
additive and safe to run on existing dev/prod data:

```sql
CREATE TYPE "public"."export_status" AS ENUM('pending', 'rendering', 'ready', 'failed');
ALTER TYPE "public"."job_kind" ADD VALUE 'render_export';
ALTER TABLE "exports" ADD COLUMN "status" "export_status" DEFAULT 'pending' NOT NULL;
ALTER TABLE "exports" ADD COLUMN "error" text;
ALTER TABLE "exports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE INDEX "exports_package_created_idx" ON "exports" USING btree ("package_id","created_at");
```

`ALTER TYPE ... ADD VALUE` is Postgres 12+ safe inside a transaction
provided the new value is not used in the same transaction; the migration
satisfies that.

## Audit field semantics

| Field | Created by | Mutated by | Enforced in |
| --- | --- | --- | --- |
| `items.doc_type_original_ai_value` | classify job (Phase 4) | PATCH `/items/:id` copies the previous `doc_type` into it the FIRST time `doc_type` changes; subsequent edits leave it alone | [items/[id]/route.ts](apps/web/src/app/api/v1/items/[id]/route.ts) |
| `item_attributes.original_ai_value` | extract job (Phase 4) | never mutated by web routes | PUT route writes `currentValue` only |
| `item_attributes.current_value` | extract job (Phase 4) | PUT attribute writes; revert copies `original_ai_value` back | [attributes/[key]/route.ts](apps/web/src/app/api/v1/items/[id]/attributes/[key]/route.ts), [revert/route.ts](apps/web/src/app/api/v1/items/[id]/attributes/[key]/revert/route.ts) |
| `item_attributes.edited_by_user_at` | NULL initially | PUT stamps `now()`; revert clears | same routes |
| `packages.latest_export_id` | render_export worker on success | only the worker writes it | [render-export.ts](apps/worker/src/jobs/render-export.ts) |
| `packages.status='exported'` | render_export worker on success | only the worker writes it | same |
| `exports.status` transitions | POST exports inserts `pending`; render_export transitions `pending`→`rendering`→`ready`/`failed` | only the worker writes after insert | same |

## Export structure spec

For a package with `N` source PDFs each of `p_i` pages, the assembled
output has:

- **Page 1**: cover sheet (workspace logo if present, package metadata,
  approval stamp box).
- **Page 2**: TOC, one row per item title with `p. <pageNumber>`.
- **Pages 3..total**: source PDFs concatenated in `items.sort_order` (and
  by `source_pdfs.created_at` within an item that has multiple PDFs).
  Pages are copied via `pdf-lib.copyPages` — original content streams are
  preserved.

Total page count = `2 + sum(p_i)`. Outline contains one entry per item,
each pointing at the first page of that item's first source PDF. Bates
stamp `{prefix}{1..total zero-padded to 6}` is drawn in the bottom margin
of every page including the cover and TOC.

## qpdf-fallback trigger conditions

The repair hook is invoked when `pdf-lib.PDFDocument.load(bytes,
{ ignoreEncryption: true })` throws on a specific source. The worker hook
calls `qpdf --linearize <in> <out>` (exit code 0 or 3 is treated as
success — qpdf returns 3 for warnings). Outcomes:

- Repair succeeded → assembler uses the repaired bytes; worker logs
  `pdf_repair_used` and includes the source-pdf id in the
  `repairedSourceIndices` array on the result.
- Repair failed (qpdf installed, exit code not 0/3) →
  `QpdfRepairFailedError` bubbles, export marked `failed`.
- qpdf not installed (`ENOENT` or spawn failed) →
  `QpdfNotInstalledError`, worker logs `pdf_repair_unavailable`, export
  marked `failed`.

## Read-only-after-export error contract

```json
HTTP/1.1 409 Conflict
{
  "error": {
    "code": "package_exported",
    "message": "Package is exported and cannot be modified. Create a new revision to make edits."
  }
}
```

Endpoints that return this on `packages.status='exported'`:

- `PATCH /items/:id`
- `DELETE /items/:id`
- `POST /packages/:id/items`
- `POST /packages/:id/items/reorder`
- `PUT /items/:id/attributes/:key`
- `POST /items/:id/attributes/:key/revert`
- `PATCH /source-pdfs/:id`
- `DELETE /source-pdfs/:id`

`POST /packages/:id/exports` is intentionally NOT in this list — a user
may render a fresh export after the first one (e.g., to apply a different
Bates prefix). Until V1.1 ships revision cloning, the rule is: edit while
`status='ready'`, re-export to refresh, no edits while
`status='exported'`.

## Verification performed

Locally:

```powershell
pnpm typecheck      # all 4 workspaces green
pnpm lint           # all 4 workspaces green
pnpm build          # web app builds; all new routes appear in the route table
pnpm --filter @submittal/shared test    # 3 assembler structure tests pass
```

Still needs a live dev DB run before merge:

```powershell
pnpm db:migrate
pnpm --filter @submittal/worker test    # adds tests/phase5-render-export.test.ts
pnpm --filter @submittal/web test       # adds tests/phase5.integration.test.ts
```

The phase 4 smoke runner (`pnpm smoke:phase4`) was not re-executed in this
session — it was confirmed passing in the Phase 4 handoff and Phase 5
changes are additive on top of that pipeline. A full Phase 5 backend e2e
script (signup → upload → process → edit → export → download) is deferred
to Phase 6, which has it as a deliverable
(`apps/web/tests/e2e-backend.sh`).

## What is stubbed/deferred

- No frontend yet (still Phase 9). All Phase 5 endpoints are exercised
  through tests only.
- `infra/` does not yet declare a Fly image that installs `qpdf`. Phase 6
  should fold that into the worker Dockerfile and verify by deploying a
  broken-on-purpose PDF.
- Cover sheet typography is functional but minimal — no font embedding
  beyond StandardFonts (Helvetica). Custom fonts are V1.1.
- Logo image: only PNG and JPEG are supported; SVG logos uploaded via
  `/workspace/logo/presign` will be skipped silently (the cover renders
  without one).
- Revision diff and multi-product split are explicitly V1.1 per the
  buildplan.
- Performance numbers on a 200-page package: not measured in this session.
  Phase 6's e2e + observability work should capture a real timing.

## Known gaps and risks

- The worker test fakes pdf rendering for source PDFs by reading bytes
  off a real fixture made with pdf-lib. Real Anthropic-extracted PDFs may
  exercise edge cases (encrypted, malformed XRef, etc.) that only the
  qpdf path catches; that path is unit-tested for invocation but not yet
  exercised end-to-end against a real broken PDF.
- The export job stamps Bates labels on the cover and TOC pages. If a
  reviewer expects "Bates only on source pages" that becomes a Phase 6
  flag. The buildplan says "every page".
- Concurrent calls to `POST /packages/:id/exports` insert two rows with
  distinct ids. pg-boss `singletonKey: "render_export:<exportId>"`
  deduplicates within a single exportId, but two parallel POSTs produce
  two independent jobs. That is fine — both render to distinct
  storage_keys and the latest wins via `latest_export_id`. If V1 ever
  needs strict single-flight, add an Idempotency-Key check on the POST.
- The `packages.status` transition to `exported` happens inside the
  worker after upload. A crash between `putObject` and the
  `update(packages)` call leaves the export `ready` but the package
  status as `ready`. The retry of the same job is safe: the row id in
  pg-boss is replayed, but the in-flight transaction would re-run all
  three writes (export status, package status, processing-jobs). At
  worst the user sees `latest_export.status='ready'` on a `status=ready`
  package for one tick.

## Next phase starting point

Phase 6 (observability + end-to-end smoke + frontend handoff) can start
from:

- `apps/web/src/app/api/v1/healthz` (skeleton exists, needs to surface
  versions + db ping).
- `apps/worker/src/index.ts` `/healthz` returns placeholder `0` for
  `error_rate_5m` and `oldest_job_age_s` — Phase 6 should wire real
  metrics off `processing_jobs`.
- `apps/web/tests/e2e-backend.sh` — write this. It should run the full
  signup → upload → process → edit → export → download flow against a
  Neon preview branch, asserting SHA-256 of source bytes is unchanged
  inside the assembled PDF.
- `infra/fly.toml` for the worker should add a step that `apt-get install
  qpdf` (or equivalent in the chosen base image). The repair fallback
  silently degrades to "export failed" if missing, so this is required
  before Phase 6's verification.
- `docs/ops/queries.sql` — Phase 6 deliverable. Useful Phase-5 starter
  queries:

```sql
-- failed exports in the last 24h
select id, package_id, error, created_at, updated_at
from exports
where status = 'failed' and created_at > now() - interval '24 hours'
order by created_at desc;

-- slowest exports
select id, package_id, byte_size, page_count,
       extract(epoch from (updated_at - created_at)) as render_seconds
from exports
where status = 'ready'
order by render_seconds desc nulls last
limit 25;

-- packages stuck in 'processing' for over an hour
select id, workspace_id, project_id, updated_at
from packages
where status = 'processing' and updated_at < now() - interval '1 hour';
```

Recommended first command for the next agent:

```powershell
pnpm db:migrate
pnpm test
```
