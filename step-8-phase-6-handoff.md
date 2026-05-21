# Step 8 Phase 6 Handoff

Phase 6 closes out the backend. After this phase the Step 9 frontend agent
can start without backend churn, the on-call has SQL + healthchecks to debug
pilot issues, and CI exercises the full backend slice end-to-end.

This is also the **step-8-final-handoff** the buildplan calls for. The
"backend-complete" summary for the frontend agent lives at the bottom under
[Frontend handoff](#frontend-handoff).

## What was built

### Observability
- `apps/web/src/app/api/v1/healthz/route.ts` now returns `git_sha`, `release`,
  `node_env`, and a real `db_ok` boolean from `select 1`. 200 if the DB
  responds, 503 with a `db_error` field otherwise.
- `apps/worker/src/index.ts` `/healthz` returns real `error_rate_5m`,
  `oldest_job_age_s`, `failed_5m`, `finished_5m`, `git_sha`, and
  `release` alongside the existing `queue_depth_by_topic`.
- `packages/db/src/processing-jobs.ts` exposes `getProcessingJobsHealth(db)`
  — the shared aggregator both healthz endpoints can call.
- Worker job execution is wrapped in `runWithLogging(kind, data, fn)` which
  emits structured `job_start` / `job_done` / `job_failed` events including
  `request_id`, `workspace_id`, `package_id`, `source_pdf_id`, and duration.
  Failures are also captured to Sentry tagged with the same `request_id`.

### request_id propagation
- `apps/web/src/server/request-id.ts` resolves a per-request correlation id
  from `x-request-id` or generates a UUID.
- `POST /api/v1/packages/:id/process` and `POST /api/v1/packages/:id/exports`
  pull it, return it as an `x-request-id` response header, log it on the web
  side, and include it in the enqueued job payload.
- `apps/worker/src/jobs/common.ts` types
  (`SourcePdfJobData`, `PackageJobData`, `RenderExportJobData`) all carry
  optional `requestId?: string`. The `enqueueChainedJob` helper in the worker
  preserves it across chained jobs (ocr → classify → extract → batch_order).

### Sentry source maps
- `apps/web/next.config.mjs` is now wrapped with `withSentryConfig`. The
  plugin uploads source maps when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and
  `SENTRY_PROJECT_WEB` are present at build time (Vercel project env vars).
  Local builds without those skip the upload step silently.
- `apps/worker/package.json` adds `pnpm sourcemaps:upload` — shells out to
  `@sentry/cli sourcemaps upload` against `dist/`. Designed to be called from
  Fly's `release_command`.
- `tsconfig.base.json` already had `sourceMap: true` and
  `declarationMap: true`, so the worker bundle ships maps alongside the
  compiled JS.

### Fly worker infra
- `infra/worker/Dockerfile` — two-stage build, runtime `apt-get install qpdf`
  so the Phase 5 repair fallback works. Without qpdf, malformed source PDFs
  hit `QpdfNotInstalledError` and the export is marked `failed`.
- `infra/worker/fly.toml` — `[[services.http_checks]] interval = "15s"` hits
  `/healthz` so a stuck worker is replaced automatically.
- `infra/README.md` — secrets list, deploy command, source-map upload
  expectations.

### Ops + uptime
- `docs/ops/queries.sql` — eight canned admin queries (failed jobs in 24h,
  oldest queued/running, stuck processing packages, failed exports, slowest
  exports, source PDFs in error, pg-boss dead-letter, workspace activity in
  last 7 days, per-attempt error breakdown). Designed to be piped through
  `psql -f ...` or pasted into a console.
- `.github/workflows/uptime.yml` — cron `*/5 * * * *` hits the web and
  worker healthz URLs (set via repository `vars.WEB_HEALTHZ_URL` and
  `vars.WORKER_HEALTHZ_URL`). Fails the run on non-200 *or* missing
  `db_ok:true` in the web body. Also exposed via `workflow_dispatch` for
  manual reruns.

### End-to-end smoke
- `apps/web/tests/e2e-backend.ts` — the full backend smoke per buildplan:
  signup → verify email (direct DB) → sign-in → project → package →
  upload 2 fixtures → process → poll ready → SHA-256 round-trip on each
  source PDF → edit one attribute (verifies `original_ai_value` immutability
  and `edited_by_user_at` stamping) → export with `bates_prefix=E2E-` →
  poll export ready → download + byte_size assertion → confirms re-edit
  attempts after export return `409 package_exported`.
- `apps/web/tests/e2e-backend.sh` — thin wrapper that runs the above via
  `pnpm tsx`. This is the file the buildplan named (`apps/web/tests/e2e-backend.sh`).
- `pnpm smoke:e2e` (root + `@submittal/web`) — script alias for local
  invocation without the shell wrapper.

## Where it lives

```text
apps/web/src/app/api/v1/healthz/route.ts        # db_ok + git_sha
apps/web/src/server/request-id.ts                # NEW
apps/web/src/app/api/v1/packages/[id]/process/route.ts   # logs request_id, attaches to jobs
apps/web/src/app/api/v1/packages/[id]/exports/route.ts   # logs request_id, attaches to job
apps/web/next.config.mjs                         # withSentryConfig wrap

apps/worker/src/index.ts                          # runWithLogging + real /healthz metrics
apps/worker/src/jobs/common.ts                   # requestId on job data types
apps/worker/package.json                          # sourcemaps:upload script

packages/db/src/processing-jobs.ts               # getProcessingJobsHealth()

infra/worker/Dockerfile                          # NEW — qpdf in runtime
infra/worker/fly.toml                            # NEW — 15s healthcheck
infra/README.md                                  # NEW

docs/ops/queries.sql                             # NEW

.github/workflows/uptime.yml                     # NEW

apps/web/tests/e2e-backend.ts                    # NEW
apps/web/tests/e2e-backend.sh                    # NEW
```

## Env vars / secrets added

No new required vars. Phase 6 introduces several **optional** ones that
enable production observability:

| Var | Used by | Required? |
| --- | --- | --- |
| `GIT_SHA` | web + worker `/healthz` | optional (Fly build arg / Vercel auto-injects `VERCEL_GIT_COMMIT_SHA`) |
| `SENTRY_RELEASE` | web + worker `/healthz`, Sentry source-map upload | optional, falls back to `GIT_SHA` |
| `SENTRY_AUTH_TOKEN` | `withSentryConfig` source-map upload (web) | optional; without it the upload step no-ops |
| `SENTRY_ORG` | same | optional |
| `SENTRY_PROJECT_WEB` | same | optional |
| `WEB_HEALTHZ_URL` (GH repo var) | `.github/workflows/uptime.yml` | required for the uptime ping to do anything |
| `WORKER_HEALTHZ_URL` (GH repo var) | same | same |
| `E2E_BASE_URL` | `apps/web/tests/e2e-backend.sh` | optional, default `http://localhost:3000` |
| `E2E_WORKER_URL` | same | optional, default `http://localhost:8080` |

## What is stubbed / deferred

- The Sentry source-map upload runs in CI only when the auth token vars are
  set on the build environment. Without them, the wrap is harmless (verified
  by `pnpm --filter @submittal/web build` locally) but no maps are uploaded.
- The uptime workflow uses GitHub's `schedule` cron, which is best-effort —
  during peak hours runs can be skipped or delayed up to ~15 min. Treat it
  as a smoke alarm, not a real SLO monitor. Pilot graduates to PagerDuty or
  similar later.
- Performance numbers on a 200-page package render were not captured this
  phase — Phase 5 noted this gap and the e2e smoke only exercises a 2-PDF
  package. Capture real timings during the first pilot install.
- The `runWithLogging` wrapper in `apps/worker/src/index.ts` emits
  `job_start`/`job_done` once per pg-boss execution. Inner job code
  (e.g. `runRenderExportJob`) still emits its own component-level logs that
  do NOT thread `request_id` through; only the outer wrapper carries it.
  Good enough to correlate the originating web request to its worker
  attempts; if a future incident needs deeper drilling, plumb `requestId`
  into the inner `log()` helpers too.
- No admin UI ships at MVP per scope. `docs/ops/queries.sql` is the
  interface.

## Known gaps and risks

- `runWithLogging` calls `Sentry.captureException` for every job failure.
  pg-boss may retry the same logical job up to three times (`retryLimit: 3,
  retryBackoff: true`) — that produces three Sentry events. Acceptable at
  MVP volume; if alert noise becomes a problem, gate the capture on the
  final attempt by checking pg-boss `attempt` count.
- `pgboss.job` is queried by `docs/ops/queries.sql`. pg-boss owns that
  schema; if a future pg-boss upgrade renames columns the dead-letter query
  needs an update. Lock the version in `pnpm-lock.yaml` (already pinned to
  `^10`).
- The Fly Dockerfile uses `pnpm deploy --prod` to prune the runtime image.
  If pg-boss or @sentry/node move a dependency to `peerDependencies` the
  prune may drop it. Smoke-test the image with `docker run ... node
  dist/index.js` before each deploy.
- `.github/workflows/uptime.yml` reads repo **variables**, not secrets.
  That's deliberate so the URLs are visible in workflow logs for triage —
  but it means anyone with read access to the repo sees them. The URLs
  themselves are not sensitive (they're just healthz endpoints) but if that
  changes, move to `secrets`.
- The e2e smoke creates throwaway users and packages in the dev DB and
  uploads PDFs to dev S3. It does not clean them up. Same caveat the Phase 4
  smoke flagged.

## Verification performed

Local:

```powershell
pnpm typecheck   # 4 workspaces green
pnpm lint        # 4 workspaces green
pnpm test        # 39 tests across 5 web suites + 3 shared + 5 worker = all green
pnpm --filter @submittal/web build   # next build with withSentryConfig wrap succeeded
```

Manual smoke deferred to a live dev DB + S3 + worker:

```powershell
# Terminal 1
pnpm --filter @submittal/web dev
# Terminal 2
pnpm --filter @submittal/worker dev
# Terminal 3
apps/web/tests/e2e-backend.sh
# or: pnpm smoke:e2e
```

The end-of-script JSON includes `ok: true`, byte-perfect SHA-256 match for
each uploaded source PDF, an `export_byte_size`, and an `export_page_count`
derived from the worker render.

## Frontend handoff

This section is the **step-8-final-handoff** the buildplan asks for. Step 9
agent: this is what the backend exposes; everything else is implementation
detail in the previous phase handoffs.

### What the backend exposes

Every endpoint lives under `/api/v1` and is workspace-scoped. Cross-workspace
IDs return 404 (not 403) per step-5 §Conventions. All Zod schemas live in
`packages/shared/src/api/` — import them into react-hook-form forms so the
client and server agree on shapes.

| Endpoint | Schema file | Notes |
| --- | --- | --- |
| `POST /api/v1/auth/signup` | `api/auth.ts` (inline in route) | creates workspace + first user atomically |
| `POST /api/v1/auth/sign-in/email` | better-auth handler | session cookie issued |
| `POST /api/v1/auth/sign-out` | better-auth handler | clears cookie |
| `GET /api/v1/me` | `packages/shared/src/api/workspace.ts` | returns workspace context |
| `GET/PATCH /api/v1/workspace` | `api/workspace.ts` | logo upload via separate presign flow |
| `POST /api/v1/workspace/logo/presign` + `/confirm` | `api/workspace.ts` | PNG/JPEG only |
| `GET/POST/GET-by-id/PATCH/DELETE /api/v1/projects[/:id]` | `api/projects.ts` | soft delete via `deleted_at` |
| `GET/POST /api/v1/projects/:id/packages` | `api/packages.ts` | |
| `GET/PATCH/DELETE /api/v1/packages/:id` | `api/packages.ts` | response now includes `latest_export` summary |
| `GET /api/v1/packages/:id/status` | `api/packages.ts` | poll target during processing — `{ status, source_pdfs[], jobs_summary }` |
| `POST /api/v1/packages/:id/process` | (no body) | kicks off AI pipeline; returns `x-request-id` header |
| `POST /api/v1/packages/:id/source-pdfs/presign` + `/confirm` | `api/files.ts` | upload happens browser → S3 direct |
| `GET/PATCH/DELETE /api/v1/source-pdfs/:id` | `api/items.ts` (reassign) | reassign within same package only |
| `GET /api/v1/source-pdfs/:id/download` | — | returns `{ url }` 5-min presigned |
| `GET /api/v1/source-pages/:id/preview` | — | returns `{ image_url, ocr_text }` — first call renders WebP on demand |
| `GET /api/v1/packages/:id/items` | `api/items.ts` | full item list with per-attribute confidence + citations |
| `POST /api/v1/packages/:id/items` + `/reorder` | `api/items.ts` | reorder is atomic bulk |
| `PATCH /api/v1/items/:id` | `api/items.ts` | doc_type change captures `doc_type_original_ai_value` once |
| `PUT /api/v1/items/:id/attributes/:key` | `api/items.ts` | stamps `edited_by_user_at`, leaves `original_ai_value` alone |
| `POST /api/v1/items/:id/attributes/:key/revert` | `api/items.ts` | restores AI value |
| `POST /api/v1/packages/:id/exports` | `api/exports.ts` | accepts `bates_prefix?`; returns `x-request-id` header |
| `GET /api/v1/packages/:id/exports` | `api/exports.ts` | list newest first |
| `GET /api/v1/exports/:id` | `api/exports.ts` | poll target during render |
| `GET /api/v1/exports/:id/download` | — | `{ url }` 5-min presigned |

### Polling cadence assumptions

- After `POST /packages/:id/process` the client polls `GET /packages/:id/status`
  every **2 seconds**. The Phase 4 smoke uses 5 s, but UI should feel faster.
  Stop polling when `status === 'ready'` or any source PDF has
  `processing_status === 'error'`.
- After `POST /packages/:id/exports` the client polls `GET /exports/:id`
  every **2–3 seconds**. Stop on `status === 'ready'` or `status === 'failed'`.
- `GET /api/v1/healthz` is public and useful as a connectivity ping during
  app boot.

### Read-only-after-export contract

When `packages.status === 'exported'`, every item-mutation endpoint returns
`HTTP 409` with body:

```json
{ "error": { "code": "package_exported", "message": "Package is exported and cannot be modified. Create a new revision to make edits." } }
```

Endpoints covered (step-8-phase-5-handoff.md):
`PATCH /items/:id`, `DELETE /items/:id`, `POST /packages/:id/items`,
`POST /packages/:id/items/reorder`, `PUT /items/:id/attributes/:key`,
`POST /items/:id/attributes/:key/revert`, `PATCH /source-pdfs/:id`,
`DELETE /source-pdfs/:id`.

`POST /packages/:id/exports` is **not** in that list — re-exports are allowed
on an already-exported package. Frontend should render a "Create R1 to edit"
banner per step-6 wireframe Screen 7.

### Audit invariants the frontend should rely on

| Field | Semantics |
| --- | --- |
| `item_attributes.original_ai_value` | Set once by the AI. Never mutated. Use for "Revert to AI" affordance. |
| `item_attributes.current_value` | What the user sees. `null` if neither AI nor user set it. |
| `item_attributes.edited_by_user_at` | Truthy ⇒ render the "edited" badge from Screen 5. `null` after revert. |
| `items.doc_type_original_ai_value` | The classification model's first opinion. Frontend shows it if user changed `doc_type`. |
| `packages.latest_export_id` + `packages.status` | `status='exported'` plus `latest_export_id` non-null ⇒ "Last export" button is available. |
| `exports.status` enum | `pending`, `rendering`, `ready`, `failed` — drive the toast/progress UI. |

### Fixtures for component tests

`spikes/fixtures/01-daikin-vrv-cutsheet.pdf` and `02-hardie-warranty.pdf` are
the canonical small fixtures. The AI extracts known
`manufacturer / model_number / description / spec_section_ref` from them —
useful for Storybook screenshots without hitting the real Anthropic API.
`tests/e2e-backend.ts` shows the exact JSON shape the client receives from
`GET /packages/:id/items`.

### Env vars the frontend needs

The frontend ships in `apps/web` — same Next.js app — so all env access goes
through the existing `apps/web/src/env.ts` server-side. The only public-side
config is the same-origin API path.

If/when the frontend lives elsewhere, it needs:
- `NEXT_PUBLIC_API_BASE_URL` (or equivalent) pointing at this backend
- It also reads `x-request-id` from `POST /process` and `POST /exports`
  responses; include that header in any error telemetry the frontend sends.

### Where to start

```powershell
pnpm install
pnpm db:migrate          # against your dev Neon branch
pnpm --filter @submittal/web dev      # web on :3000
pnpm --filter @submittal/worker dev   # worker on :8080
pnpm smoke:e2e           # confirms the backend is healthy end-to-end
```

Then build screens in `apps/web/src/app/(dashboard)/…` against the schemas in
`packages/shared/src/api/`. Step 9's planning doc enumerates the screens.

## Next phase starting point

Step 9 (frontend). See [Frontend handoff](#frontend-handoff) above. Phase 6
is the last backend phase — there is no Phase 7. If pilot uncovers backend
bugs they get fixed as patches against the existing phase artifacts, not as
a new phase.
