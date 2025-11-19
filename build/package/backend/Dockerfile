# ============================
# Build stage
# ============================
FROM oven/bun:1.3.2-alpine AS build

WORKDIR /app

# Copy only root-level dependency manifests first for caching
COPY package.json bun.lock tsconfig.json ./

# Install root dependencies (shared libs and internal imports)
RUN bun install --frozen-lockfile --production

# Copy full source so that TypeScript path aliases work
COPY internal ./internal
COPY web ./web

# Install web/backend dependencies
WORKDIR /app/web/backend

RUN bun install --frozen-lockfile --production

# Build application but WITHOUT bundling everything into one output,
# because workers need to remain separate files.
#
# Bun's build command, by default, does bundling. Instead,
# we compile TypeScript to JavaScript without bundling:
RUN bun build \
    --target bun \
    --outdir /app/dist \
    index.ts \
    infrastructure/workers/download-videos.ts

# ============================
# Production stage
# ============================
FROM oven/bun:1.3.2-alpine AS production

WORKDIR /app

# Copy compiled app
COPY --from=build /app/dist ./dist

RUN cp /app/dist/infrastructure/workers/download-videos.js /app/dist/

RUN rm -rf /app/dist/infrastructure/workers

# Copy root dependency manifests
COPY package.json bun.lock ./

# Install minimal production dependencies
RUN bun install --frozen-lockfile --production

ENV PORT=3000
EXPOSE 3000

# The server must run from the compiled JS folder
ENTRYPOINT ["bun", "--cwd", "./dist", "index.js"]
