# Step 8 Phase 4 Handoff

## What was built

Phase 4 wires the no-UI backend processing path:

```text
POST /packages/:id/process
  -> pg-boss classify or ocr jobs per source_pdf
  -> ocr backfills source_pages when needed, then enqueue classify
  -> classify creates or updates one draft item per source_pdf, then enqueue extract
  -> extract writes item_attributes and original_ai_value, then enqueue batch_order when all PDFs are extracted
  -> batch_order merges same manufacturer/model, sorts items, and marks the package ready
```

The web app now owns queue creation/enqueueing for `POST /process`, and the worker owns downstream chained enqueueing. Repeated calls are idempotent at the app audit layer and use pg-boss singleton keys.

A no-UI live smoke runner was added because Step 9 UI work has not started yet. It signs up a throwaway user, verifies the email in the dev DB, creates a project/package, uploads two fixture PDFs through presigned S3 URLs, confirms them, processes them through the live worker and Anthropic path, polls status, then asserts items, attributes, confidence, citations, and `original_ai_value`.

## Where it lives

- `apps/web/src/app/api/v1/packages/[id]/process/route.ts` - process endpoint and initial queue fan-out.
- `apps/web/src/server/processing-queue.ts` - shared web pg-boss client and queue setup.
- `apps/web/src/app/api/v1/packages/[id]/status/route.ts` - real source PDF/job status aggregation.
- `apps/web/tests/e2e-phase4-backend.ts` - no-UI live smoke runner.
- `apps/web/tests/phase4-smoke.md` - smoke runner instructions.
- `apps/web/tests/phase4.integration.test.ts` - process endpoint integration coverage.
- `apps/worker/src/index.ts` - pg-boss boot, worker registration, healthz, graceful shutdown.
- `apps/worker/src/jobs/common.ts` - app job status transitions and common job types.
- `apps/worker/src/jobs/ocr.ts` - Textract OCR job and raw response persistence.
- `apps/worker/src/jobs/classify.ts` - page rendering and Claude doc-type classification.
- `apps/worker/src/jobs/extract.ts` - page rendering and Claude attribute extraction.
- `apps/worker/src/jobs/batch-order.ts` - grouping, item sorting, and package ready transition.
- `apps/worker/tests/phase4-jobs.test.ts` - worker job unit coverage with mocked AI/OCR/rendering.
- `packages/db/src/processing-jobs.ts` - attempt-row helpers and latest-logical-job aggregation.
- `packages/shared/src/ai/prompts.ts` - prompt and tool definitions.
- `packages/shared/src/ai/anthropic.ts` - Anthropic SDK wrapper with Zod validation, tool use, prompt caching, and retry.
- `packages/shared/src/ocr/textract.ts` - Textract async OCR wrapper.
- `packages/shared/src/pdf/parse.ts` - Next-compatible runtime import for pdfjs-dist parsing.

## Env vars/secrets added

No new required names were added to `.env.example`; Phase 4 consumes existing values:

- `DATABASE_URL_DIRECT_DEV` or `DATABASE_URL_DIRECT`
- `S3_BUCKET`, `S3_BUCKET_DEV`, or `S3_BUCKET_PROD`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_CLASSIFY_MODEL`
- `ANTHROPIC_EXTRACT_MODEL`
- `WORKER_HEALTHZ_PORT`
- `PGBOSS_CONCURRENCY_OCR`
- `PGBOSS_CONCURRENCY_CLASSIFY`
- `PGBOSS_CONCURRENCY_EXTRACT`

The smoke runner also accepts:

- `PHASE4_SMOKE_BASE_URL`
- `PHASE4_SMOKE_WORKER_URL`

## Retry/backoff matrix

| Topic | Concurrency | pg-boss retry | App idempotency key |
| --- | ---: | --- | --- |
| `ocr` | `PGBOSS_CONCURRENCY_OCR`, default 4 | 3, backoff on | `ocr:{source_pdf_id}` |
| `classify` | `PGBOSS_CONCURRENCY_CLASSIFY`, default 8 | 3, backoff on | `classify:{source_pdf_id}` |
| `extract` | `PGBOSS_CONCURRENCY_EXTRACT`, default 8 | 3, backoff on | `extract:{source_pdf_id}` |
| `batch_order` | pg-boss default | 3, backoff on | `batch_order:{package_id}` |

Anthropic calls retry 429 and 529 responses up to 3 attempts with exponential backoff.

## Processing job audit semantics

`processing_jobs` is one row per attempt. The stable logical job key is `kind + package_id + source_pdf_id`, with `source_pdf_id = null` for package-level `batch_order`. The `attempts` column is the attempt ordinal for that row, not a cumulative counter:

- first attempt inserts `attempts=1`
- a retry inserts a new row with `attempts=max(existing attempts)+1`
- legacy `attempts=0` rows are treated as older pre-upgrade rows
- `/packages/:id/status` summarizes only the latest row for each logical job

## Observability hooks

- Worker logs are structured JSON-ish `console.log` and `console.error` events.
- Worker `/healthz` returns `queue_depth_by_topic`, `error_rate_5m`, and `oldest_job_age_s`.
- pg-boss errors and fatal boot errors are captured through the existing worker Sentry setup.
- AI and OCR failures set `source_pdfs.processing_status='error'` and persist `processing_error`.
- Failed package-level batch ordering leaves the package in `processing`; pg-boss retry creates the next attempt row.

Dead-letter and failure inspection starter query:

```sql
select id, package_id, source_pdf_id, kind, status, attempts, error, started_at, finished_at
from processing_jobs
where status = 'failed'
order by finished_at desc nulls last, created_at desc
limit 50;
```

## Verification performed

Live no-UI smoke passed against local web and worker on the dev services:

```text
PHASE4_SMOKE_BASE_URL=http://localhost:3100
PHASE4_SMOKE_WORKER_URL=http://localhost:8181
pnpm smoke:phase4
```

Result:

```json
{
  "ok": true,
  "item_count": 2,
  "items": [
    { "title": "02-hardie-warranty.pdf", "doc_type": "warranty", "source_pdf_count": 1 },
    { "title": "01-daikin-vrv-cutsheet.pdf", "doc_type": "product_data", "source_pdf_count": 1 }
  ]
}
```

Local verification commands:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All passed. Existing warnings remain: Next ESLint plugin warning, Sentry/OpenTelemetry critical dependency warnings during build, optional sharp package resolution warnings during build, and Resend sandbox warnings during tests.

## What is stubbed/deferred

- There is still no product UI. Live testing is through `pnpm smoke:phase4`.
- Prompt caching is enabled on Anthropic system prompts, but cache hit-rate metrics are not captured from provider response headers yet.
- Live smoke used two real fixture PDFs. The plan asked for accuracy notes from 3+ real packages; that broader accuracy pass is still pending.
- The broken-Anthropic-key manual failure test was not repeated in this slice. Unit tests cover job failure transitions, and the live path succeeded.
- Textract was implemented but not exercised by the successful live smoke because the two fixture PDFs already had parseable text.
- `error_rate_5m` and `oldest_job_age_s` in worker `/healthz` are placeholders at `0`; Phase 6 should wire real operational metrics.

## Known gaps and risks

- Batch ordering is intentionally heuristic: same normalized `manufacturer + model_number` merges items; sort is `spec_section_ref`, then `manufacturer`.
- `batch_order` only runs after all package source PDFs are extracted. This avoids prematurely marking a package ready while later PDF jobs are still queued.
- The smoke runner creates throwaway users/packages in the dev DB and uploads PDFs to dev S3; it does not clean them up.
- `pdfjs-dist` parsing in Next needs the runtime import shim in `packages/shared/src/pdf/parse.ts`; avoid changing that back to a plain static import without checking `next dev` and `next build`.
- pg-boss v10 queues must be created explicitly. Both web and worker create `ocr`, `classify`, `extract`, and `batch_order` before use.

## Next phase starting point

Phase 5 can start from package items that have:

- `items.doc_type`, `doc_type_confidence`, and `doc_type_original_ai_value`
- one or more `source_pdfs.item_id` links
- `item_attributes.current_value`
- `item_attributes.original_ai_value`
- `item_attributes.confidence`
- `item_attributes.source_page_id`

Start Phase 5 in:

- `apps/web/src/app/api/v1/items/[id]/*`
- `apps/web/src/app/api/v1/packages/[id]/items/*`
- `apps/web/src/app/api/v1/packages/[id]/exports/*`
- `apps/web/src/app/api/v1/exports/[id]/*`
- `apps/worker/src/jobs/render_export.ts`
- `packages/shared/src/pdf/assemble.ts`
- `packages/shared/src/pdf/repair.ts`

Recommended first command for the next agent:

```powershell
pnpm smoke:phase4
```

That verifies the Phase 4 backend state before adding audit-aware edits and export rendering.
