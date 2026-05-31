# Phase 4 No-UI Smoke Runner

Use this while there is no frontend UI for live testing.

## What It Exercises

`pnpm smoke:phase4` drives the live HTTP API and worker path:

1. Checks web `/api/v1/healthz` and worker `/healthz`.
2. Signs up a throwaway user.
3. Marks that user email-verified directly in the dev database.
4. Signs in and keeps the session cookie.
5. Creates a project and package.
6. Presigns and uploads two fixture PDFs to S3.
7. Confirms both PDFs.
8. Calls `POST /api/v1/packages/:id/process`.
9. Polls `/status` until the package is `ready`.
10. Fetches `/items` and asserts attributes, confidence, citations, and `original_ai_value`.

## How To Run

Terminal 1:

```powershell
pnpm --filter @submittal/web dev
```

Terminal 2:

```powershell
pnpm --filter @submittal/worker dev
```

Terminal 3:

```powershell
pnpm smoke:phase4
```

Optional overrides:

```powershell
$env:PHASE4_SMOKE_BASE_URL = "http://localhost:3000"
$env:PHASE4_SMOKE_WORKER_URL = "http://localhost:8080"
pnpm smoke:phase4
```

## Required Live Env

The runner needs the same `.env.local` values as the app:

- `DATABASE_URL` or `DATABASE_URL_POOLED_DEV` or `DATABASE_URL_DIRECT_DEV`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `AWS_REGION`
- `S3_BUCKET` or `S3_BUCKET_DEV`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `ANTHROPIC_API_KEY`

If the worker handles scanned pages, Textract permissions must also be live for the S3 bucket.
