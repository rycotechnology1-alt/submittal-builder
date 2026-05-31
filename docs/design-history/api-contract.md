# MVP API Contract — Submittal Builder (Step 5)

## Context

Step 4 locked the data model (see `review-product-brief-md-we-are-quirky-cat.md`). This document defines the **HTTP API contract** that sits between the web client and the server — the surface needed to drive the critical user flow in brief §8 (create package → upload PDFs → AI processing → review/edit → cover sheet → export).

**Confirmed via clarifying questions:** REST + JSON; polling for async AI processing; presigned S3 URLs for direct browser → S3 upload; HTTP-only session cookies for auth.

**Why this shape:**

1. **Stack-agnostic.** Step 7 hasn't locked the framework. REST + OpenAPI-style contracts work whether the backend ends up Next.js route handlers, Fastify, or Hono.
2. **The 10-minute budget.** Upload is the longest fixed cost; presigned-direct-to-S3 avoids API ingress bottlenecks. Polling at 2–3 s during the 2–3-min processing window is well within budget and cheap.
3. **Citations are first-class** (carried over from Step 4). Every item-attribute response includes `source_page_id`; a dedicated endpoint returns a presigned URL to render that specific page when the user clicks the citation.
4. **Original bytes preserved.** No endpoint mutates `source_pdfs.storage_key` content. Re-uploads create new rows.

## Conventions

- **Base path:** `/api/v1`
- **Auth:** all endpoints except `/auth/*` require a valid session cookie. 401 if missing/expired.
- **Tenancy:** every authenticated request resolves a `workspace_id` from the session. The server filters all resource queries by that workspace; cross-workspace IDs in URLs return 404.
- **Content type:** `application/json` for request and response bodies (presigned uploads use whatever S3 expects).
- **IDs:** UUIDs in path params and bodies.
- **Timestamps:** ISO-8601 UTC strings.
- **Errors:** `{ "error": { "code": "snake_case_code", "message": "human readable", "details"?: {...} } }`. HTTP status reflects category (400 / 401 / 403 / 404 / 409 / 422 / 500).
- **Idempotency:** mutating endpoints that kick off jobs (`/process`, `/exports`) accept an optional `Idempotency-Key` header.
- **CSRF:** non-`GET` endpoints require an `X-CSRF-Token` header matching a cookie-issued token.

---

## 1. Auth & session

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | Create workspace + first user. Body: `{ email, password, name, workspace_name, sub_company_name }`. Sets session cookie. |
| POST | `/auth/login` | Body: `{ email, password }`. Sets session cookie. |
| POST | `/auth/logout` | Invalidates session. |
| GET | `/me` | Returns `{ user, workspace }`. Used by the client on boot. |

## 2. Workspace

| Method | Path | Purpose |
|---|---|---|
| GET | `/workspace` | Current workspace including `sub_company_name`, `sub_company_logo_url` (presigned read URL). |
| PATCH | `/workspace` | Body: partial `{ name?, sub_company_name? }`. |
| POST | `/workspace/logo/presign` | Returns `{ upload_url, storage_key, headers }` for direct S3 PUT. |
| POST | `/workspace/logo/confirm` | Body: `{ storage_key }`. Validates the object exists and updates `workspaces.sub_company_logo_storage_key`. |

## 3. Projects

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List non-deleted projects in workspace. Supports `?q=` for name search. |
| POST | `/projects` | Body: `{ name, project_number?, gc_name?, architect_name? }`. |
| GET | `/projects/:id` | Includes a summary of packages: `{ project, packages: [{id, submittal_number, revision, status, updated_at}] }`. |
| PATCH | `/projects/:id` | Partial update. |
| DELETE | `/projects/:id` | Soft delete (`deleted_at`). |

## 4. Packages

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects/:projectId/packages` | List packages in project. |
| POST | `/projects/:projectId/packages` | Body: `{ submittal_number, spec_section, revision?, submittal_date?, title? }`. Defaults `revision='R0'`, `status='draft'`. |
| GET | `/packages/:id` | Full package — cover-sheet fields + counts (`source_pdf_count`, `item_count`, `latest_export`). Not the items array (see §6 for that). |
| PATCH | `/packages/:id` | Edit cover-sheet metadata. |
| DELETE | `/packages/:id` | Soft delete. |
| GET | `/packages/:id/status` | **Poll target.** Cheap response: `{ status, source_pdfs: [{id, processing_status, processing_error?}], jobs_summary: {queued, running, failed} }`. Client polls every 2–3 s during processing. |

## 5. Source PDF uploads

Two-step presigned flow per file:

| Method | Path | Purpose |
|---|---|---|
| POST | `/packages/:id/source-pdfs/presign` | Body: `{ filename, byte_size, content_type, sha256? }`. Server inserts a `source_pdfs` row with `processing_status='uploaded'` pending confirm; returns `{ source_pdf_id, upload_url, storage_key, expires_at, required_headers }`. |
| POST | `/packages/:id/source-pdfs/:sourcePdfId/confirm` | Verifies the S3 object exists, fills `byte_size` + `sha256` + `page_count`. Does **not** kick off processing yet (see §6). |
| DELETE | `/source-pdfs/:id` | Removes the PDF (also deletes S3 object). Disallowed once linked to an exported package. |

Notes:
- Client uploads in parallel; max 5 concurrent recommended.
- Presigned URLs expire in 15 min. Resumable uploads are out of scope at MVP.
- On dup `sha256` within a package, server returns 409 with the existing `source_pdf_id`.

## 6. Processing pipeline

| Method | Path | Purpose |
|---|---|---|
| POST | `/packages/:id/process` | Kicks off the AI pipeline for any source PDFs in `processing_status='uploaded'`. Idempotent. Returns `{ jobs_enqueued: N }`. |
| GET | `/packages/:id/status` | (Same as §4 — poll for progress.) |
| GET | `/packages/:id/items` | After processing, the TOC. Returns `[{ item, attributes: [{key, current_value, original_ai_value, confidence, source_page_id, edited_by_user_at}], source_pdfs: [{id, original_filename, page_count}] }]` ordered by `sort_order`. |

The pipeline (server-internal, not exposed):

```
confirm upload → enqueue OCR job → enqueue classify job
              → enqueue extract job → batch_order job (groups PDFs into items, sets sort_order)
              → packages.status = 'ready'
```

## 7. Item / TOC editing

The review-and-edit screen (brief §8 step 4) drives most of these.

| Method | Path | Purpose |
|---|---|---|
| GET | `/packages/:id/items` | (§6) |
| PATCH | `/items/:id` | Body: partial `{ title?, doc_type?, sort_order? }`. Reclassifying `doc_type` preserves `doc_type_original_ai_value`. |
| POST | `/packages/:id/items/reorder` | Body: `{ order: [{ item_id, sort_order }] }`. Atomic bulk update for drag-reorder. |
| DELETE | `/items/:id` | Removes from TOC (soft delete). The underlying `source_pdfs` rows remain and become reassignable. |
| PUT | `/items/:id/attributes/:key` | Body: `{ value }`. Sets `current_value`, leaves `original_ai_value` untouched, stamps `edited_by_user_at`. |
| POST | `/items/:id/attributes/:key/revert` | Sets `current_value = original_ai_value`, clears `edited_by_user_at`. |
| POST | `/packages/:id/items` | Manual create (for the rare "AI missed a section" case). Body: `{ source_pdf_ids: [...], doc_type, title, attributes: { manufacturer?, model_number?, description?, spec_section_ref? } }`. |
| PATCH | `/source-pdfs/:id` | Body: `{ item_id }`. Reassigns a PDF to a different item (within the same package). |

## 8. Citation preview

When the user clicks a confidence badge or source-page link in the editor, the client needs to show that specific page.

| Method | Path | Purpose |
|---|---|---|
| GET | `/source-pages/:id/preview` | Returns `{ image_url, ocr_text }`. `image_url` is a presigned URL to a rasterized page image (generated lazily, cached). |
| GET | `/source-pdfs/:id/download` | Returns `{ url }` — presigned S3 read for the full original PDF. |

## 9. Export

Export rendering may take 10–30 s for a 200-page package. Same poll pattern as processing.

| Method | Path | Purpose |
|---|---|---|
| POST | `/packages/:id/exports` | Body: `{ bates_prefix? }`. Enqueues render. Returns `{ export_id }`. Updates `packages.status='exported'` on success. |
| GET | `/packages/:id/exports` | List of past exports (newest first). |
| GET | `/exports/:id` | `{ id, status: 'pending'|'rendering'|'ready'|'failed', byte_size?, page_count?, created_at, error? }`. Client polls this. |
| GET | `/exports/:id/download` | Returns `{ url }` — presigned S3 read for the rendered PDF. |

## 10. Endpoint-to-flow trace

A sanity check against brief §8:

| Flow step | Endpoints called |
|---|---|
| 1. Create package | `POST /projects` (if new) → `POST /projects/:id/packages` |
| 2. Upload PDFs | `POST /packages/:id/source-pdfs/presign` ×N → direct S3 PUT ×N → `POST /packages/:id/source-pdfs/:id/confirm` ×N |
| 3. AI ingest | `POST /packages/:id/process` → poll `GET /packages/:id/status` |
| 4. Review & edit | `GET /packages/:id/items` → `PATCH /items/:id`, `PUT /items/:id/attributes/:key`, `POST /packages/:id/items/reorder`, `GET /source-pages/:id/preview` |
| 5. Cover sheet | `PATCH /packages/:id` |
| 6. Export | `POST /packages/:id/exports` → poll `GET /exports/:id` → `GET /exports/:id/download` |
| 7. Download | Browser follows the presigned URL |

Every step in the flow is covered; nothing requires a new endpoint at MVP.

## 11. Out of scope at MVP (deliberately not in the contract)

- `/spec-documents/*` — V1.1.
- `/items/:id/annotations` — V1.1 (highlight/callout).
- `/packages/:id/duplicate` for revision cloning — V1.1.
- `/admin/*` — no admin surface yet.
- `/webhooks/*` — no third-party integrations.
- Public API keys / OAuth client credentials — no programmatic clients.

## 12. Forward-compatibility notes

- **Pagination.** List endpoints (`GET /projects`, `GET /projects/:id/packages`) return arrays directly at MVP. Wrap in `{ data, next_cursor }` envelope before any list could exceed ~200 items — easy non-breaking change if clients accept either shape from day 1. *Recommendation: ship the envelope shape from day 1.*
- **SSE upgrade path.** Adding `GET /packages/:id/events` (text/event-stream) later doesn't require deprecating the polling endpoint. They coexist.
- **Field versioning.** `/api/v1` prefix is the only versioning lever. Treat additive fields as non-breaking; removals require `/api/v2`.

## Verification

Before approving Step 6 (wireframes):

1. **Round-trip the flow trace** in §10 against §11 (the OUT list). If any wireframe needs an endpoint not listed here, decide whether to add it or drop the UX.
2. **Mock the contract.** Stand up a stub server (Mock Service Worker or similar) returning fixture data for `GET /packages/:id`, `GET /packages/:id/items`, `GET /packages/:id/status`. Confirm the polling cadence and item-shape feel right when wired to a paper prototype.
3. **Trace error cases.** For each mutating endpoint, name the failure modes (400 validation, 401 unauth, 403 cross-workspace, 404 not-found, 409 dup, 422 business rule, 500 worker dead) and which return what.
4. **Once implemented:** smoke test the full flow with `curl` / Bruno / Postman before any UI is built — create a project, presign + upload a small PDF, confirm, process, poll until ready, list items, edit one attribute, export, download.
