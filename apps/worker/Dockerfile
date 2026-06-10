# syntax=docker/dockerfile:1
# Build context = repo root (workspace member; needs packages/shared + packages/backend-core + the
# root lockfile). This image runs ONLY the BullMQ download/convert pools + ffmpeg; it has no Prisma,
# Swagger, Socket.IO or REST surface (just /health, /ready, /metrics probes).

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

FROM base AS build
# Every workspace manifest is copied so `pnpm install --frozen-lockfile` can resolve the full
# workspace graph; `--filter @ypd/worker...` then installs ONLY the worker + its workspace deps
# (shared, backend-core). Other packages' postinstalls (e.g. backend's prisma generate) are never
# invoked because they're out of the install scope. BuildKit cache mount keeps the pnpm store warm.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend-core/package.json packages/backend-core/
COPY apps/worker/package.json apps/worker/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @ypd/worker... --config.storeDir=/pnpm-store
# Sources, then build shared types -> backend-core lib -> the worker (topological order).
COPY packages/shared packages/shared
COPY packages/backend-core packages/backend-core
COPY apps/worker apps/worker
RUN pnpm --filter @ypd/shared build \
 && pnpm --filter @ypd/backend-core build \
 && pnpm --filter @ypd/worker build
# Self-contained prod deploy (workspace deps copied in, dev deps dropped). No Prisma — the worker
# never touches Postgres, so there is no prisma generate and no Prisma engines in the image.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @ypd/worker deploy --legacy --prod /app --config.storeDir=/pnpm-store \
 && rm -rf /app/node_modules/.cache /app/tsconfig.tsbuildinfo /app/tsconfig.build.tsbuildinfo

FROM node:24-alpine AS runtime
# tini = PID 1 init: reaps zombies, forwards signals (SIGTERM → Node) so BullMQ drains on shutdown.
# ffmpeg = transcoder used by the convert pipeline — lives ONLY in the worker image.
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
ENV NODE_ENV=production \
    BACKEND_PORT=3000
COPY --from=build --chown=node:node /app /app
# The entrypoint script lives in the repo so it can be linted / reviewed; the Dockerfile is the one
# place that needs to mark it executable.
RUN chmod 0755 /app/docker-entrypoint.sh
# Drop root before running the app.
USER node
EXPOSE 3000
# wget is in BusyBox; matches the compose healthcheck so behavior is consistent whether the image
# runs under compose or standalone. The worker serves the dependency-free /health liveness probe.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=12 \
    CMD wget -q -O - http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
