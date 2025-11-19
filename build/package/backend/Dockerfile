FROM oven/bun:1.3.2-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./

RUN bun install --frozen-lockfile --production

COPY internal ./internal

COPY web ./web

WORKDIR /app/web/backend

RUN bun install --frozen-lockfile --production

RUN bun build \
    --target bun \
    --outdir /app/dist \
    index.ts \
    infrastructure/workers/download-videos.ts

FROM oven/bun:1.3.2-alpine AS ypd-backend

WORKDIR /app

COPY --from=build /app/dist ./dist

RUN cp /app/dist/infrastructure/workers/download-videos.js /app/dist/

RUN rm -rf /app/dist/infrastructure/workers

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --production

ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["bun", "--cwd", "./dist", "index.js"]
