# MVP Data Model — Submittal Builder

## Context

Greenfield project at `C:\Repos\submittal-builder` — only `product-brief.md` exists. The brief locks Steps 1–3 of the MVP roadmap (outcome, critical user flow, scope) and explicitly defers the **Step 4: Data Model** to be specified next. This plan defines the relational schema that will back the MVP and leave room for V1.1 (spec compliance, multi-product splitting, callouts, revision diffs).

**Why this shape:** the brief makes three commitments that drive the model:

1. **Citations are first-class** — every AI-extracted attribute must link to a specific source page with a confidence score. Retrofitting this is painful.
2. **Original PDF bytes preserved** — source PDFs are immutable evidence; the rendered submittal is a separate artifact assembled around them.
3. **V1.1 headline is spec compliance** — item records must be structured and machine-readable from day one, not just rendered TOC strings.

**Confirmed via clarifying questions:** Workspace as the tenancy root (solo at MVP, future-proof for teams/billing); Items relate N:1 to source PDFs at MVP (many PDFs can compose one Item; V1.1 will relax to N:N for split catalogs); attributes stored in a normalized `item_attributes` table; original AI values retained alongside user edits from day 1.

**Assumptions made (call out if wrong):** Postgres + UUID PKs; S3-compatible blob storage; soft-delete via `deleted_at` on Project and Package only; sub company / logo at workspace level (no per-package override at MVP); CSI spec section stored as a plain string at MVP (no lookup table); each export persisted as its own row so users can re-download prior renderings.

---

## Entity overview

```
Workspace (1) ──< User (1+)
   │
   └──< Project (0+) ──< Package (0+) ──< SourcePdf (0+) ──< SourcePage (1+)
                            │                  │
                            │                  └── item_id (FK → Item, nullable until classified)
                            │
                            ├──< Item (0+) ──< ItemAttribute (0+, FK to SourcePage for citation)
                            │
                            └──< Export (0+)

V1.1 placeholders (not built, names reserved):
   SpecDocument, SpecRequirement, ItemSourcePage (N:N join to replace SourcePdf.item_id)
```

## Tables (MVP)

### `workspaces`
Top-level tenancy root. One workspace per paying customer; solo user at MVP.
- `id` uuid PK
- `name` text
- `sub_company_name` text — default for cover sheet
- `sub_company_logo_storage_key` text nullable — S3 key for uploaded logo
- `created_at`, `updated_at` timestamptz

### `users`
- `id` uuid PK
- `workspace_id` uuid FK → workspaces (N:1, but 1:1 at MVP)
- `email` citext unique
- `password_hash` text
- `name` text
- `created_at`, `updated_at`

### `projects`
Lightweight project entity; metadata reused across packages.
- `id` uuid PK
- `workspace_id` uuid FK (denormalized for tenancy filtering / future RLS)
- `name` text
- `project_number` text nullable
- `gc_name` text nullable
- `architect_name` text nullable
- `created_at`, `updated_at`, `deleted_at` (soft delete)

### `packages`
One submittal package = one row.
- `id` uuid PK
- `workspace_id` uuid (denormalized)
- `project_id` uuid FK
- `submittal_number` text — e.g. `09 51 13-001`
- `spec_section` text — CSI MasterFormat code, e.g. `09 51 13`
- `revision` text default `'R0'` — R0/R1/R2/… (revision *diff* deferred to V1.1; the field itself is MVP)
- `submittal_date` date nullable
- `title` text nullable
- `status` enum `package_status` — `draft | processing | ready | exported`
- `latest_export_id` uuid FK → exports nullable
- `created_at`, `updated_at`, `deleted_at`

### `source_pdfs`
Each uploaded PDF, stored immutably in S3. Bytes never re-encoded.
- `id` uuid PK
- `package_id` uuid FK
- `workspace_id` uuid (denormalized)
- `storage_key` text — S3 key
- `original_filename` text
- `byte_size` bigint
- `sha256` text — exact-dup detection
- `page_count` int nullable (filled after ingest)
- `processing_status` enum `pdf_processing_status` — `uploaded | ocr_running | classifying | extracted | error`
- `processing_error` text nullable
- `item_id` uuid FK → items nullable — set once AI groups PDF into an Item; N:1 (many PDFs → one Item). V1.1 will replace this with an `item_source_pages` join table.
- `created_at`, `updated_at`

### `source_pages`
One row per page of every source PDF — citation targets and OCR storage.
- `id` uuid PK
- `source_pdf_id` uuid FK
- `page_number` int — 1-indexed within the source PDF
- `ocr_text` text nullable — full text extracted (OCR or native)
- `has_ocr` boolean default false
- `created_at`
- Unique `(source_pdf_id, page_number)`

### `items`
One TOC entry / logical product unit. Created by the AI batch step after PDFs are classified and grouped.
- `id` uuid PK
- `package_id` uuid FK
- `workspace_id` uuid (denormalized)
- `doc_type` enum `item_doc_type` — `product_data | shop_drawing | sds | warranty | installation | test_report | other`
- `doc_type_confidence` float nullable — 0..1
- `doc_type_original_ai_value` text nullable — preserves AI suggestion if user reclassifies
- `sort_order` int — drag-reorder position within package; default by spec section ascending
- `title` text — TOC display title; may be user-edited
- `created_at`, `updated_at`, `deleted_at`

### `item_attributes`
Normalized AI-extracted attributes. Each row carries its own citation + confidence + audit trail.
- `id` uuid PK
- `item_id` uuid FK
- `key` text — e.g. `manufacturer`, `model_number`, `description`, `spec_section_ref` (MVP set; extensible without migration)
- `current_value` text nullable
- `original_ai_value` text nullable — never overwritten; powers audit + accuracy metrics
- `confidence` float nullable — 0..1
- `source_page_id` uuid FK → source_pages nullable — the citation
- `edited_by_user_at` timestamptz nullable
- `created_at`, `updated_at`
- Unique `(item_id, key)`

### `exports`
Persist every rendered PDF so the user can re-download prior versions.
- `id` uuid PK
- `package_id` uuid FK
- `created_by_user_id` uuid FK → users
- `storage_key` text — S3 key of rendered combined PDF
- `byte_size` bigint
- `page_count` int
- `bates_prefix` text nullable
- `created_at`

### `processing_jobs`
Lightweight queue/audit table for the async AI pipeline. Lets workers retry, gives the UI a status feed during the 2–3-minute processing budget.
- `id` uuid PK
- `package_id` uuid FK
- `source_pdf_id` uuid FK nullable
- `kind` enum `job_kind` — `ocr | classify | extract | batch_order`
- `status` enum `job_status` — `queued | running | succeeded | failed`
- `attempts` int default 0
- `error` text nullable
- `started_at`, `finished_at` timestamptz nullable
- `created_at`

## Enums

- `package_status`: `draft, processing, ready, exported`
- `pdf_processing_status`: `uploaded, ocr_running, classifying, extracted, error`
- `item_doc_type`: `product_data, shop_drawing, sds, warranty, installation, test_report, other`
- `job_kind`: `ocr, classify, extract, batch_order`
- `job_status`: `queued, running, succeeded, failed`

## Indexes (MVP)

- `projects (workspace_id, deleted_at)`
- `packages (project_id, deleted_at)`, `packages (workspace_id, status)`
- `source_pdfs (package_id)`, `source_pdfs (sha256)` for dedup
- `source_pages (source_pdf_id, page_number)` already unique
- `items (package_id, sort_order)`
- `item_attributes (item_id, key)` already unique; partial index on `(key)` where `key = 'spec_section_ref'` to accelerate V1.1 cross-package queries.
- `processing_jobs (package_id, status)`, `processing_jobs (status, kind)` for the worker poll loop

## V1.1 forward-looking notes (do NOT build, but design tolerates)

- **Spec compliance** — add `spec_documents` (uploaded project spec PDFs per project) and `spec_requirements` (extracted per-CSI-section requirements). Joins to `item_attributes` via `spec_section_ref` value.
- **Multi-product PDF splitting** — replace `source_pdfs.item_id` with a `item_source_pages (item_id, source_page_id, sort_order)` join table; existing rows migrate trivially since each PDF currently maps to exactly one Item and all its pages.
- **Highlight/callout annotations** — new `item_annotations` table referencing `source_page_id` + bounding box JSON. The page-level row already exists.
- **Revision diff** — `packages` already carries `revision`; add a nullable `parent_package_id` FK for clone-from-prior.
- **Audit log** — `original_ai_value` is the foundation; later add an `attribute_edits` history table only if a full edit timeline is needed.

## Critical files to create

Greenfield, so all new. The schema lives in whichever migration tool the chosen stack uses (Prisma / Drizzle / SQL). Suggested layout once Step 7 locks the stack:

- `db/migrations/0001_init.sql` — tables and enums above
- `db/schema.ts` (or `prisma/schema.prisma`) — ORM model matching the SQL
- `db/seed.ts` — a demo workspace + user for local dev

No existing utilities to reuse; this is the foundation.

## Verification

Data-model verification is mostly review-and-walkthrough, not running code. Before approving Step 5 (API contract), check:

1. **Trace the critical user flow against the schema.** For each of the 7 flow steps in brief §8, name which tables get written/read. Any step that can't be expressed = a gap.
2. **Cite every AI output.** Pick three example AI extractions (manufacturer, doc_type, spec_section_ref) and confirm each has a path to a `source_page_id`.
3. **Original-bytes invariant.** Confirm no field on `source_pdfs` or `source_pages` is mutated post-ingest except `processing_status` / `processing_error` / OCR backfill.
4. **V1.1 migration sketch.** On paper, write the migration that swaps `source_pdfs.item_id` for the `item_source_pages` join. If it's not a 10-line migration, the MVP shape is wrong.
5. **Once implemented:** seed a demo workspace, insert a fake package with two source PDFs and three items, render the TOC query, and confirm the joined output matches what the editor screen will need.
