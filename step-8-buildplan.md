# Step 8 Build Plan — Submittal Builder

## Context

Steps 1–7 produced the brief, data model, API contract, wireframes, and stack lock-in. The repo at `C:\Repos\submittal-builder` is greenfield — only design docs exist, no code. Step 8 of the MVP roadmap (`C:\Repos\path to MVP.md`) is "build the risky backend paths first": database, auth, core APIs, file handling, notifications, permissions, audit/status logic — and per user confirmation, the AI processing pipeline too (it is the riskiest backend path).

This plan slices that work into **7 sequenced phases (0–6)**. Each phase is small enough for one coding agent to execute against a fresh context, produces a runnable artifact, and ends by writing a handoff doc into the repo so the next agent can pick up cold. Decisions already locked in step-7 (Next.js 15 + Drizzle + Neon + S3 + Fly worker + pg-boss + Anthropic Sonnet 4.6 + Textract + Resend) are inputs to every phase — this plan does not relitigate them.

Source design docs (read by every phase):
- [product-brief.md](C:/Repos/submittal-builder/product-brief.md) — MVP outcome + flow + scope
- [review-product-brief-md-we-are-quirky-cat.md](C:/Repos/submittal-builder/review-product-brief-md-we-are-quirky-cat.md) — data model
- [step-5-api-contract.md](C:/Repos/submittal-builder/step-5-api-contract.md) — HTTP API surface
- [step-6-wireframes.md](C:/Repos/submittal-builder/step-6-wireframes.md) — UI expectations on the API
- [step-7-stack-lockin.md](C:/Repos/submittal-builder/step-7-stack-lockin.md) — libraries, hosting, deployment

## Phasing principles

1. **De-risk, then scaffold, then layer.** Spikes first (Phase 0). Then the foundation other phases all need (Phase 1). Then features in dependency order. AI pipeline (Phase 4) is placed late because it depends on file handling (Phase 3) but before the audit-aware edit APIs (Phase 5) that operate on AI output.
2. **Every phase ships a runnable, testable slice.** No phase ends with broken `pnpm build` or skipped tests. Phase boundaries are integration points, not refactor cliffs.
3. **Every phase ends with a handoff doc** committed to the repo at `step-8-phase-N-handoff.md`. The doc states: what was built, where files live, what's stubbed vs. wired, what env vars/secrets were added, known gaps, and the exact starting point for the next phase. This is non-negotiable — the next agent boots cold from these docs.
4. **Tenancy is universal.** Workspace-scoping (permissions) is a Phase 1 concern wired into every query helper from day one. No phase adds an endpoint that bypasses tenancy.
5. **Audit/status threads through every phase.** `original_ai_value`, `edited_by_user_at`, `processing_status`, `package.status`, and `processing_jobs` rows are created in the phases that introduce the columns, but their invariants are listed in each phase's handoff doc.

## Phase 0 — Spikes & live-service provisioning

**Goal.** De-risk the two unknowns (PDF assembly, Anthropic accuracy) and stand up every external service before any product code is written. Per step-7 §16.

**Deliverables.**
- `spikes/pdf-pipeline/` throwaway script: take 3 real submittal PDFs (one text-native cut sheet, one scanned warranty, one engineering shop drawing) through pdfjs-dist (parse text) → Textract (OCR scanned pages) → pdf-lib (cover + TOC + merge + bookmarks + Bates stamp). Output a valid combined PDF. Snapshot the resulting structure (page count, bookmark titles, Bates ranges).
- `spikes/ai-classify-extract/` throwaway script: same 3 PDFs through Claude Sonnet 4.6 vision → `doc_type` classification + `manufacturer/model/description/spec_section_ref` extraction with tool use + prompt caching. Capture confidence per field. Record fixtures for later test mocking.
- Live services provisioned: Vercel project, Fly app (empty), Neon DB (prod + preview branching enabled), AWS S3 bucket per env (with CORS placeholder), AWS Textract enabled in `us-east-1`, Anthropic workspace + API key with spend cap, Resend domain verified, Sentry projects (web + worker), Cloudflare DNS proxied. Smoke test: web "hello world" and worker "hello world" deploy and can reach Postgres.
- `.env.example` checked in listing every env var by name (no values).

**Verification.** The pdf-pipeline spike produces an opening-in-Acrobat-without-errors combined PDF with a bookmark per source PDF and Bates numbering on every page. The AI spike produces structured JSON conforming to the `ItemAttribute` shape with confidences. All services respond to a smoke ping.

**Risks surfaced here.** If pdf-lib chokes on the real shop drawing PDF, qpdf fallback is added to the spike before Phase 1. If Sonnet classification accuracy is <80% on the 3-PDF set, the model dial is turned (Opus 4.7) before Phase 4 locks the prompt.

**Handoff doc.** `step-8-phase-0-handoff.md` includes: spike results (accuracy %, byte sizes, timings), all service URLs/IDs, env var matrix, qpdf fallback decision, AI model decision, ready-to-go checklist for Phase 1.

## Phase 1 — Scaffold, DB schema, auth, notifications, tenancy

**Goal.** The shared foundation every later phase consumes. After Phase 1 a developer can `pnpm dev`, sign up, log in, and hit a stub `/api/v1/me` returning the workspace.

**Deliverables.**
- Monorepo: pnpm workspaces with `apps/web` (Next.js 15 App Router, strict TS), `apps/worker` (Node 20 plain TS, pg-boss bootstrap, `/healthz` returns 200 only), `packages/db` (Drizzle schema + migrations + client), `packages/shared` (Zod schemas + types + AI prompts + PDF utils — empty stubs).
- Tooling: ESLint, Prettier, Vitest config, Playwright config (no tests yet), GitHub Actions CI that runs `lint + typecheck + vitest` on PR. Husky pre-commit (optional, only if it doesn't slow down dev).
- Drizzle schema in `packages/db/schema.ts` mapping every table from the data model: `workspaces, users, projects, packages, source_pdfs, source_pages, items, item_attributes, exports, processing_jobs` + all 5 enums + indexes. Plus better-auth's `sessions` and `accounts` tables (added in step-7 §3, not in step-4 data model).
- `packages/db/migrations/0001_init.sql` generated and applied to Neon dev branch via `drizzle-kit migrate`. CI step that fails the build if schema and migrations drift.
- `packages/db/seed.ts` — one workspace, one user (`demo@local`, known password), one project, one empty package. Used by local dev and integration tests.
- better-auth wired into `apps/web`: email + password signup/login/logout, argon2id hashing, sessions in Postgres, HTTP-only `Secure SameSite=Lax` cookies with 30-day rolling, CSRF token issued and validated per step-5 §"Conventions". Endpoints: `POST /api/v1/auth/signup`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/me`. Signup atomically creates workspace + first user (step-6 Screen 1).
- Workspace tenancy helper in `apps/web/src/server/`: every authenticated request resolves `workspace_id`; a `withWorkspace()` wrapper that filters queries by `workspace_id` and returns 404 (not 403) on cross-workspace IDs per step-5 §Conventions.
- Resend integration in `packages/shared/notifications/`: send signup verification email (token-based confirmation link) and password reset email. better-auth's email hooks wired to Resend. Plain-text templates fine at MVP.
- Sentry SDK installed on web + worker; smoke-tested by throwing on `/api/v1/debug-sentry` (removed after verification).

**Verification.** `pnpm dev` boots web + worker locally. A new user can sign up, receive a Resend verification email, log in, hit `/api/v1/me`, log out. `pnpm test` passes integration tests for signup → /me → logout. Drizzle Studio shows all tables. Migration runs idempotently on Neon dev branch.

**Critical files.**
- `apps/web/src/app/api/v1/auth/*` — better-auth handlers
- `apps/web/src/server/auth.ts` — better-auth config
- `apps/web/src/server/workspace.ts` — `withWorkspace()` tenancy helper
- `packages/db/schema.ts` — all tables
- `packages/db/migrations/0001_init.sql` — generated SQL
- `packages/shared/notifications/email.ts` — Resend client + templates

**Handoff doc.** `step-8-phase-1-handoff.md` lists: every directory created, env var matrix added beyond Phase 0 (BETTER_AUTH_SECRET, RESEND_API_KEY, etc.), the exact import path for the workspace helper, the auth test commands, what's NOT yet wired (no S3 calls, no workspace logo, no projects/packages endpoints).

## Phase 2 — Projects, packages, workspace, items skeleton CRUD

**Goal.** Implement every read/write endpoint from step-5 §1–4 and §7 that does not involve files or AI. Items get skeleton create/edit/delete; attributes table exists but is touched only manually for tests until Phase 4 populates it.

**Deliverables.**
- Zod schemas in `packages/shared/api/` for every request/response in step-5 §1–7. These become the source of truth — handlers import them, react-hook-form imports them, tests import them.
- Endpoints implemented (all under `apps/web/src/app/api/v1/`, all behind `withWorkspace()`):
  - `GET /workspace`, `PATCH /workspace` (no logo upload yet — handled Phase 3)
  - `GET/POST/GET-by-id/PATCH/DELETE /projects` (soft delete via `deleted_at`)
  - `GET/POST /projects/:projectId/packages`, `GET/PATCH/DELETE /packages/:id` (soft delete)
  - `GET /packages/:id/status` (returns `{ status, source_pdfs: [], jobs_summary: {queued:0, running:0, failed:0} }` — fully wired for status of an empty package, real values arrive in Phases 3–4)
  - `PATCH /items/:id`, `POST /packages/:id/items/reorder`, `DELETE /items/:id`, `POST /packages/:id/items` (manual create) — audit field semantics deferred to Phase 5
- Error envelope per step-5 §Conventions, idempotency-key shape on mutating endpoints (skeleton — actual idempotency enforced in Phase 4/6 where it matters).
- Integration tests with Vitest using a Neon preview branch per CI run (or a local Postgres via docker-compose in dev). Tests cover: tenancy (cross-workspace ID returns 404), soft-delete visibility, list filtering, validation errors.

**Verification.** Every endpoint in step-5 §1–4 and the simple subset of §7 returns the contract-shaped response. Bruno / Postman collection committed under `apps/web/tests/bruno/` reproduces the full create-project → create-package → list-packages flow. Tenancy test asserts: workspace A's user gets 404 (not 403) on workspace B's project ID.

**Critical files.**
- `apps/web/src/app/api/v1/projects/*`, `apps/web/src/app/api/v1/packages/*`, `apps/web/src/app/api/v1/items/*`
- `packages/shared/api/projects.ts`, `packages/shared/api/packages.ts`, etc. — Zod schemas
- `apps/web/tests/bruno/` — request collection

**Handoff doc.** `step-8-phase-2-handoff.md` lists: every endpoint implemented vs. stubbed, the contract-conformance matrix (one row per step-5 endpoint, status: done/stub/deferred), how to run the Bruno collection, known gaps (no file upload, no AI, no audit-aware item attribute edits).

## Phase 3 — File handling: S3 presigned uploads, source PDFs, source pages, downloads

**Goal.** A user can upload PDFs to a package, the server records them, parses page count + per-page text, and serves citations. No AI yet — but the data is fully prepared for it.

**Deliverables.**
- `packages/shared/storage/s3.ts` — S3 client + presign helpers (`presignPutUrl`, `presignGetUrl`) using `@aws-sdk/s3-request-presigner`. TTLs: 15 min upload, 5 min download per step-5. CORS configured on the bucket to allow PUT from the web origin (verified by an integration test).
- Endpoints:
  - `POST /workspace/logo/presign` + `POST /workspace/logo/confirm` (workspace logo round-trip).
  - `POST /packages/:id/source-pdfs/presign` — inserts `source_pdfs` row with `processing_status='uploaded'`, returns `{ source_pdf_id, upload_url, storage_key, expires_at, required_headers }` per step-5 §5.
  - `POST /packages/:id/source-pdfs/:sourcePdfId/confirm` — verifies S3 object exists (HEAD), fills `byte_size + sha256 + page_count`, **rejects with 409 on duplicate sha256 within the package**, parses page text via pdfjs-dist (Node build), inserts one `source_pages` row per page with `ocr_text` populated only if `text length >= 50 chars per page` (per step-7 §5 OCR heuristic), sets `has_ocr=true` where applicable. Does NOT enqueue processing yet — that's Phase 4.
  - `DELETE /source-pdfs/:id` — deletes the S3 object and the row. Blocked (409) if the source PDF is referenced by any non-soft-deleted export.
  - `GET /source-pages/:id/preview` — returns `{ image_url, ocr_text }`. If the rendered WebP is not yet in S3 at `workspaces/{ws}/page_previews/{source_page_id}.webp`, renders it lazily via pdfjs-dist rasterizer, uploads, then returns presigned URL. Cached on subsequent calls.
  - `GET /source-pdfs/:id/download` — presigned read URL for the full original PDF.
- Original-bytes invariant test: SHA-256 of a roundtrip (upload → download via presigned URL) equals the SHA-256 captured at confirm. Asserted in CI.
- The placeholder `GET /packages/:id/status` from Phase 2 is updated to reflect real `processing_status` of uploaded PDFs.

**Verification.** Bruno script: presign → PUT to S3 with the returned URL → confirm → list source-pdfs on the package → fetch a source page preview (server renders WebP first call) → download the original PDF and assert SHA-256 unchanged. Test passes locally and in CI against dev AWS.

**Critical files.**
- `apps/web/src/app/api/v1/packages/[id]/source-pdfs/*`
- `apps/web/src/app/api/v1/source-pdfs/[id]/*`, `apps/web/src/app/api/v1/source-pages/[id]/*`
- `apps/web/src/app/api/v1/workspace/logo/*`
- `packages/shared/storage/s3.ts`, `packages/shared/pdf/parse.ts` (pdfjs-dist wrapper), `packages/shared/pdf/render.ts` (page → WebP)

**Handoff doc.** `step-8-phase-3-handoff.md` covers: S3 bucket layout, CORS config (literal JSON committed under `infra/s3-cors.json`), presign helper API, page-preview cache key contract, what's still stubbed in `/packages/:id/status` (no AI status yet), and the exact starting point for Phase 4 (the `processing_status='uploaded'` rows are the input).

## Phase 4 — Worker, queue, and AI processing pipeline

**Goal.** Hit `POST /packages/:id/process` and ~2–3 minutes later the package has `items + item_attributes` rows populated with confidences, citations, and original AI values. This is the riskiest phase — Phase 0 spikes derisked the pieces; this phase wires them under pg-boss with real retries and idempotency.

**Deliverables.**
- `apps/worker/` fleshed out: pg-boss boot, topic subscribers, structured JSON logging, `/healthz` returning queue depth + recent error rate, graceful shutdown.
- pg-boss topics + workers: `ocr`, `classify`, `extract`, `batch_order`. Concurrency from step-7 §7 (`ocr:4, classify:8, extract:8`). Per-topic retry: max 3 with exponential backoff. Job key for idempotency: `(kind, source_pdf_id)` — duplicate enqueues become no-ops.
- `processing_jobs` table rows written on every job state change (one row per attempt). pg-boss's internal tables are auxiliary; our app owns the audit-friendly row.
- Worker logic:
  - **OCR job.** For source PDFs where any `source_pages.has_ocr=false`, call Textract `StartDocumentTextDetection` (async; sync-only for ≤5 pages). Poll until done; backfill `source_pages.ocr_text` + `has_ocr=true`. Persist the raw Textract response in S3 at `workspaces/{ws}/textract_raw/{source_pdf_id}.json` for future re-use.
  - **Classify job.** Render up to 3 sample pages (first, middle, last) to PNG ≤1568px wide. Call Sonnet 4.6 with vision + tool use → `{ doc_type, confidence }`. Prompt caching ON for the system prompt + few-shot exemplars. Store on a draft `items` row keyed by `source_pdf_id` (one item per source PDF until batch_order regroups).
  - **Extract job.** Render all pages to PNG. Call Sonnet 4.6 with vision + tool use → `{ manufacturer, model_number, description, spec_section_ref }` each with `{ value, confidence, source_page_id }`. Zod-validate the response against `ItemAttribute` shape. Write `item_attributes` rows with both `current_value` and `original_ai_value` set to the AI value (immutability of `original_ai_value` is locked in here).
  - **Batch_order job (per package).** Group multi-file products via heuristic on extracted attributes (same `manufacturer + model_number` → merge items, point all related `source_pdfs.item_id` to the merged item). Set `items.sort_order` ascending by `spec_section_ref` (alphanumeric), then by `manufacturer`. Set `packages.status='ready'`.
- `POST /packages/:id/process` (web) — enqueues OCR → classify → extract → batch_order job chain. Idempotent: re-calling on a `processing` or `ready` package is a no-op for already-completed source PDFs.
- `GET /packages/:id/status` (web) — now returns real values aggregated from `source_pdfs.processing_status` + `processing_jobs`.
- Anthropic SDK retry: 3 attempts with exponential backoff on 429/529 per step-7 §6. Persistent failures bubble up as `processing_status='error'` + `processing_error` text on the relevant `source_pdfs` row.
- Recorded Anthropic + Textract fixtures used in tests (no live API calls in CI).

**Verification.** Bruno + scripted flow: upload 2 real PDFs → confirm → process → poll `/status` until `package.status='ready'` → fetch items → assert each item has populated attributes with confidences and source_page_id citations and original_ai_value matching current_value. Worker `/healthz` returns sane queue depth. Manually break the Anthropic key, retry, observe `processing_status='error'`.

**Critical files.**
- `apps/worker/src/index.ts` — boot + pg-boss
- `apps/worker/src/jobs/ocr.ts`, `classify.ts`, `extract.ts`, `batch_order.ts`
- `apps/web/src/app/api/v1/packages/[id]/process/route.ts`
- `packages/shared/ai/prompts.ts` — system prompts + few-shot exemplars (prompt-cache eligible)
- `packages/shared/ai/anthropic.ts` — SDK wrapper with retry + caching headers
- `packages/shared/ocr/textract.ts` — Textract wrapper

**Handoff doc.** `step-8-phase-4-handoff.md` includes: pipeline diagram (ASCII), retry/backoff matrix, observability hooks (where to look in Sentry for AI failures), accuracy notes from running 3+ real packages, prompt-cache hit-rate observation, dead-letter inspection query, and the exact starting point for Phase 5 (items exist and need audit-aware edits).

## Phase 5 — Audit-aware item APIs + export pipeline

**Goal.** The endpoints driving the package editor (step-6 Screen 5) honor the audit invariants from the data model, and `POST /packages/:id/exports` produces a downloadable PDF matching step-6 Screen 7.

**Deliverables.**
- Item edit endpoints (upgrade Phase 2 skeletons to audit-aware):
  - `PUT /items/:id/attributes/:key` — sets `current_value`, **never touches `original_ai_value`**, stamps `edited_by_user_at=now()`.
  - `POST /items/:id/attributes/:key/revert` — sets `current_value=original_ai_value`, clears `edited_by_user_at`.
  - `PATCH /items/:id` — on `doc_type` change, copies the existing `doc_type` into `doc_type_original_ai_value` (only if `doc_type_original_ai_value IS NULL`), then sets the new `doc_type`.
  - `POST /packages/:id/items/reorder` — atomic bulk update of `sort_order`.
  - `PATCH /source-pdfs/:id { item_id }` — reassign within the same package.
- Read-only-after-export enforcement: when `packages.status='exported'`, all item mutation endpoints return 409 `package_exported`. The client uses this to render the "Create R1 to edit" banner.
- Item list endpoint enrichment: `GET /packages/:id/items` returns the structure step-5 §6 specifies, including per-attribute `confidence`, `source_page_id`, `original_ai_value`, `edited_by_user_at`.
- Export pipeline:
  - `POST /packages/:id/exports { bates_prefix? }` — inserts an `exports` row with `status='pending'`, enqueues a `render_export` pg-boss job. Returns `{ export_id }`.
  - Worker `render_export` job: fetch package + items + source_pdfs from DB. Build cover sheet PDF via pdf-lib (workspace logo from S3, cover-sheet metadata fields, empty stamp boxes). Build TOC PDF via pdf-lib (one entry per item, clickable internal link to bookmarked page). Merge: cover → TOC → source PDFs in `sort_order`, **copying pages by reference** (pdf-lib `copyPages`, no re-encoding). Generate outline (one bookmark per item, pointing at the item's first page in the assembled PDF). Stamp Bates numbering in the bottom margin of every page (`{prefix}{6-digit-zero-padded-page-number}`) without modifying source content streams. Upload to `workspaces/{ws}/exports/{export_id}.pdf`. Update `exports` row: `status='ready'`, `byte_size`, `page_count`. Update `packages.latest_export_id` and `packages.status='exported'`.
  - qpdf fallback: if pdf-lib throws on a malformed source PDF, retry that PDF after running `qpdf --linearize` on it (in a temp file in the worker container) before merging. Logged to Sentry as a `pdf_repair_used` event.
  - `GET /exports/:id`, `GET /exports/:id/download`, `GET /packages/:id/exports`.
- Snapshot tests on assembled output **structure** (page count = cover + TOC + sum of source page counts; bookmark titles match item titles in order; Bates range = `1..N`) — NOT byte-level diffs (per step-7 §10).

**Verification.** End-to-end backend smoke: signup → project → package → upload 2 real PDFs → process → list items → edit one attribute → export → poll until ready → download. Open the downloaded PDF in Acrobat: cover sheet renders with workspace logo, TOC is clickable, bookmarks pane shows one entry per item, every page is Bates-numbered, source PDFs are present and unaltered (SHA-256 of extracted source page byte-streams matches originals). Second edit attempt on the exported package returns 409.

**Critical files.**
- `apps/web/src/app/api/v1/items/[id]/*` — audit-aware handlers
- `apps/web/src/app/api/v1/packages/[id]/exports/route.ts`
- `apps/web/src/app/api/v1/exports/[id]/*`
- `apps/worker/src/jobs/render_export.ts`
- `packages/shared/pdf/assemble.ts` — pdf-lib cover + TOC + merge + bookmarks + Bates
- `packages/shared/pdf/repair.ts` — qpdf fallback

**Handoff doc.** `step-8-phase-5-handoff.md` lists: audit-field semantics table (which fields are immutable post-create vs. mutable, with the exact code path that enforces each), export structure spec with a sample assembled-PDF report, qpdf-fallback trigger conditions, read-only-after-export error code, performance numbers on a 200-page package render, and gaps (revision diff is V1.1, multi-product split is V1.1).

## Phase 6 — Observability, end-to-end smoke, frontend handoff

**Goal.** The backend is shippable. Frontend  can start without backend churn. Operational hooks are in place to catch failures in pilot.

**Deliverables.**
- Sentry source maps uploaded on every deploy (Vercel + Fly). Test by deliberately throwing and confirming the deminified trace lands in Sentry.
- Structured JSON logs everywhere; every request gets a `request_id` propagated from web → enqueued job → worker logs.
- Worker `/healthz` returns `{ queue_depth_by_topic, error_rate_5m, oldest_job_age_s }`. Fly `[checks]` hits it every 15s.
- Uptime GitHub Action: hits `https://<web>/api/v1/healthz` and `https://<worker>/healthz` every 5 min, fails the workflow on non-200.
- Admin SQL snippets committed under `docs/ops/queries.sql`: failed jobs in last 24h, slowest exports, stuck `processing` packages, dead-letter contents. No admin UI at MVP (per scope).
- Full end-to-end backend smoke script under `apps/web/tests/e2e-backend.sh`: signup → project → package → upload 2 PDFs → process → poll → edit one attribute → export → poll → download → assert SHA-256s. Runs in CI on a Neon preview branch.
- A short "what the backend exposes" doc at `step-8-final-handoff.md` for the frontend agent: every endpoint with its Zod schema location in `packages/shared`, the polling cadence assumptions, the read-only-after-export contract, where to find AI fixtures for component tests, env vars the frontend needs.

**Verification.** The smoke script passes locally + CI. Sentry receives a deliberately-thrown error in deminified form. Uptime workflow runs green. A senior dev can read `step-8-final-handoff.md` and have enough context to start without re-reading every phase doc.

**Critical files.**
- `.github/workflows/uptime.yml`
- `docs/ops/queries.sql`
- `apps/web/tests/e2e-backend.sh`
- `step-8-final-handoff.md`

**Handoff doc.** This phase's handoff IS `step-8-final-handoff.md` — the backend-complete summary for whoever picks up. References every prior phase handoff for detail.

## Phase boundary rules (apply to every phase)

- Phase ends only when: (a) every deliverable is merged, (b) the verification script passes in CI, (c) the handoff doc is written, reviewed for "could a cold agent start from this?", and committed.
- Each handoff doc has the same sections: **What was built**, **Where it lives** (file paths), **Env vars/secrets added**, **What is stubbed/deferred**, **Known gaps and risks**, **Next phase starting point** (specific files, commands, and test fixtures).
- If a phase blows its scope mid-execution, the executing agent stops, writes a partial handoff doc explaining what landed, and the plan is re-cut — no silent scope creep.

## Files to be created (planning-level inventory)

Phase plans, in repo (created during execution, not now):
- `step-8-phase-0-handoff.md` through `step-8-phase-5-handoff.md`
- `step-8-final-handoff.md`

Code (created in respective phases — listed here so reviewers can spot omissions):
- Phase 1: `package.json` (root + per workspace), `pnpm-workspace.yaml`, `apps/web/`, `apps/worker/`, `packages/db/`, `packages/shared/`, `.github/workflows/ci.yml`, `.env.example`, `infra/`
- Phase 2: `apps/web/src/app/api/v1/{projects,packages,items,workspace,me}/`, `packages/shared/api/`, `apps/web/tests/bruno/`
- Phase 3: `apps/web/src/app/api/v1/{source-pdfs,source-pages}/`, `packages/shared/{storage,pdf}/parse.ts,render.ts`, `infra/s3-cors.json`
- Phase 4: `apps/worker/src/{index.ts,jobs/}`, `packages/shared/{ai,ocr}/`, `apps/web/src/app/api/v1/packages/[id]/process/route.ts`
- Phase 5: `apps/web/src/app/api/v1/{items/[id]/**,exports/[id]/**,packages/[id]/exports/**}/`, `apps/worker/src/jobs/render_export.ts`, `packages/shared/pdf/{assemble,repair}.ts`
- Phase 6: `.github/workflows/uptime.yml`, `docs/ops/queries.sql`, `apps/web/tests/e2e-backend.sh`

## Verification of the plan itself

Sanity checks before kicking off Phase 0:

1. **Every step-5 endpoint is covered in some phase.** Check the contract-conformance matrix in the Phase 2 and Phase 3 and Phase 5 handoffs — together they should hit every row of step-5 §10.
2. **Every data model column is written somewhere.** `original_ai_value` (Phase 4), `edited_by_user_at` (Phase 5), `processing_status` (Phase 3 sets `uploaded`, Phase 4 transitions), `latest_export_id` (Phase 5), `doc_type_original_ai_value` (Phase 5 on reclassify).
3. **Every step-6 wireframe affordance has an API.** Already mapped in step-6 §"Screen-to-API map"; the phases cover all of them.
4. **The 10-minute budget is plausible.** Phase 4 verification times one real package end-to-end; if it exceeds ~5 min for processing alone (the 2–3 min budget × 2 safety factor), the prompt-caching or concurrency dials get turned before Phase 5 starts.
5. **No phase is doing two distinct things.** Phase 1 does foundation; Phase 2 does CRUD; Phase 3 does files; Phase 4 does AI; Phase 5 does audit + export; Phase 6 does ops. If a future agent finds itself blending two phases, that's a signal to re-cut.
