FROM node:22-alpine3.22 AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY tsconfig.json nuxt.config.ts eslint.config.mjs ./

COPY app ./app/

COPY server ./server/

COPY public ./public/

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
