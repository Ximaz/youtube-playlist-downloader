# syntax=docker/dockerfile:1
# Build context = repo root (workspace member; needs packages/shared + root lockfile).

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
# Scope to @ypd/frontend... so the backend's prisma-generate postinstall is
# never invoked (its schema isn't in this build context). BuildKit cache
# mount keeps the pnpm store warm across builds.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @ypd/frontend... --config.storeDir=/pnpm-store
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
# Build the shared package first (Nuxt's typecheck reads its compiled types), then
# the Nuxt app. The Nuxt build emits `.output/` (Nitro server + client bundle).
# No browser-facing URL is baked here: backendUrl is server-only and read at container
# start from the BACKEND_URL env var (the Nitro BFF is the sole caller of the backend).
RUN pnpm --filter @ypd/shared build && pnpm --filter @ypd/frontend build

# Runtime: bare Node, runs Nuxt's Nitro server which serves the SPA + injects the
# runtime config into the initial HTML. nginx is no longer needed — Nitro handles
# both static assets and the runtime-config injection in one process.
FROM node:24-alpine AS runtime
RUN apk add --no-cache tini && \
    addgroup -S -g 1001 ypd && \
    adduser -S -u 1001 -G ypd -h /app ypd
WORKDIR /app
# Copy only the Nuxt build output — no node_modules, no source. The Nitro bundle
# is self-contained (deps inlined) so the runtime image stays small.
COPY --from=build --chown=ypd:ypd /repo/apps/frontend/.output ./.output
COPY --chown=ypd:ypd apps/frontend/docker-entrypoint.sh /usr/local/bin/ypd-frontend-entrypoint
RUN chmod +x /usr/local/bin/ypd-frontend-entrypoint

USER ypd
ENV NITRO_HOST=0.0.0.0 \
    NITRO_PORT=8080
EXPOSE 8080

# tini as PID 1 so SIGTERM from `docker stop` reaches Node and Nitro can shut its
# HTTP server down cleanly. The entrypoint script translates the user-facing
# BACKEND_URL / COOKIE_SECURE envs into NUXT_BACKEND_URL / NUXT_COOKIE_SECURE before
# exec'ing node, because Nitro freezes the runtime config after init — env-var
# translation must happen in the parent process.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/ypd-frontend-entrypoint"]

# Probe the dependency-free /healthz route (not the SPA document) so the healthcheck never
# triggers anonymous-session minting and stays cheap.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
