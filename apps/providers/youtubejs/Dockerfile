# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# ---- builder: full install + tsc build (standalone; no workspace in context) ----
FROM base AS builder
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---- deps: production-only node_modules ----
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime ----
FROM node:24-alpine AS runtime
# tini = PID 1 init: reaps any subprocesses youtubei.js or its deps spawn, forwards SIGTERM
# to Node so the `process.on('SIGTERM', ...)` handler in src/index.ts closes the http server.
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=5001 \
    LOG_LEVEL=info
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
USER app
EXPOSE 5001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=12 \
    CMD wget -q -O - http://127.0.0.1:5001/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
