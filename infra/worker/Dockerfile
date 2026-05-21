# Worker image for Fly.io. Built from the monorepo root:
#   docker build -f infra/worker/Dockerfile -t submittal-worker .
#
# Two-stage build keeps the runtime image small. qpdf is installed in the
# runtime stage so packages/shared/src/pdf/repair.ts can shell out to it when
# pdf-lib refuses to parse a source PDF. See step-8-phase-5-handoff.md.

# ----- Builder -----
FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Copy lockfile + workspace metadata first for better layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/tsconfig.json apps/worker/
COPY packages/db/package.json packages/db/tsconfig.json packages/db/
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/

RUN pnpm install --frozen-lockfile

# Copy sources after install for cache friendliness.
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

RUN pnpm --filter @submittal/db build \
 && pnpm --filter @submittal/shared build \
 && pnpm --filter @submittal/worker build

# Prune dev dependencies for the runtime stage.
RUN pnpm --filter @submittal/worker deploy --prod /out

# ----- Runtime -----
FROM node:20-bookworm-slim AS runtime

# qpdf is REQUIRED — Phase 5's repair fallback spawns it when pdf-lib cannot
# parse a source PDF. Without qpdf those exports are marked 'failed'.
RUN apt-get update \
 && apt-get install -y --no-install-recommends qpdf ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/package.json ./package.json
# Workspace deps are vendored under deploy/ — copy their compiled output too.
COPY --from=builder /app/packages/db/dist /app/packages/db/dist
COPY --from=builder /app/packages/db/package.json /app/packages/db/package.json
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json

ENV NODE_ENV=production
ENV WORKER_HEALTHZ_PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
