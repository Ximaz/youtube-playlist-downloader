#!/bin/sh
# Bridge the user-facing env vars → Nuxt's SERVER-side runtime config keys, BEFORE Node
# starts. Nuxt overrides runtimeConfig from `NUXT_<KEY>` env vars only, so we translate the
# friendly names here.
#
#   BACKEND_URL   → NUXT_BACKEND_URL    (internal backend base; the BFF proxies here)
#   COOKIE_SECURE → NUXT_COOKIE_SECURE  ('false' only for plain-http dev)
#
# backendUrl is server-only now (the browser never sees it): the Nitro server is the sole
# caller of the backend. Precedence: BACKEND_URL → NUXT_BACKEND_URL → http://backend:3000.
set -e

export NUXT_BACKEND_URL="${BACKEND_URL:-${NUXT_BACKEND_URL:-http://backend:3000}}"
export NUXT_COOKIE_SECURE="${COOKIE_SECURE:-${NUXT_COOKIE_SECURE:-true}}"

exec node .output/server/index.mjs
