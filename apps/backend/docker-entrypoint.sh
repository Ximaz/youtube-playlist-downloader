#!/bin/sh
# YPD backend (API) container entrypoint.
#
# The API image owns Prisma migrations (the worker image runs none). Apply any pending migrations
# against the 'database' service when MIGRATE_ON_START=true (default), then hand off to Node.
# `exec` so Node receives the PID-2 slot (tini stays PID 1 and forwards signals to it).
#
# In prod, set MIGRATE_ON_START=false and run `prisma migrate deploy` from a controlled CI step /
# init container so a rolling restart doesn't race against its own migration. See docs/oauth.md.

set -eu

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] applying Prisma migrations…"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[entrypoint] MIGRATE_ON_START=false — skipping prisma migrate deploy"
fi

echo "[entrypoint] starting YPD API…"
exec node dist/main.js
