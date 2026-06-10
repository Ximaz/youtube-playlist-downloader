#!/bin/sh
# YPD worker container entrypoint.
#
# The worker never owns Prisma migrations (the API role does — see apps/backend), so there is no
# migrate step here. `exec` so Node receives the PID-2 slot (tini stays PID 1 and forwards signals
# to it, letting NestJS shutdown hooks drain the BullMQ pools on SIGTERM).

set -eu

echo "[worker] starting download/convert pools (download=${DOWNLOAD_CONCURRENCY:-default} convert=${CONVERT_CONCURRENCY:-default})…"
exec node dist/main.js
