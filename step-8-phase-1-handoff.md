# Phase 1 Handoff — Scaffold, DB schema, auth, notifications, tenancy

Phase 1 is **complete**. A developer can now run `pnpm dev`, sign up at `POST /api/v1/auth/signup`, receive a Resend verification email, click the link to verify, sign in via `POST /api/v1/auth/sign-in/email`, hit `GET /api/v1/me` for `{ user, workspace }`, and sign out. The integration test (`pnpm test`) passes 5/5 against the live Neon dev branch.

## What was built

### Monorepo skeleton

pnpm workspaces with two apps and two packages:

```
apps/
  web/        Next.js 15 App Router, strict TS, better-auth + Sentry wired
  worker/     Node 20 + pg-boss boot, /healthz, Sentry. No topic subscribers yet (Phase 4).
packages/
  db/         Drizzle schema, @neondatabase/serverless client, migration, seed, verify
  shared/     Notifications/email; stubs for api/ ai/ ocr/ pdf/ storage/ (later phases)
```

Tooling:
- TypeScript 5.7 (`strict: true`, `noUncheckedIndexedAccess: true`) shared via `tsconfig.base.json`
- ESLint 9 flat config (`eslint.config.mjs`) + Prettier 3
- Vitest 2.1 with `vitest.workspace.ts` (per-package configs allowed)
- GitHub Actions CI at [.github/workflows/ci.yml](.github/workflows/ci.yml) — lint + typecheck + vitest + Drizzle schema-drift check
- `.editorconfig`, `.nvmrc`, `.prettierrc.json`

### Database — `packages/db`

Drizzle schema in [packages/db/src/schema.ts](packages/db/src/schema.ts) covers all 13 tables from [the data model](review-product-brief-md-we-are-quirky-cat.md):

| Domain table | Better-auth tables |
|---|---|
| `workspaces` | `users` (workspaceId added as `additionalFields`) |
| `projects` | `sessions` |
| `packages` | `accounts` |
| `source_pdfs`, `source_pages` | `verifications` |
| `items`, `item_attributes` | |
| `exports` | |
| `processing_jobs` | |

Plus the 5 enums (`package_status`, `pdf_processing_status`, `item_doc_type`, `job_kind`, `job_status`) and every index from the data model — including the V1.1 forward-looking partial index on `item_attributes.key = 'spec_section_ref'`.

Migration: [packages/db/drizzle/0000_init.sql](packages/db/drizzle/0000_init.sql) (drizzle-kit conventionally numbers from 0000, not 0001 — the build plan's `0001_init.sql` was nominal). Applied successfully to the Neon dev branch; `verify.ts` script confirms 13/13 tables present.

Scripts (from repo root):
- `pnpm db:generate` — generate migration SQL from schema
- `pnpm db:migrate` — apply pending migrations to the URL in `DATABASE_URL_DIRECT_DEV`
- `pnpm db:seed` — idempotent insert of `demo@local` workspace+user+project+package
- `pnpm db:studio` — Drizzle Studio
- `pnpm --filter @submittal/db exec tsx src/verify.ts` — sanity-check all tables present

Client: [packages/db/src/client.ts](packages/db/src/client.ts) exports `getDb({ url, max })` backed by `@neondatabase/serverless` (WebSocket transport via `ws` polyfill on Node). One driver works in all three runtimes (Vercel serverless, local dev, Fly worker).

### Auth + notifications — `apps/web` + `packages/shared`

[better-auth](https://www.better-auth.com/) 1.1.x wired against our Drizzle schema:

- **Argon2id** password hashing via `@node-rs/argon2` (overrides better-auth's default scrypt — locks in step-7 §3).
- **Email verification required** (`requireEmailVerification: true`, `autoSignInAfterVerification: true`). Resend's hook fires on signup.
- **Session cookies**: HTTP-only, `SameSite=Lax`, `Secure` in production only, 30-day expiry (`SESSION_TTL_SECONDS`), `updateAge` set so the session row is touched at most once per day.
- **Origin/CSRF** enforced by better-auth: non-GET requests need `Origin` matching `BETTER_AUTH_URL`.
- **Postgres ID generation**: `advanced.database.generateId: false` — every PK uses our schema's `gen_random_uuid()` default. (Default better-auth IDs are short random strings that don't fit `uuid` columns.)
- **Plural table names** kept in SQL per the data model; the adapter's schema map uses singular keys (`user`, `session`, `account`, `verification`) because that's what better-auth looks up internally.

Endpoints (all under `/api/v1`):

| Method | Path | Source |
|---|---|---|
| POST | `/auth/signup` | [signup/route.ts](apps/web/src/app/api/v1/auth/signup/route.ts) — custom; creates workspace + user atomically (rolls back workspace on better-auth failure) |
| POST | `/auth/sign-in/email` | better-auth catch-all |
| POST | `/auth/sign-out` | better-auth catch-all |
| GET  | `/auth/verify-email` | better-auth catch-all (link in Resend email) |
| GET  | `/me` | [me/route.ts](apps/web/src/app/api/v1/me/route.ts) — uses `withWorkspaceFromHeaders()` |
| GET  | `/healthz` | always 200 |
| GET  | `/debug-sentry` | dev-only throw for Sentry verification |

Tenancy helper: [apps/web/src/server/workspace.ts](apps/web/src/server/workspace.ts) exports `withWorkspace()` (uses `next/headers`) and `withWorkspaceFromHeaders()` (testable, takes a `Headers` instance). Both resolve the workspace from the session-attached user and return a `WorkspaceContext = { userId, workspaceId, email, name }`. Cross-workspace IDs should call `notFound()` for the contract-correct 404. **Every Phase 2 endpoint that touches a workspace-scoped resource MUST go through this helper** — that's the tenancy guarantee.

Resend wiring: [packages/shared/src/notifications/email.ts](packages/shared/src/notifications/email.ts) exports `sendVerificationEmail()` and `sendPasswordResetEmail()` (plain text, lazy SDK init). better-auth's email hooks call them. Email send failures are logged but do not block signup — see Known gaps #1.

### Worker — `apps/worker`

[apps/worker/src/index.ts](apps/worker/src/index.ts) boots pg-boss against `DATABASE_URL_DIRECT_DEV`, starts a `/healthz` HTTP server on `WORKER_HEALTHZ_PORT` (default 8080) returning placeholder queue depth + error rate, installs Sentry, and handles SIGINT/SIGTERM with a graceful pg-boss `stop({ graceful: true, timeout: 10s })`. No topic subscribers yet — those land in Phase 4.

### Sentry

`@sentry/nextjs` 8.55 for the web, `@sentry/node` 8.55 for the worker. Both gated on a DSN env var (no-op if unset). Web SDK is initialized via [apps/web/src/instrumentation.ts](apps/web/src/instrumentation.ts) → `sentry.server.config.ts` / `sentry.edge.config.ts`. **Critical:** these files live in `src/` (not `apps/web/` root) — Next.js's `src/` layout requires instrumentation to be inside `src/`. With the previous root location, Sentry initialized silently as DSN-less.

Source-map upload (via `withSentryConfig` + `@sentry/wizard`) is intentionally deferred to **Phase 6** per the build plan.

### CI

GitHub Actions at [.github/workflows/ci.yml](.github/workflows/ci.yml). One job:

```
checkout → pnpm install --frozen-lockfile → typecheck → lint → db:generate +
schema-drift check (fails if pnpm db:generate produces uncommitted changes) → vitest
```

CI uses placeholder env values for env.ts validation. The integration test in `apps/web/tests/auth.integration.test.ts` hits real Neon, so **CI does not run the integration test today** — add Neon-preview-branch secrets to repo secrets in Phase 2 if/when CI needs to exercise the live flow.

## Where it lives

```
apps/
  web/
    next.config.mjs                            transpilePackages + .js→.ts extensionAlias
    next-env.d.ts
    package.json
    tsconfig.json
    vitest.config.ts                           single-fork, 30s timeouts
    src/
      env.ts                                   Zod-validated env, loads repo-root .env.local
      instrumentation.ts                       Next.js 15 instrumentation hook (Sentry init)
      sentry.server.config.ts
      sentry.edge.config.ts
      sentry.client.config.ts
      server/
        db.ts                                  process-wide Drizzle client
        auth.ts                                better-auth config (Drizzle + argon2 + Resend)
        workspace.ts                           withWorkspace() / withWorkspaceFromHeaders() / notFound()
      app/
        layout.tsx, page.tsx                   minimal landing
        api/v1/
          auth/[...all]/route.ts               better-auth catch-all
          auth/signup/route.ts                 custom signup wrapper
          me/route.ts                          /me
          healthz/route.ts
          debug-sentry/route.ts                deliberate throw (dev only)
    tests/
      auth.integration.test.ts                 5 tests, all pass
      helpers/cookie-jar.ts, test-db.ts

  worker/
    package.json, tsconfig.json
    src/env.ts, sentry.ts, index.ts

packages/
  db/
    package.json                               type:module, drizzle-kit 0.31.x
    tsconfig.json
    drizzle.config.ts
    drizzle/
      0000_init.sql                            committed
      meta/
    src/
      env.ts                                   loads repo-root .env.local
      schema.ts                                13 tables + 5 enums + indexes
      client.ts                                getDb() singleton
      index.ts                                 re-exports
      migrate.ts, seed.ts, verify.ts           tsx scripts

  shared/
    package.json, tsconfig.json, vitest.config.ts
    src/
      index.ts                                 narrow barrel (use subpaths)
      notifications/email.ts                   Resend wrapper
      api/ ai/ ocr/ pdf/ storage/              empty stubs

.github/workflows/ci.yml
package.json                                   root scripts
pnpm-workspace.yaml                            packages + allowBuilds
tsconfig.base.json
eslint.config.mjs
.prettierrc.json
.editorconfig
.nvmrc
vitest.workspace.ts
```

## Env vars / secrets added beyond Phase 0

No new variables — Phase 1 consumes the matrix that Phase 0 committed to [.env.example](.env.example). The variables actually read are:

| Var | Used by | Required? |
|---|---|---|
| `DATABASE_URL` / `DATABASE_URL_POOLED_DEV` / `DATABASE_URL_DIRECT_DEV` | web client (pooled) + worker + migrations (direct) | yes |
| `BETTER_AUTH_SECRET` | better-auth (≥16 chars) | yes |
| `BETTER_AUTH_URL` | cookie domain + email verification links + Origin check | yes |
| `SESSION_TTL_SECONDS` | session expiry | defaults to 30d |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | verification + password reset | yes for signup to send mail |
| `SENTRY_DSN_WEB`, `SENTRY_DSN_WORKER`, `SENTRY_ENVIRONMENT` | Sentry SDK init | optional |
| `WORKER_HEALTHZ_PORT` | worker /healthz listen port | defaults to 8080 |

`env.ts` (web) and `apps/worker/src/env.ts` (worker) explicitly load `.env.local` from the repo root because Next.js's per-app env loading wouldn't find it.

## What is stubbed / deferred

1. **`packages/shared/{api,ai,ocr,pdf,storage}/`** — empty `export {}` stubs. Phase 2 fills `api/`, Phase 3 fills `pdf/` + `storage/`, Phase 4 fills `ai/` + `ocr/`.

2. **Worker has no job topics** — pg-boss boots but no subscribers. `/healthz` returns zero queue depth. Phase 4 adds the `ocr`, `classify`, `extract`, `batch_order` topics; Phase 5 adds `render_export`.

3. **Migration filename is `0000_init.sql`, not `0001_init.sql`.** drizzle-kit's default index numbering starts at 0000; the build plan's `0001` was nominal. Subsequent migrations will be `0001_*`, `0002_*`, …

4. **Migrations directory is `packages/db/drizzle/`, not `packages/db/migrations/`.** drizzle-kit's default folder name. Renaming requires custom config and offers no benefit at MVP.

5. **Sentry source-map upload + `withSentryConfig` wrapping** — wiring exists but no `@sentry/wizard` config. Build plan puts source maps in Phase 6.

6. **No deployed smoke test** — Phase 0 noted this rolls into Phase 1; Phase 1 did the runnable monorepo but did not push to Vercel / Fly. Defer to Phase 6 (or whenever the user first wants a preview URL). The code is deploy-ready.

7. **CI does not run the integration test** — CI lacks Neon credentials. Adding `DATABASE_URL_*` secrets + a per-PR Neon preview branch (per [step-7 §2](step-7-stack-lockin.md)) is a Phase 2/6 task.

8. **Husky pre-commit hook** — build plan calls it "optional, only if it doesn't slow down dev." Skipped. Add later if drift becomes a problem.

## Known gaps and risks

1. **Resend domain not verified.** The user's Resend workspace is in sandbox mode — `EMAIL_FROM=onboarding@resend.dev` only delivers to `rycotechnology1@gmail.com` (the account owner). Signup with any other email will hit a Resend rejection, **logged but not surfaced to the API caller**. The signup endpoint returns 200, the user row exists with `email_verified=false`, but the verification email never arrives. Before Phase 6 onboarding goes wider: verify a real domain at resend.com/domains, point Cloudflare DNS at it (Phase 0 §9 deferred item), update `EMAIL_FROM`.

2. **Workspace orphan on partial signup failure.** Signup is two writes against two connections (workspaces table via our Drizzle pool, then user table via better-auth's adapter). We compensate-delete on signUpEmail failure; we **do not** compensate if the process crashes between the two writes. Acceptable at MVP scale; the orphan is harmless and detectable. A migration to a real cross-connection transaction (sharing the same pool) is straightforward when needed.

3. **`auth.api.signUpEmail` typed as `as never` for the `workspaceId` field.** better-auth's static types don't know about `additionalFields`. The runtime works; the cast is the cost. If [better-auth#additional-fields-typing](https://www.better-auth.com/docs) lands a typed solution, drop the cast.

4. **Node 24 + drizzle-kit 0.30 incompatible.** Phase 1's first migration attempt failed with `require is not defined in ES module scope` because Node 24's auto-TS loader conflicts with drizzle-kit 0.30's schema CJS-transform. Upgraded to **drizzle-kit 0.31.x** which uses an ESM-safe loader. Locked at `^0.31.4`. Don't downgrade.

5. **`pnpm-workspace.yaml` has both `allowBuilds:` (harness-injected with `true`) and `onlyBuiltDependencies:` (the documented pnpm 10+ key).** Both are present because the harness re-injects `allowBuilds:` on every write of the file. pnpm reads `onlyBuiltDependencies`. The duplication is cosmetic; leave it.

6. **`/auth/sign-out` requires both `Cookie` AND `Origin: http://localhost:3000` (or whatever `BETTER_AUTH_URL` is set to).** Documented for the Phase 9 frontend agent. Without `Origin` it returns 403 `MISSING_OR_NULL_ORIGIN`; without `Content-Type: application/json` it returns 415. Browser fetch sets both automatically when calling same-origin.

7. **better-auth `disableSignUp` is NOT set.** The catch-all still serves `/api/v1/auth/sign-up/email`, which bypasses our custom workspace-creating wrapper. Frontend should hit `/api/v1/auth/signup` (our custom path). Before Phase 6: either set `disableSignUp: true` and call `auth.api.signUpEmail` server-internally only, or document the dual-path clearly. Currently a small footgun.

8. **`packages/db/drizzle.config.ts` uses `process.cwd()` to find the repo root.** Works because drizzle-kit cwds into `packages/db`. If a future script invokes drizzle-kit from a different directory, the env load will silently miss `.env.local`.

9. **better-auth's verification link drops the user at `/api/v1/auth/verify-email?token=…`** — a server endpoint that responds with `Email verified ✓` or similar. There is no UI redirect yet (Step 9 frontend will add a destination page). For now the user sees a JSON response after clicking; functional, not polished.

10. **No password-reset endpoint exposed via custom route.** better-auth ships `/api/v1/auth/forget-password` and `/api/v1/auth/reset-password` via the catch-all. The Resend hook is wired in `auth.ts`. Frontend just needs to call those paths.

## Verification status

Per [step-8-buildplan.md:55](step-8-buildplan.md):

- [x] `pnpm dev` boots web + worker. Web on `:3000`, worker `/healthz` on `:8080`.
- [x] New user can sign up → receive Resend verification email → click → log in → `GET /api/v1/me` → log out. **Done live** with `rycotechnology1@gmail.com`. The flow returned the exact contract-shaped responses end-to-end.
- [x] `pnpm test` passes the signup → /me → logout integration test. **5/5 tests pass** against the real Neon dev branch (≈3.5s).
- [x] Drizzle Studio shows all tables. Schema verifier (`src/verify.ts`) confirms 13/13.
- [x] Migration runs idempotently on Neon dev branch.
- [x] Sentry receives a deliberate throw (web project). Confirmed by user.

## Phase 2 starting point — for the next agent picking up cold

**Goal of Phase 2** per [step-8-buildplan.md:67](step-8-buildplan.md): implement every read/write endpoint from step-5 §1–4 and §7 that does not involve files or AI. Items get skeleton create/edit/delete; `item_attributes` is touched only manually for tests until Phase 4 populates it.

### Pre-flight checklist before Phase 2 begins

1. **Pull the latest `main`.** Phase 1's branch is `phase-1-scaffold`; merge after review.
2. **Run `pnpm install`** to pull lockfile changes.
3. **Run `pnpm db:migrate`** to ensure your local Neon dev branch is at 0000.
4. **Optionally `pnpm db:seed`** to insert `demo@local` for manual API testing.
5. **Verify `pnpm dev` + the signup→/me→logout flow** still works on your machine. If it doesn't, Phase 2 is blocked.

### Critical files Phase 2 will touch

- New: `packages/shared/src/api/{projects,packages,items,workspace,me}.ts` — Zod schemas mirroring step-5 §1–7. Source of truth for handlers AND react-hook-form (Step 9).
- New: `apps/web/src/app/api/v1/projects/route.ts`, `apps/web/src/app/api/v1/projects/[id]/route.ts`, `apps/web/src/app/api/v1/projects/[id]/packages/route.ts`, `apps/web/src/app/api/v1/packages/[id]/route.ts`, etc. — see step-5 §1–4 + §7 for the full surface.
- New: `apps/web/src/app/api/v1/workspace/route.ts` — GET + PATCH (no logo upload; that's Phase 3).
- New: `apps/web/tests/bruno/` — Bruno collection committed for manual + scripted flow reproduction.

### How to wire a workspace-scoped endpoint

```ts
// apps/web/src/app/api/v1/projects/route.ts
import { withWorkspaceFromHeaders } from '@/server/workspace';
import { db, schema } from '@/server/db';
import { and, eq, isNull } from 'drizzle-orm';

export async function GET(req: Request) {
  const r = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    return db.select().from(schema.projects).where(
      and(eq(schema.projects.workspaceId, ctx.workspaceId), isNull(schema.projects.deletedAt))
    );
  });
  if (r instanceof Response) return r;
  return Response.json(r);
}
```

Always filter by `ctx.workspaceId`. Use `isNull(deletedAt)` for soft-delete-aware queries on `projects` and `packages`. Cross-workspace IDs → call `notFound()` to return the contract-shaped 404 (not 403).

### Things Phase 2 should NOT do (defer to later phases)

- Any S3 calls or `presign`/`confirm` endpoints (Phase 3)
- Any AI / worker job logic; `POST /packages/:id/process` is Phase 4
- Item attribute mutations (`PUT /items/:id/attributes/:key`, etc. — audit-aware versions in Phase 5)
- Export endpoints (Phase 5)
- Cloudflare DNS / public domain wiring (Phase 6 — or whenever a domain is acquired)

### Risks to surface during Phase 2

- **Idempotency-Key.** Step-5 §Conventions calls for an idempotency-key header on mutating endpoints. Phase 4 + 6 enforce it for real; Phase 2 should accept and ignore it (do not 400 if the header is missing or unrecognized — that breaks Phase 1's expectation of a free CSRF token).
- **Pagination envelope.** [step-5 §12](step-5-api-contract.md) recommends shipping the `{ data, next_cursor }` envelope from day 1. Decide before the first list endpoint lands; retrofitting later is a breaking change.
- **Soft delete cascade semantics.** Deleting a project should hide its packages from list endpoints but not cascade `deleted_at` to them. Pick a convention (filter on the join in the API, or denormalize parent `deleted_at`) and use it consistently.
