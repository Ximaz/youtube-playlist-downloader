# Backend

This folder contains the backend and all the business logic related to :

- fetching video and playlist metadata;
- downloading streams;
- storing streams;
- converting streams;
- caching information;
- queuing requests to avoid resource overflow.

## Setup

This project uses [pnpm](https://pnpm.io/installation) to manage packages.

It is designed to run using the [NodeJS](https://nodejs.org/en) runtime.

The backend server is powered by [Hono](https://hono.dev/). It is fast, powerful
and simple.

[ffmpeg](https://ffmpeg.org/) is also used to post-process downloaded streams.

The whole project is powered by [LuanRT/googlevideo](https://github.com/LuanRT/googlevideo).

## Environment variables

In order to work properly, and as this project will be containerizable, some
environment variables are recommended.

```bash
# S3 Storage Provider configuration
S3_API_REGION="eu-west-1"
S3_API_ENDPOINT="http://localhost:9000" # change 'localhost' by the service name.
S3_API_ACCESS_KEY_ID="minioadmin" # You may want to change that.
S3_API_SECRET_ACCESS_KEY="minioadmin" # You may want to change that.

# Redis configuration
REDIS_HOST="localhost" # change 'localhost' by the service name.
REDIS_PORT=6379

# Backend configuration
WORKERS_CAPACITY=3
```

## Getting started

### Dependencies

In order to run this project, you first need to install the dependencies :

```bash
pnpm install
```

### Bundler

This project uses the [tsup](https://tsup.egoist.dev/) bundler to :

- resolve aliased paths used in Typescript,
- transpile Typescript source code into ESM Javascript.

To run it, you should open a side terminal and paste this command :

```bash
pnpm build:prod
```

> NOTE: If you want hot-reload for development environment, use this instead :

```bash
pnpm build:dev
```

### Starting the server

Finally, to run the built server, you can type this command :

```bash
pnpm start:prod
```

> NOTE: If you want hot-reload for development environment, use this instead :

```bash
pnpm start:dev
```

### Reaching the server

Once done, the backend server is reachable at `http://localhost:3000`.
