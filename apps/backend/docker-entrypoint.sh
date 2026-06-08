#!/bin/sh
# YPD backend container entrypoint.
#
# Apply any pending Prisma migrations against the 'database' service when
# MIGRATE_ON_START=true (default), then hand off to Node. `exec` so Node receives
# the PID-2 slot (tini stays PID 1 and forwards signals to it).
#
# In prod, set MIGRATE_ON_START=false and run `prisma migrate deploy` from a
# controlled CI step / init container so a rolling restart doesn't race against
# its own migration. See docs/oauth.md.

set -eu

if [ "${APP_ROLE:-all}" = "worker" ]; then
  echo "[entrypoint] APP_ROLE=worker — skipping migrations (the api/all role owns them)"
elif [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] applying Prisma migrations…"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[entrypoint] MIGRATE_ON_START=false — skipping prisma migrate deploy"
fi

echo "[entrypoint] starting Nest (role=${APP_ROLE:-all})…"
exec node dist/main.js
