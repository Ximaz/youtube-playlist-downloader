# syntax=docker/dockerfile:1
# Build context = repo root (workspace member; needs packages/shared + root lockfile).

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

FROM base AS build
# Manifests + Prisma schema first, so postinstall (`prisma generate`) can run
# during install and the resulting node_modules layer is fully cacheable —
# invalidated only when the lockfile, package manifests, or the schema change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/frontend/package.json apps/frontend/
# Scope to @ypd/backend... so the frontend's deps aren't pulled and its
# postinstalls aren't visited. BuildKit cache mount keeps the pnpm store
# warm across builds (rebuilds reuse it; clean builds get a fresh store).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @ypd/backend... --config.storeDir=/pnpm-store
# Sources, then build shared types + Nest.
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @ypd/shared build \
 && pnpm --filter @ypd/backend build
# Self-contained prod deploy (workspace deps copied in, dev deps dropped).
# pnpm deploy doesn't reliably re-fire postinstall in /app, so we generate the
# Prisma client there explicitly to guarantee .prisma/client is populated.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @ypd/backend deploy --legacy --prod /app --config.storeDir=/pnpm-store \
 && cd /app && ./node_modules/.bin/prisma generate \
 # Strip build-only artifacts from the runtime image. Prisma CLI + engines are only
 # needed at deploy-time (migrate deploy at container start uses node_modules/.bin/prisma
 # from the runtime image — kept intentionally). The CLI itself is the heaviest bit.
 && rm -rf /app/node_modules/.cache /app/tsconfig.tsbuildinfo /app/tsconfig.build.tsbuildinfo

FROM node:24-alpine AS runtime
# tini = PID 1 init: reaps zombies, forwards signals (SIGTERM → Node).
# ffmpeg = transcoder used by the convert pipeline.
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
ENV NODE_ENV=production \
    BACKEND_PORT=3000
COPY --from=build --chown=node:node /app /app
# The entrypoint script lives in the repo so it can be linted / reviewed; the
# Dockerfile is the one place that needs to mark it executable.
RUN chmod 0755 /app/docker-entrypoint.sh
# Drop root before running the app.
USER node
EXPOSE 3000
# wget is in BusyBox; matches the compose healthcheck so behavior is consistent
# whether the image runs under compose or standalone.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=12 \
    CMD wget -q -O - http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
