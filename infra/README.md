# Infra

Deploy artifacts for the Submittal Builder MVP backend. Live services are
provisioned out-of-band (Phase 0); the files here describe how the apps
themselves run.

## Layout

- `worker/Dockerfile` — Fly.io image for `apps/worker`. Installs **qpdf** in
  the runtime stage so `packages/shared/src/pdf/repair.ts` can fall back to it
  when `pdf-lib` cannot parse a source PDF. Without qpdf, exports that hit a
  malformed source PDF are marked `failed`.
- `worker/fly.toml` — Fly app config. Healthchecks `GET /healthz` every 15s
  per step-8-buildplan.md Phase 6.
- `s3-cors.json` — S3 bucket CORS rules. Allows browser PUT to presigned URLs.

## AWS IAM permissions

The worker and web API use the AWS credentials to read/write source PDFs and
let Textract read documents from S3. CORS only controls browser uploads; it does
not grant the worker access to S3 objects. The IAM identity needs:

- `s3:ListBucket` on `arn:aws:s3:::<bucket>`
- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on
  `arn:aws:s3:::<bucket>/*`
- `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`,
  and `textract:DetectDocumentText`

## Deploying

Worker:

```sh
# from repo root
fly deploy -c infra/worker/fly.toml --dockerfile infra/worker/Dockerfile \
  --build-arg GIT_SHA=$(git rev-parse HEAD)
```

Web app deploys to Vercel — no Dockerfile is required there. Vercel reads
`apps/web/next.config.mjs` and the project root.

## Required secrets (set via `fly secrets set ...`)

```
DATABASE_URL_DIRECT
S3_BUCKET
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
ANTHROPIC_API_KEY
SENTRY_DSN_WORKER
```

Optional:
- `ANTHROPIC_CLASSIFY_MODEL` / `ANTHROPIC_EXTRACT_MODEL` (defaults to
  `claude-sonnet-4-6`)
- `GIT_SHA` is set automatically by the Fly build arg and surfaced via
  `/healthz` to confirm rollouts.

## Sentry source map upload

The web build is wrapped by `@sentry/nextjs`. Configure the upload via
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB` on Vercel — the
plugin runs during `next build` when those are present.

The worker Dockerfile emits source maps from `tsc` (`sourceMap: true` in the
base tsconfig). Upload them with the Sentry CLI in a release-command step
(see `worker/fly.toml`). For Phase 6 we capture this in the handoff doc;
in V1.1 it should move into the Dockerfile.
