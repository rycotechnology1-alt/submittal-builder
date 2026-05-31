# Phase 2 Handoff - Projects, packages, workspace, items skeleton CRUD

Phase 2 implements the non-file, non-AI API layer from the Step 8 build plan. A signed-in user can update workspace metadata, create/list/update/delete projects and packages, poll the empty-package status stub, and manually create/list/update/reorder/delete item skeletons.

## What was built

- Shared Zod API contracts in `packages/shared/src/api/` for common envelopes, workspace, projects, packages, and items.
- Contract helpers in `apps/web/src/server/api.ts` for JSON parsing, validation errors, UUID path checks, and response utilities.
- Snake-case HTTP response mappers and tenancy-aware lookup helpers in `apps/web/src/server/phase2-records.ts`.
- Authenticated route handlers under `apps/web/src/app/api/v1/`:
  - `GET/PATCH /workspace`
  - `GET/POST /projects`
  - `GET/PATCH/DELETE /projects/:id`
  - `GET/POST /projects/:projectId/packages`
  - `GET/PATCH/DELETE /packages/:id`
  - `GET /packages/:id/status`
  - `GET/POST /packages/:id/items`
  - `POST /packages/:id/items/reorder`
  - `PATCH/DELETE /items/:id`
- Phase 2 integration coverage in `apps/web/tests/phase2.integration.test.ts`.
- Bruno CRUD collection in `apps/web/tests/bruno/`.

## Endpoint status matrix

| Step 5 endpoint | Phase 2 status |
|---|---|
| `GET /workspace` | Done; logo URL is `null` until Phase 3 |
| `PATCH /workspace` | Done |
| `POST /workspace/logo/presign` | Deferred to Phase 3 |
| `POST /workspace/logo/confirm` | Deferred to Phase 3 |
| `GET /projects` | Done; returns `{ data, next_cursor: null }` |
| `POST /projects` | Done |
| `GET /projects/:id` | Done |
| `PATCH /projects/:id` | Done |
| `DELETE /projects/:id` | Done; project-only soft delete |
| `GET /projects/:projectId/packages` | Done; deleted parent project returns 404 |
| `POST /projects/:projectId/packages` | Done |
| `GET /packages/:id` | Done; counts included, `latest_export: null` |
| `PATCH /packages/:id` | Done |
| `DELETE /packages/:id` | Done; package soft delete |
| `GET /packages/:id/status` | Stubbed with real package status, empty `source_pdfs`, zero job counts |
| `GET /packages/:id/items` | Done for existing/manual rows |
| `POST /packages/:id/items` | Done; manual attributes persist with `original_ai_value=null` |
| `PATCH /items/:id` | Skeleton done; Phase 5 adds audit-aware doc type behavior |
| `POST /packages/:id/items/reorder` | Done; atomic transaction |
| `DELETE /items/:id` | Done; soft delete and clears linked `source_pdfs.item_id` |
| `PUT /items/:id/attributes/:key` | Deferred to Phase 5 |
| `POST /items/:id/attributes/:key/revert` | Deferred to Phase 5 |
| `PATCH /source-pdfs/:id` | Deferred to Phase 5 |

## Behavior notes

- Every implemented endpoint resolves the session through `withWorkspaceFromHeaders()` and filters by `workspace_id`.
- Cross-workspace, invalid UUID, missing, deleted, or hidden-by-deleted-parent resources return contract-shaped 404 responses.
- List endpoints intentionally use `{ data, next_cursor }` envelopes from day one.
- Mutating endpoints accept `Idempotency-Key` headers but do not enforce idempotency in Phase 2.
- Manual item attributes are limited to `manufacturer`, `model_number`, `description`, and `spec_section_ref`.
- Deleting a project does not cascade `packages.deleted_at`; package list/detail endpoints hide packages whose parent project is deleted.

## Env vars / secrets added

No new environment variables or secrets were added in Phase 2. Tests continue to use the Phase 1 Neon dev branch variables from `.env.local`.

## Verification

Run from the repo root:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Latest local verification on 2026-05-20:

- `pnpm typecheck` passed across db, shared, web, and worker.
- `pnpm lint` passed; Next.js still prints its existing deprecation/plugin warnings.
- `pnpm test` passed: web has 2 files / 11 tests passing; db and worker have placeholder test scripts; shared has no tests.
- `pnpm build` passed; Next.js still prints existing Sentry/OpenTelemetry critical dependency warnings.

Targeted Phase 2 test:

```powershell
pnpm --filter @submittal/web exec vitest run tests/phase2.integration.test.ts
```

The Resend sandbox warning still appears during auth-backed tests; this is the known Phase 1 gap and does not fail the tests.

## Bruno collection

The collection lives at `apps/web/tests/bruno/`. Start the app with `pnpm dev`, sign in, set:

- `baseUrl=http://localhost:3000`
- `sessionCookie=<your session cookie>`
- `projectId=<id returned by 01 Create Project>`
- `packageId=<id returned by 02 Create Package>`

Then run requests 01 through 04 in order.

## What is stubbed / deferred

- S3 presign/confirm, workspace logo upload, source PDFs, source pages, previews, and downloads are Phase 3.
- Worker jobs, AI processing, and real package status aggregation are Phase 4.
- Audit-aware attribute edits, doc-type original-AI preservation, source PDF reassignment, exported-package read-only enforcement, and exports are Phase 5.
- CI still does not provision Neon preview branches; Phase 2 tests use the live Neon dev branch like Phase 1.

## Next phase starting point

Phase 3 should start from the existing package lookup helpers and shared schema structure. The key files to read first are:

- `apps/web/src/server/phase2-records.ts`
- `apps/web/src/app/api/v1/packages/[id]/route.ts`
- `apps/web/src/app/api/v1/packages/[id]/items/route.ts`
- `packages/shared/src/api/packages.ts`

Phase 3 should add storage/PDF schemas beside the Phase 2 schemas rather than moving the existing contracts.
