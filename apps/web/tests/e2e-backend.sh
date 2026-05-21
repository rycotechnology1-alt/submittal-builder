#!/usr/bin/env bash
# Phase 6 end-to-end backend smoke. See e2e-backend.ts for the full flow.
#
# Required env (passed straight through):
#   DATABASE_URL or DATABASE_URL_POOLED_DEV or DATABASE_URL_DIRECT_DEV
#   AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#   S3_BUCKET (or S3_BUCKET_DEV)
#   ANTHROPIC_API_KEY
#
# Optional:
#   E2E_BASE_URL   (default http://localhost:3000)
#   E2E_WORKER_URL (default http://localhost:8080)
#
# This script is the canonical CI entry point. It assumes both the web app and
# the worker are reachable at their healthz endpoints before it starts.

set -euo pipefail

script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
repo_root="$( cd "$script_dir/../../.." && pwd )"

cd "$repo_root"

pnpm --filter @submittal/web exec tsx apps/web/tests/e2e-backend.ts "$@"
