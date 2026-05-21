# Step 8 Final Handoff

Step 8 is complete. The backend is shippable. This doc is the orientation
read for the Step 9 frontend agent — every endpoint, every Zod schema, every
polling cadence and audit invariant the UI relies on.

For phase-by-phase build history see:
- [step-8-phase-0-handoff.md](step-8-phase-0-handoff.md) — spikes + service provisioning
- [step-8-phase-1-handoff.md](step-8-phase-1-handoff.md) — scaffold, schema, auth, tenancy
- [step-8-phase-2-handoff.md](step-8-phase-2-handoff.md) — projects/packages/items CRUD
- [step-8-phase-3-handoff.md](step-8-phase-3-handoff.md) — S3 + source PDFs + source pages
- [step-8-phase-4-handoff.md](step-8-phase-4-handoff.md) — worker, pg-boss, AI pipeline
- [step-8-phase-5-handoff.md](step-8-phase-5-handoff.md) — audit-aware item APIs + export pipeline
- [step-8-phase-6-handoff.md](step-8-phase-6-handoff.md) — observability, ops, e2e smoke (also contains the same frontend-handoff section as this file)

## What the backend exposes

Base path `/api/v1`. Every endpoint requires a session cookie (set by
better-auth) except `/auth/*` and `/healthz`. Tenancy is implicit: every
request resolves a `workspace_id` from the session and cross-workspace IDs
return 404.

Zod schemas: `packages/shared/src/api/` — `projects.ts`, `packages.ts`,
`items.ts`, `files.ts`, `exports.ts`, `workspace.ts`. The handlers and the
client both import from there; do the same in any frontend form.

| Endpoint | Phase | Schema |
| --- | --- | --- |
| `POST /auth/signup` | 1 | inline |
| `POST /auth/sign-in/email`, `/sign-out` | 1 | better-auth |
| `GET /me` | 1 | `workspace.ts` |
| `GET/PATCH /workspace` | 2 | `workspace.ts` |
| `POST /workspace/logo/presign`, `/confirm` | 3 | `workspace.ts` |
| `GET/POST/GET-by-id/PATCH/DELETE /projects[/:id]` | 2 | `projects.ts` |
| `GET/POST /projects/:id/packages` | 2 | `packages.ts` |
| `GET/PATCH/DELETE /packages/:id` | 2 + 5 (latest_export) | `packages.ts` |
| `GET /packages/:id/status` | 2 + 4 | `packages.ts` |
| `POST /packages/:id/process` | 4 | (no body) |
| `POST /packages/:id/source-pdfs/presign`, `/:sourcePdfId/confirm` | 3 | `files.ts` |
| `GET/PATCH/DELETE /source-pdfs/:id` | 3 + 5 (reassign) | `items.ts` |
| `GET /source-pdfs/:id/download` | 3 | `{ url }` |
| `GET /source-pages/:id/preview` | 3 | `{ image_url, ocr_text }` |
| `GET /packages/:id/items` | 2 + 5 | `items.ts` |
| `POST /packages/:id/items`, `/items/reorder` | 2 | `items.ts` |
| `PATCH /items/:id`, `DELETE /items/:id` | 2 + 5 | `items.ts` |
| `PUT /items/:id/attributes/:key`, `POST .../revert` | 5 | `items.ts` |
| `POST /packages/:id/exports`, `GET /packages/:id/exports` | 5 | `exports.ts` |
| `GET /exports/:id`, `GET /exports/:id/download` | 5 | `exports.ts` |
| `GET /healthz` (web) | 6 | `{ status, db_ok, git_sha, release, ... }` |

## Polling cadence

- Processing status (`GET /packages/:id/status`): every **2 s** until
  `status === 'ready'` or any `source_pdfs[].processing_status === 'error'`.
- Export status (`GET /exports/:id`): every **2–3 s** until `status === 'ready'`
  or `'failed'`.
- Healthz: only needed at boot or in an explicit "connection lost" recovery
  flow.

## Read-only-after-export

When `packages.status === 'exported'`, every item-mutation endpoint returns:

```http
HTTP/1.1 409 Conflict
{
  "error": {
    "code": "package_exported",
    "message": "Package is exported and cannot be modified. Create a new revision to make edits."
  }
}
```

Render the "Create R1 to edit" banner from step-6 wireframe Screen 7.

`POST /packages/:id/exports` is intentionally NOT in that list — re-exports
are allowed.

Endpoints affected: `PATCH /items/:id`, `DELETE /items/:id`,
`POST /packages/:id/items`, `POST /packages/:id/items/reorder`,
`PUT /items/:id/attributes/:key`, `POST /items/:id/attributes/:key/revert`,
`PATCH /source-pdfs/:id`, `DELETE /source-pdfs/:id`.

## Audit invariants the UI should rely on

| Field | Meaning | UI use |
| --- | --- | --- |
| `item_attributes.original_ai_value` | AI's first opinion. Never mutates. | "Revert to AI" affordance |
| `item_attributes.current_value` | What to render. May be `null`. | The actual cell value |
| `item_attributes.edited_by_user_at` | Non-null ⇒ user has edited this attribute since the AI wrote it. | "edited" badge |
| `items.doc_type_original_ai_value` | Set the first time the user changes `doc_type`. | "AI originally said X" hint |
| `packages.latest_export_id`, `packages.status` | `status='exported'` + non-null ⇒ "Last export" download is available. | header CTA |
| `exports.status` enum (`pending`/`rendering`/`ready`/`failed`) | render progress toast | toast / button state |

## Correlation IDs (Phase 6)

`POST /packages/:id/process` and `POST /packages/:id/exports` return an
`x-request-id` response header. Pipe it into client-side error telemetry —
the worker logs the same id on every chained job (`ocr` → `classify` →
`extract` → `batch_order` and `render_export`), so an on-call can trace
"this user clicked Process at time T" all the way to a worker failure.

The web also accepts an inbound `x-request-id` header (so an upstream proxy
or load test can pin a known id). Trimmed to 128 chars max.

## Fixtures for component tests

`spikes/fixtures/01-daikin-vrv-cutsheet.pdf` and `02-hardie-warranty.pdf`
are the canonical small fixtures. The AI extracts predictable
`manufacturer / model_number / description / spec_section_ref` from them —
useful for Storybook screenshots that avoid hitting Anthropic. See
`apps/web/tests/e2e-backend.ts` for the exact response shapes.

## Env vars the frontend needs

The frontend lives in `apps/web` — same Next.js app — so server-side env
access already flows through `apps/web/src/env.ts`. No frontend-specific env
needs to be added.

If/when the frontend splits into a separate app:
- `NEXT_PUBLIC_API_BASE_URL` to reach this backend
- credentials handling: API uses HTTP-only cookies; fetch needs
  `credentials: 'include'`
- read the `x-request-id` response header on POSTs that kick off async work

## Where to start

```powershell
pnpm install
pnpm db:migrate                       # against your dev Neon branch
pnpm --filter @submittal/web dev      # web :3000
pnpm --filter @submittal/worker dev   # worker :8080
pnpm smoke:e2e                        # confirms the backend is healthy end-to-end
```

Then build screens in `apps/web/src/app/(dashboard)/…` against the schemas
in `packages/shared/src/api/`.

Step 9's planning doc enumerates the screens.

## Operational dashboard

- Healthz:
  - web: `GET /api/v1/healthz` → `{ status, db_ok, git_sha, release, ... }`
  - worker: `GET <worker-host>/healthz` → adds `queue_depth_by_topic`,
    `error_rate_5m`, `oldest_job_age_s`, `failed_5m`, `finished_5m`.
- Uptime cron: `.github/workflows/uptime.yml` pings both every 5 min when
  `vars.WEB_HEALTHZ_URL` and `vars.WORKER_HEALTHZ_URL` are configured.
- Admin SQL: `docs/ops/queries.sql` — eight queries for triage.
- Fly worker config: `infra/worker/Dockerfile` (installs qpdf for the
  Phase 5 repair fallback) + `infra/worker/fly.toml` (15s healthcheck).

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test`, and
`pnpm --filter @submittal/web build` all pass on `main` as of this handoff.
The unit + integration test count: 39 across 5 web suites, 3 shared, 5
worker. Live smoke (`pnpm smoke:e2e`) requires a real dev Neon branch + S3
bucket + Anthropic key + a running worker.
