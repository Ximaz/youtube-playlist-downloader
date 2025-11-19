FROM node:22-alpine3.22 AS build

WORKDIR /app

RUN corepack enable

COPY ./web/frontend/package.json ./web/frontend/pnpm-lock.yaml ./web/frontend/pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY ./web/frontend/tsconfig.json ./web/frontend/nuxt.config.ts ./web/frontend/eslint.config.mjs ./

COPY ./web/frontend/app ./app/

COPY ./web/frontend/server ./server/

COPY ./web/frontend/public ./public/

RUN pnpm lint:check

RUN pnpm format:check

RUN pnpm build

FROM node:22-alpine3.22 AS ypd-frontend

WORKDIR /app

COPY --from=build /app/.output ./.output/

ENV HOST=0.0.0.0

ENV PORT=3000

EXPOSE 3000

CMD [ "node", "./.output/server/index.mjs" ]
