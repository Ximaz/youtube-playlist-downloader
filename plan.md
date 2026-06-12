# YPD — Workstream F: Kubernetes deployment, autoscaling & stateful pluggability

> This plan is **self-contained** (the prior discussion will be compacted). It first records the
> full current state, then the detailed F implementation.

---

## CONTEXT — what YPD is and what's already done

**YPD** = YouTube Playlist Downloader. Three layers, each ignorant of the one above:
`Browser (Vue/Nuxt SPA) → Nuxt BFF (Nitro, proxies /api + /socket.io) → Backend (NestJS) → two
interchangeable HTTP providers (yt-dlp Python, youtubei.js Node)`. Backend uses **Valkey** (cache +
BullMQ queue + WorkStore + OAuth/anon-session-cache + Socket.IO pub/sub), **Postgres** (Prisma:
Session + OAuthAccount), **S3** (artifacts), **ffmpeg** (conversion).

**A large scaling/resilience effort is COMPLETE and verified end-to-end (Workstreams C, D, A, B, E).
Only Workstream F (this plan) remains.** What's already in place (do NOT redo):

- **Backend resilience (C):** Valkey client has `commandTimeout` + capped `retryStrategy` + error
  listeners ([cache.service.ts](apps/backend/src/cache/cache.service.ts)); S3 client has connect/
  request timeouts + honest not-found-vs-outage ([storage.service.ts](apps/backend/src/storage/storage.service.ts));
  per-provider circuit breaker + per-provider concurrency budgets ([provider-client.service.ts](apps/backend/src/providers/provider-client.service.ts));
  `/ready` requires infra + **≥1 provider** (not all) ([health.controller.ts](apps/backend/src/health/health.controller.ts));
  global `unhandledRejection`/`uncaughtException` guards ([main.ts](apps/backend/src/main.ts)).
- **Frontend resilience (D):** REST retry/backoff for idempotent GETs; **batch persisted to
  localStorage + rehydrate→fetchStatus→re-subscribe** on refresh; fetchStatus resync on reconnect;
  path-aware BFF timeout (archive exempt); `/healthz` Nitro route. ([useDownloadBatch.ts](apps/frontend/app/composables/useDownloadBatch.ts), [api.ts](apps/frontend/app/lib/api.ts), [server/api/[...].ts](apps/frontend/server/api/[...].ts), [server/routes/healthz.get.ts](apps/frontend/server/routes/healthz.get.ts))
- **Anonymous sessions + tier (ADR 0014):** every visitor gets an opaque `Session` (additive
  `tier`(default `paid`)/`userAgent`/`ip` columns; migration `20260608194500_anon_session_tier`).
  BFF mints on first browser nav (`Accept: text/html`-gated) via `POST /auth/session`; self-heals
  stale cookies via `POST /api/session`. `/auth/me` returns `tier`. ([auth.service.ts](apps/backend/src/auth/auth.service.ts), [auth.controller.ts](apps/backend/src/auth/auth.controller.ts), [server/middleware/ensure-session.ts](apps/frontend/server/middleware/ensure-session.ts), [server/api/session.post.ts](apps/frontend/server/api/session.post.ts))
- **Physical API/worker split (A, ADR 0018 — supersedes 0015):** TWO images sharing types via
  `@ypd/shared` and NestJS infra via `packages/backend-core`. `apps/backend` → image `ypd-backend`
  (HTTP REST + WS gateway + Prisma migrations + ENQUEUE; **no ffmpeg**); `apps/worker` → image
  `ypd-worker` (the BullMQ download/convert pools + ffmpeg + S3; minimal HTTP for `/health` +
  `/ready` + `/metrics` only; **no Prisma/Swagger/Socket.IO**). The image **IS** the role —
  `APP_ROLE`/`runsApi`/`runsWorkers` are deleted. Workers run no migrations
  ([apps/worker/docker-entrypoint.sh](apps/worker/docker-entrypoint.sh)); processors set
  `lockDuration: 90_000`. compose runs `backend` + `backend-worker` from the two images. Throughput =
  N_workers × `DOWNLOAD_CONCURRENCY`. (API enqueue side: [download.module.ts](apps/backend/src/download/download.module.ts); pools: [apps/worker/src/download/](apps/worker/src/download/))
- **Socket.IO Valkey adapter (B, ADR 0016):** `@socket.io/redis-adapter@8.3.0` via a
  `RedisIoAdapter` on `CACHE_URL` ([redis-io.adapter.ts](apps/backend/src/realtime/redis-io.adapter.ts)),
  wired in main.ts on the API (the worker image serves no sockets); Valkey ACL gained `+@pubsub`; WS handshake session lookup
  is Valkey-cached (`ws:sess:<id>`, 60s). Cross-replica room fan-out verified.
- **Provider tier (E, ADR 0017):** scale by replicas (no `--workers`). Both providers: upstream
  throttle/bot-check → **429 RATE_LIMITED + Retry-After**; saturation-aware **`/ready`** (youtubejs
  event-loop lag; ytdl in-flight-extract vs threadpool) that 429s NEW extraction while streaming
  continues. **PO-tokens via a shared `provider-pot` sidecar** (`brainicism/bgutil-ytdlp-pot-provider:1.3.1`):
  ytdl uses its `bgutil-ytdlp-pot-provider==1.3.1` yt-dlp plugin (`fetch_pot=if_required`, dormant
  until needed); youtubejs escalates per-video on bot-check via `POST /get_pot` then a WEB Innertube.
  Env `POT_PROVIDER_BASE_URL`. In-process jsdom generation was tried and abandoned (BotGuard won't
  attest outside a real browser). youtubejs `#parallelDownload` was rewritten to direct ranged
  `fetch` (decipher URL once + independent ranged requests + retry + AbortController) — fixed a
  >2 MiB stall on the fallback streamer.

**Current runtime (docker-compose, all verified healthy):** `storage` (SeaweedFS), `cache` (Valkey
8.1, ACL-locked), `database` (Postgres 17), `provider-ytdl`, `provider-youtubejs`, `provider-pot`,
`backend` (image `ypd-backend`, port 3000), `backend-worker` (image `ypd-worker`), `frontend` (Nuxt
BFF, 8080) — no `APP_ROLE`; each image is its role.
**CI** (`.github/workflows/ci.yml`) lints/typechecks/builds + **pushes images to GHCR** for
`backend`, `worker`, `frontend`, `provider-ytdl`, `provider-youtubejs` (provider-pot is an upstream image).
Every dependency is reachable by connection-string env only (`CACHE_URL`, `DATABASE_URL`, `S3_*`,
`POT_PROVIDER_BASE_URL`). Probes exist: backend `/health`+`/ready`, frontend `/healthz`, provider
`/health`+`/ready`; Prometheus `/metrics` on backend + both providers.

### Why F
Turn the (already K8s-ready) app into a real **cloud-agnostic Kubernetes deployment** where **every
stateful dependency is pluggable — in-cluster Pod OR external managed service — with zero code
change**, and the cluster **autoscales, drains, and recovers**. Target path: **Proxmox + Terraform**
for infra testing → **OVH/Outscale** later; cluster via **Kubespray**, app via **Ansible + Helm**.

### Locked decisions (chosen with the user)
- **Helm chart** (one chart, per-env values; value toggles Pod-vs-managed per dependency).
- **KEDA** for `backend-worker` autoscaling on **BullMQ backlog** (via a `metrics-api` trigger →
  a small backend backlog endpoint — see Part 1.2; this avoids requiring a Prometheus stack just to
  scale and correctly counts *prioritized* jobs). Other tiers use **stock CPU/mem HPA** (no
  Prometheus add-on required for autoscaling).
- **WebSocket-only** client transport (drop polling) → no sticky-session requirement at the ingress.
- **Anon-session GC** via a K8s **CronJob** running the backend image.
- Start with a **single `backend-worker` role** (both pools); document optional download/convert
  split. Build/validate the **Proxmox (in-cluster)** values first; OVH/managed values via toggles.

---

## PART 1 — App-side seams to land FIRST (verifiable in `docker compose` before any YAML)

These are small in-repo changes that make the manifests clean. Each must pass typecheck/lint/tests
and be smoke-tested in compose before writing Helm.

**1.1 Valkey keyspace split seam.** Add two URLs defaulting to today's single `CACHE_URL` so dev is
unchanged: `QUEUE_CACHE_URL` (durable: BullMQ queues, QueueEvents, **WorkStore** `result:`/`batch:`,
`withLock`) and `EPHEMERAL_CACHE_URL` (evictable: metadata/negative cache, `ws:sess:`, Socket.IO
adapter pub/sub). Implementation: in [configuration.ts](apps/backend/src/config/configuration.ts)
`cache: { url, queueUrl, metadataTtlSeconds, commandTimeoutMs }` (queueUrl ?? url; url unchanged).
Give [cache.service.ts](apps/backend/src/cache/cache.service.ts) a second iovalkey client for the
durable side and route `withLock` + new `durableGetJson/setJson/get/set` there; [work-store.service.ts](apps/backend/src/download/work-store.service.ts)
uses the durable methods (WorkStore results must survive eviction). [jobs.module.ts](apps/backend/src/jobs/jobs.module.ts)
+ the gateway QueueEvents read `cache.queueUrl`; the [redis-io.adapter.ts](apps/backend/src/realtime/redis-io.adapter.ts)
stays on `cache.url` (ephemeral). **Highest-effort seam — keep both clients' error/timeout config
identical to the existing one.** Default both to one URL → behavior identical until prod splits them.

**1.2 KEDA backlog endpoint + `prioritized` count.** Downloads always set a BullMQ `priority`
([download.service.ts](apps/backend/src/download/download.service.ts) `durationPriority`), so waiting
jobs live in the `prioritized` ZSET, **not** the `wait` list — a KEDA Redis `listLength` scaler would
read ~0. Fix: (a) add `'prioritized'` to the `getJobCounts(...)` call in
[queue-depth.collector.ts](apps/worker/src/observability/queue-depth.collector.ts) (now worker-side)
so the `bullmq_queue_depth` gauge is accurate; (b) add a tiny **cluster-internal** endpoint on the api,
e.g. `GET /scaling/backlog` → `{ download, convert, total }` where each = `getJobCounts('waiting',
'prioritized','delayed')` summed. KEDA's `metrics-api` scaler reads `total`. (Alternative noted only:
KEDA `prometheus` scaler if a Prometheus stack is later deployed.)

**1.2b Worker capacity metrics (DONE).** Each worker exports `bullmq_worker_active{pool}` +
`bullmq_worker_concurrency{pool}` ([metrics.service.ts](packages/backend-core/src/observability/metrics.service.ts);
inc/dec around each `process()` + set in the processors' `onModuleInit`), and the API exports
`bullmq_workers_connected{queue}` ([workers.collector.ts](apps/backend/src/observability/workers.collector.ts)
via `queue.getWorkers()`). PromQL `sum(bullmq_worker_active)/sum(bullmq_worker_concurrency)` is fleet
utilization — a ready signal for a KEDA `prometheus` scaler or an HPA external metric, complementing
the backlog scaler. (Workers are pull-based, so this drives autoscaling/observability, not LB routing.)

**1.3 WebSocket-only transport.** Change [socket.ts](apps/frontend/app/lib/socket.ts) `transports:
['websocket','polling']` → `['websocket']`. Removes the engine.io multi-request polling handshake →
no sticky sessions needed across `backend-api` replicas (the Valkey adapter already makes rooms
cluster-correct). The Nitro WS-upgrade proxy in [server/middleware/socketio.ts](apps/frontend/server/middleware/socketio.ts)
already proxies the upgrade; the polling HTTP branch becomes unused (leave it).

**1.4 Reconcile `DOWNLOAD_CONCURRENCY` default.** Code default is 6 ([configuration.ts:72](apps/backend/src/config/configuration.ts)),
shipped env is 3 ([secrets/backend/.env.example](secrets/backend/.env.example)). Pick one as the
per-worker HPA unit (recommend keep env-driven, set explicitly in Helm values) and align the example.

**1.5 Anonymous-session prune (for the CronJob).** Add `AuthService.pruneAnonymousSessions(olderThanDays)`
— `prisma.session.deleteMany({ where: { account: null, createdAt: { lt: cutoff } } })` (cascade is
moot since these have no account) — plus a standalone entry `src/main.prune.ts` (`NestFactory.create
ApplicationContext`, run prune, `app.close()`, exit). The CronJob runs `node dist/main.prune.js`.

**1.6 S3 incomplete-multipart-upload lifecycle.** In [storage.service.ts](apps/backend/src/storage/storage.service.ts)
`onModuleInit`, best-effort `PutBucketLifecycleConfiguration` with an `AbortIncompleteMultipartUpload`
rule (e.g. 1 day); tolerate failure (SeaweedFS may not support it) and log. For managed S3 it just
works; document the rule for ops too.

*(Prisma pool + `statement_timeout` are env-only — append `?connection_limit=N&statement_timeout=ms`
to `DATABASE_URL` in the api values; already documented in the env example. No code.)*

---

## PART 2 — Helm chart layout

New tree `infra/helm/ypd/` (nothing infra exists today):

```
infra/helm/ypd/
  Chart.yaml                       # appVersion tracks the image tag
  values.yaml                      # defaults: everything in-cluster, 1 replica (dev-like)
  values-proxmox.yaml              # in-cluster StatefulSets, modest replicas (FIRST target)
  values-ovh.yaml                  # external managed Valkey/PG/S3, scaled replicas
  templates/
    _helpers.tpl                   # image refs, connection-string resolver (Pod vs managed), labels
    configmap-backend.yaml         # non-secret backend env (knobs; no APP_ROLE — the image is the role)
    configmap-frontend.yaml        # BACKEND_URL, COOKIE_SECURE
    configmap-providers.yaml       # STREAM_SEGMENT_*, POT_PROVIDER_BASE_URL, breaker knobs
    secret.yaml                    # CACHE_URL/QUEUE_CACHE_URL/EPHEMERAL_CACHE_URL, DATABASE_URL,
                                   #   S3_*, GOOGLE_CLIENT_* — OR reference an existing Secret
    frontend.{deployment,service,hpa}.yaml
    backend-api.{deployment,service,hpa}.yaml
    backend-worker.{deployment}.yaml + backend-worker.scaledobject.yaml   # KEDA
    provider-ytdl.{deployment,service,hpa}.yaml
    provider-youtubejs.{deployment,service,hpa}.yaml
    provider-pot.{deployment,service}.yaml
    ingress.yaml
    migrate.job.yaml               # Helm pre-install/pre-upgrade hook (prisma migrate deploy)
    prune-sessions.cronjob.yaml    # node dist/main.prune.js
    pdb.yaml                       # PodDisruptionBudgets (api, worker, providers)
    # rendered ONLY when .Values.<dep>.inCluster:
    valkey.{statefulset,service}.yaml
    postgres.{statefulset,service}.yaml
    seaweedfs.{statefulset,service}.yaml
```

**Images:** `ghcr.io/<owner>/ypd-{backend,worker,frontend,provider-ytdl,provider-youtubejs}:<tag>` (from CI)
+ `brainicism/bgutil-ytdlp-pot-provider:1.3.1` for provider-pot. Tag pinned in values (`global.imageTag`).

**Per-component manifests (key points):**
- **frontend** — Deployment N≥2, stateless; Service; public **Ingress** (TLS); probes → `/healthz`;
  HPA CPU/mem; env `BACKEND_URL=http://<release>-backend-api:3000`, `COOKIE_SECURE=true`.
- **backend-api** — Deployment N≥2; image `ypd-backend`; Service (ClusterIP, port 3000); readiness→`/ready`,
  liveness→`/health`; HPA CPU/mem; `terminationGracePeriodSeconds: 40` + the existing shutdown hooks.
- **backend-worker** — Deployment; image `ypd-worker`; **no Service for traffic** (headless for scrape
  optional); liveness→`/health`; **KEDA ScaledObject** (Part 4); `terminationGracePeriodSeconds: 40`
  (drains in-flight jobs; BullMQ re-runs anything stalled via the 90s lock).
- **provider-ytdl / provider-youtubejs** — Deployments; Services; readiness→`/ready` (drains a
  saturated/soft-banned replica), liveness→`/health`; HPA CPU/mem; **Pod anti-affinity** (spread
  across nodes → distinct egress IPs for YouTube throttle isolation); env from configmap-providers.
- **provider-pot** — Deployment (1–2); Service; not on the critical path (providers degrade if down).

---

## PART 3 — Stateful pluggability (in-cluster Pod OR external managed, per dependency)

Each stateful dep has `.Values.<dep>.inCluster: bool`. `_helpers.tpl` exposes a resolver that returns
the effective connection string: when `inCluster` → the in-cluster Service DNS; else →
`.Values.<dep>.externalSecretRef` (or `externalUrl`). The Deployments consume only the resolved
env/Secret, so **switching is values-only, never code**:

| Dep | inCluster (proxmox) | managed (ovh) | Env produced |
|---|---|---|---|
| Valkey | `valkey.statefulset.yaml` + PVC | managed Redis (Sentinel/cluster) | `CACHE_URL` / `QUEUE_CACHE_URL` / `EPHEMERAL_CACHE_URL` |
| Postgres | `postgres.statefulset.yaml` + PVC | managed PG (+pgbouncer) | `DATABASE_URL` (+ pool params) |
| S3 | `seaweedfs.statefulset.yaml` + PVC | real S3 / OVH Object Storage | `S3_ENDPOINT` + `S3_*` |

In-cluster Valkey StatefulSet reuses the **same ACL command** as compose (incl. `+@pubsub` and
`+client|list`, the latter for the API's `bullmq_workers_connected` fleet metric via `getWorkers()`). When
the keyspace split is used in-cluster, two Valkey StatefulSets (or one with two logical DBs) — values
decide. Postgres/SeaweedFS StatefulSets get PVCs sized by values.

---

## PART 4 — Autoscaling, probes, draining, migrations, GC

- **KEDA (worker scaler):** add KEDA as a cluster add-on (Helm dependency or Ansible step). A
  `ScaledObject` targets the `backend-worker` Deployment with a **`metrics-api`** trigger hitting
  `http://<release>-backend-api:3000/scaling/backlog` (Part 1.2), `targetValue` = jobs-per-replica
  (e.g. `DOWNLOAD_CONCURRENCY`), `minReplicaCount`/`maxReplicaCount` from values, cooldown to avoid
  flapping. Result: workers scale out on queue backlog, in when drained.
- **Stock HPAs:** frontend, backend-api, provider-ytdl, provider-youtubejs on CPU (+mem) — no
  Prometheus needed. (Optional later: KEDA `prometheus` scaler for providers on p95 stream latency /
  429 rate once a Prometheus stack exists.)
- **Probes:** wired per Part 2; `initialDelaySeconds` covers provider warmup + youtubejs Innertube
  bootstrap.
- **PodDisruptionBudgets:** `minAvailable` for api/worker/providers so node drains + rollouts never
  remove a whole tier at once.
- **Migrations:** `MIGRATE_ON_START=false` in values; `migrate.job.yaml` as a Helm **pre-install/
  pre-upgrade hook** runs `prisma migrate deploy` once (image already supports the flag; workers
  already skip migrations) — no replica races.
- **GC CronJob:** `prune-sessions.cronjob.yaml` runs `node dist/main.prune.js` (Part 1.5) daily.

---

## PART 5 — WebSocket-only + Ingress + TLS
With Part 1.3 (websocket-only), a client opens one long-lived WS to one `backend-api` pod; the Valkey
adapter fans rooms across pods, so the ingress needs **no session affinity**. `ingress.yaml` routes
the host to the **frontend** Service (the browser only ever talks to the BFF, which proxies `/api`
and `/socket.io` to `backend-api` internally). TLS via cert-manager (values: issuer + host). The
Google OAuth redirect host (`GOOGLE_REDIRECT_URI`) must match the public ingress host.

---

## PART 6 — Config/Secrets, CI, Ansible/Kubespray
- **Config/Secrets:** the per-service `secrets/<svc>/.env` files map to ConfigMaps (non-secret knobs)
  + a Secret (connection strings, OAuth creds). Values reference an **existing Secret** (recommended:
  created out-of-band by Ansible from your secret store) rather than committing secrets.
- **CI:** builds + pushes **5** images to GHCR (`backend`, `worker`, `frontend`, `provider-ytdl`, `provider-youtubejs`). Optionally add a `helm lint` +
  `helm template` job. provider-pot is pulled from Docker Hub (pin `1.3.1`).
- **Deploy:** Terraform makes Proxmox VMs → Kubespray builds the cluster → an Ansible role installs
  KEDA + cert-manager + ingress-controller, creates the Secret, and runs `helm upgrade --install ypd
  infra/helm/ypd -f values-proxmox.yaml`. OVH later = same chart, `-f values-ovh.yaml` (managed deps).

---

## Sequencing
1. **Part 1 app seams** (1.1–1.6) — implement + verify in compose; keep all green (typecheck/lint/
   tests; smoke-test a download + WS + a stale-cookie path). Land before any YAML.
2. **Helm chart skeleton** (Chart, values, _helpers, configmaps/secret, Deployments/Services for the
   5 app components + provider-pot) — `helm template`/`helm lint` clean.
3. **Probes, HPAs, PDB, migrate Job, GC CronJob, KEDA ScaledObject.**
4. **In-cluster stateful StatefulSets** (valkey/postgres/seaweedfs) + the resolver toggle.
5. **Ingress + TLS**; `values-proxmox.yaml` finalized.
6. **Validate on a real cluster** (kind locally, then the Proxmox cluster); then author `values-ovh.yaml`.

## Verification
- **Part 1 (compose, today):** rebuild; confirm a download still completes (api→worker→S3→`done`),
  WS progress flows (websocket-only), `GET /scaling/backlog` returns sane counts while a batch is
  queued, `node dist/main.prune.js` deletes only old account-less sessions, and the bucket lifecycle
  call is attempted on boot. All providers/backends healthy.
- **Chart:** `helm lint` + `helm template -f values-proxmox.yaml` render with no missing refs;
  `kubeconform`/`kubectl --dry-run=server` passes.
- **Cluster (kind, then Proxmox):** `helm install`; pods reach Ready; migrate Job completes before
  api serves; a browser download works end-to-end through the ingress; **scale test** — enqueue a
  large playlist and watch KEDA scale `backend-worker` up on backlog then back down; **drain test** —
  `kubectl rollout restart deploy/<release>-backend-worker` mid-batch → jobs finish/retry, no loss;
  **provider drain** — make one provider `/ready` 503 → it leaves rotation, downloads continue via
  fallback; **pluggability** — flip `postgres.inCluster=false` + point `DATABASE_URL` at an external
  PG → redeploy works with no image change.

## Critical files
- **App seams (modify):** [configuration.ts](packages/backend-core/src/config/configuration.ts),
  [app-config.service.ts](packages/backend-core/src/config/app-config.service.ts),
  [cache.service.ts](packages/backend-core/src/cache/cache.service.ts),
  [work-store.service.ts](packages/backend-core/src/workstore/work-store.service.ts),
  [jobs.module.ts](packages/backend-core/src/jobs/jobs.module.ts),
  [realtime.gateway.ts](apps/backend/src/realtime/realtime.gateway.ts) (QueueEvents → queueUrl),
  [queue-depth.collector.ts](apps/worker/src/observability/queue-depth.collector.ts),
  [storage.service.ts](packages/backend-core/src/storage/storage.service.ts),
  [auth.service.ts](apps/backend/src/auth/auth.service.ts),
  [socket.ts](apps/frontend/app/lib/socket.ts),
  [secrets/backend/.env.example](secrets/backend/.env.example).
  *(Post-ADR-0018: shared infra lives in `packages/backend-core`; the download/convert pipeline in `apps/worker`.)*
- **App seams (new):** `apps/backend/src/main.prune.ts`; a backlog controller (e.g.
  `apps/backend/src/observability/scaling.controller.ts`) on the api.
- **Infra (new):** everything under `infra/helm/ypd/`.
- **Reuse:** `parseRedisUrl` ([redis-connection.ts](packages/backend-core/src/jobs/redis-connection.ts)),
  the existing `bullmq_queue_depth` + new `bullmq_worker_active`/`bullmq_worker_concurrency`/`bullmq_workers_connected`
  gauges, the per-service `secrets/*/.env(.example)` as the config map.

## Decisions locked (no further input needed): Helm · KEDA (metrics-api on /scaling/backlog) ·
websocket-only · CronJob GC · single worker role first · Proxmox in-cluster first, OVH/managed via values.
