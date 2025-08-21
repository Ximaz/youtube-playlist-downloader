FROM node:22-alpine3.22 AS build

LABEL org.opencontainers.image.authors="durand.malo.60590@gmail.com"

WORKDIR /app

RUN corepack enable

COPY package.json /app/package.json

COPY pnpm-lock.yaml /app/pnpm-lock.yaml

COPY pnpm-workspace.yaml /app/pnpm-workspace.yaml

RUN pnpm install --frozen-lockfile

COPY eslint.config.mjs /app/eslint.config.mjs

COPY .prettierrc /app/.prettierrc

COPY tsup.config.mjs /app/tsup.config.mjs

COPY tsconfig.json /app/tsconfig.json

COPY ./src /app/src

RUN pnpm lint:check

RUN pnpm format:check

RUN pnpm build:prod

FROM node:22-alpine3.22 AS ypd-backend

WORKDIR /app

RUN corepack enable

COPY package.json /app/package.json

COPY pnpm-lock.yaml /app/pnpm-lock.yaml

COPY pnpm-workspace.yaml /app/pnpm-workspace.yaml

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/package.json /app/package.json

COPY --from=build /app/dist /app/dist

EXPOSE 3000

ENTRYPOINT [ "node", "dist/index.js" ]
