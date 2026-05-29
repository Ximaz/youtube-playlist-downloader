#!/bin/sh
# Bridge the user-facing BACKEND_URL env var → Nuxt's NUXT_PUBLIC_BACKEND_URL.
#
# Why this exists: Nuxt's runtime config is overridable from env vars only via the
# `NUXT_<KEY>_<KEY>...` naming convention, and the public section is frozen by Nitro
# after init (so a Nitro plugin can't patch it). To present `BACKEND_URL` (no prefix)
# as the single env var that consumers set, we translate it here, BEFORE Node starts.
#
# Precedence: BACKEND_URL → NUXT_PUBLIC_BACKEND_URL → http://localhost:3000.
set -e

export NUXT_PUBLIC_BACKEND_URL="${BACKEND_URL:-${NUXT_PUBLIC_BACKEND_URL:-http://localhost:3000}}"

exec node .output/server/index.mjs
