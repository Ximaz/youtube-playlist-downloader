# Architecture Decision Records

Short records of the non-obvious choices behind YPD. Each entry: the decision, why, and the
trade-off accepted.

## 0001 — Backend on Node 24, not Bun
The spec mentioned both. NestJS is decorator/metadata-heavy and runs long-lived download +
ffmpeg work; Node 24 LTS is the most battle-tested for that (decorator emit via `tsc`, stable
long-running GC). Bun is faster but still carries caveats for this exact shape. **Trade-off:** less
raw throughput for much lower risk.

## 0002 — `provider-ytdl` wraps yt-dlp, not youtube-dl
youtube-dl is effectively unmaintained and breaks against current YouTube. yt-dlp is the active
fork with the Python API we need. The service keeps the name `provider-ytdl`. **Trade-off:** none
of consequence.

## 0003 — Provider → backend transport is HTTP streaming, not WebSocket
The spec floated WebSocket for the media bytes. Server-to-server binary over WebSocket has no
native backpressure/range and more moving parts. HTTP chunked responses pipe directly into the S3
multipart `Upload` and the ffmpeg tee, and support `Range`/resume. WebSocket is reserved for
frontend ↔ backend progress only. **Trade-off:** none — HTTP streaming is strictly simpler here.

## 0004 — Dev S3 is SeaweedFS (the `storage` service)
The official MinIO community image was discontinued (Oct 2025, with a CVE) and Bitnami's free
catalog is gone; both are unpullable. SeaweedFS is maintained, pinnable (`chrislusf/seaweedfs:4.29`),
and gives a real S3 gateway (proper multipart/streaming, which the pipeline leans on). The Compose
service is named `storage` (not `s3`) to mirror the backend's storage abstraction and stay
provider-agnostic. The backend's S3 client is configured purely via `S3_*` env
(`S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`), so production can point at any real S3
with no code change. **Trade-off:** no MinIO console; the dev identity is provisioned from the
`storage` service's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env (SeaweedFS makes a global-admin
identity) rather than a config file — those must match the backend's `S3_ACCESS_KEY`/`S3_SECRET_KEY`.

## 0005 — Jobs on BullMQ (Valkey), no `worker_threads`
Heavy work runs in a BullMQ `FlowProducer` (batch → per-video) + `WorkerHost`, backed by the same
Valkey as the cache. ffmpeg already runs as a separate OS process and downloads are I/O-bound, so
the event loop never blocks — BullMQ gives process-level scheduling, retries, concurrency limits,
and a clean `QueueEvents` → WebSocket progress channel without hand-rolled threads. **Trade-off:**
a queue dependency (already present as the cache).

## 0006 — `archiver` pinned to v7, not v8
archiver v8 is ESM-only with a new class API (`new ZipArchive()`) and no matching `@types`; it does
not fit the CommonJS NestJS backend cleanly. v7 is maintained, CommonJS, and has the stable
`archiver('zip')` API the streaming-zip route uses. Still exactly pinned. **Trade-off:** one major
version behind, revisitable when the ecosystem settles.

## 0007 — Strict exact version pinning + frozen Docker installs
Every dependency (pnpm and uv) is pinned exactly (no `^`/`~`); Dockerfiles install from committed
lockfiles with `--frozen-lockfile` / `uv sync --frozen`. Reproducibility and supply-chain control
over convenience. **Trade-off:** manual version bumps.

## 0008 — OAuth tokens at rest: disk encryption, not app-level
Google OAuth `access_token` / `refresh_token` are stored as plaintext `String` columns. Protection
at rest is the database volume's responsibility — LUKS / cloud-provider encrypted volume in prod
(equivalent to AWS RDS at-rest encryption). App-level AEAD was considered and rejected:
encryption layers cover different threats — disk/TDE protects physical theft and offline raw-FS
leaks; app-level AEAD also protects `pg_dump` exports and compromised DB credentials, but adds
a key-management surface (TOKEN_ENCRYPTION_KEY, rotation, dual-key reads) we explicitly do not
want yet. **Trade-off accepted:** a `pg_dump` leak or a compromised DB role yields raw tokens;
mitigated by least-privilege DB roles and (in prod) TLS to Postgres + encrypted volume. Easy to
add app-level AEAD later as a column-level wrapper without a schema change.

## 0009 — Trust only exact upstream sizes for `Content-Length` + parallel ranges
`provider-ytdl` used to fall back to yt-dlp's `filesize_approx` (bitrate × duration) when the
exact `filesize` was missing, advertise it as `Content-Length`, and slice it into parallel
`Range` requests. Over-estimate → 502 on the past-EOF range; under-estimate → silent truncation
with a wrong `Content-Length` advertised to the backend, which corrupted the S3 multipart PUT.
Both providers now only advertise `Content-Length`/`Accept-Ranges` when the size is exact;
parallel range fetching is gated on the same condition, otherwise we fall back to a single
chunked-transfer proxy. **Trade-off:** the single-stream fallback is slower for the (rare)
formats where YouTube only reports an approximate size.

## 0010 — Distinguish "providers down" from "video upstream-404"
The download processor used to catch the provider client's `NotFoundException` for any
failure mode (timeout, 5xx, network blip, contract violation, genuine 404) and stamp the
work item `status: 'skipped'` (terminal, non-retryable, 6 h TTL). Transient provider
outages permanently flagged batches of videos as "unavailable". `ProviderClientService` now
tracks per-provider failure reasons across the fallback chain: only `VIDEO_NOT_FOUND` /
`PLAYLIST_NOT_FOUND` / `FORMAT_NOT_FOUND` on **every** provider throws `NotFoundException`;
any transport-level failure throws a new `ProvidersUnavailableError`. The download
processor maps the latter to `'failed'`, which BullMQ retries via `attempts: 3` +
exponential backoff. **Trade-off:** the negative-result cache (60 s) means a video that
became available immediately after a 404 won't be retried for up to a minute — fine for
human-scale interaction.

## 0011 — SCAN, not KEYS, for per-session cache invalidation
`AuthService.signOut` clears every cached playlist entry for the session
(`oauth:playlist:{sessionId}:*`). `KEYS` would be O(N) under the global Valkey lock — fine
for our scale but reflexively bad practice, and the user pattern shows up in audits as a
red flag. `CacheService.scan(matchPattern)` wraps iovalkey's cursor-based `SCAN` and yields
keys lazily; `delMany` then pipelines the `DEL`s. The default user is also disabled in the
Valkey ACL, and `-@dangerous +info +client` denies `KEYS` / `CONFIG` / `FLUSHALL` /
`SHUTDOWN` etc. at the server entirely, so even a buggy or compromised caller can't paper
over the rule. **Trade-off:** SCAN visits keys probabilistically; we accept that a key
created mid-scan may be missed on this pass — the worst-case staleness is `PLAYLIST_CACHE_TTL`
(5 min).

## 0012 — Archive: strict completeness (409 on partial batch)
`GET /downloads/:batchId/archive` used to stream whatever subset of the batch was already
in S3. A user clicking the link mid-batch got a confusingly incomplete zip with no way to
distinguish "this is partial" from "some videos failed and that's all you're getting."
The route now refuses with `409 Conflict` and a structured message
(`"Batch X is not yet complete: N of M video(s) are still pending or failed"`) unless
every videoId in the batch resolves to a downloadable deliverable. The frontend hides the
archive link until `doneCount === total` for the same reason; the 409 is the defence in
depth for hand-constructed URLs. Unavailable videos (filtered out at probe time) are
already excluded from `batch.videoIds`, so they don't block completion. **Trade-off:**
no "save what's done" escape hatch when a video permanently fails; the user must wait
for retries to exhaust or remove the offending id and re-run.

## 0013 — WebSocket auth at the handshake, single Zod for `subscribe`
The Socket.IO gateway used to accept `cors.origin = '*'` (env-default fallback), no
authentication, and hand-rolled `if (!req || !Array.isArray(req.videoIds))` validation
that diverged from the REST resync endpoint's `WorkSelectorSchema`. A custom
`SecureIoAdapter` now pins CORS to `AppConfigService.frontendOrigin` with
`credentials: true` (so the browser sends `ypd_session` on the WS handshake), and a
`server.use(...)` middleware rejects any handshake whose cookie doesn't resolve to a real
`Session` row in Postgres. The `subscribe` payload is parsed with `WorkSelectorSchema`
— the same schema that validates `POST /downloads/status` — so the WS surface has no
second source of truth. **Trade-off:** anonymous WS connections are no longer possible;
the public-playlist download flow still works (REST), just without live updates for
non-signed-in users. Acceptable for the current threat model; if anonymous live
updates become a requirement later, gate the cookie check on a config flag.

## 0014 — Anonymous sessions (opaque, not JWT) so public users get live progress
ADR 0013's "anonymous WS connections are no longer possible" broke the README's promise of
live per-video progress for the **public** (not-signed-in) download flow: with no session the
gateway rejects the handshake (`unauthorized`), so the `progress` map never updates and the
archive link never appears. Rather than relax the WS auth, every visitor now gets a real,
server-issued **anonymous `Session`** (the `Session.account` relation was already optional, so
no schema rewrite — only additive `tier`/`userAgent`/`ip` columns). The Nuxt BFF mints one via
`POST /auth/session` on the first browser navigation (gated on `Accept: text/html` so health
probes/bots can't spam rows; the healthcheck moved to `/healthz`), stores the opaque token in
the httpOnly cookie, and the gateway's existing "session must exist in Postgres" check then
passes — anonymous and signed-in connections take the *same* auth path. Batches created
anonymously become session-scoped too (stronger than the prior UUID-only capability), and the
session carries a `tier` (everyone `paid` for now) that the future free/paid queueing reads
without another migration. **Opaque token, not JWT:** the backend already owns the `Session`
table and queries it on every handshake + for batch scoping, so a JWT's stateless validation
buys nothing here while adding a signing-key to manage/rotate (the key-management surface ADR
0008 deliberately avoids) and awkward revocation. A 122-bit server-issued id is unforgeable by
construction; `userAgent` + `ip` are recorded at creation as authenticity/audit signals bound
to the token. **Trade-off:** one `Session` row per anonymous browser (30-day cookie) — a
periodic prune of account-less sessions older than N days is the GC follow-up. Stale cookies
(e.g. a dev DB reset) self-heal: `/auth/me` omits `tier` when the session is gone, and the
frontend re-mints via `POST /api/session`.

## 0015 — One image, two roles: split the API and the BullMQ workers (`APP_ROLE`) — superseded by 0018
ADR 0005 put the download/convert `WorkerHost` pools in the same process as the HTTP API +
WebSocket gateway, so global download throughput was capped at one process's
`DOWNLOAD_CONCURRENCY` and CPU-heavy ffmpeg contended with request latency. The backend now
reads `APP_ROLE` (`api` | `worker` | `all`, default `all` for single-host/dev) from the same
image: `DownloadModule.register()` registers the two processors ONLY for `worker`/`all`, and the
gateway's QueueEvents→socket bridge runs ONLY for `api`/`all` (`AppConfigService.runsApi` /
`runsWorkers`). compose runs `backend` (api) + `backend-worker` (worker) as separate containers;
`docker compose up -d --scale backend-worker=N` makes throughput `N × DOWNLOAD_CONCURRENCY`,
independent of the API tier. Progress still crosses the process boundary for free: a worker's
`job.updateProgress` writes the BullMQ Valkey stream, which the api's QueueEvents reads and fans
to its sockets (verified end-to-end). Workers skip Prisma migrations (the api/all role owns them,
via the entrypoint) so N workers don't race; `lockDuration` is raised to 90s so a scaled-out pool
doesn't false-stall a long download (BullMQ auto-renews the lock while active). **Trade-off:** an
`api`-only process runs no workers, so a deployment MUST run at least one `worker` (or `all`) or
jobs never drain; the worker still imports the full module graph (an idle Prisma connection) —
a future refinement can trim it. No new dependency.

## 0016 — Socket.IO Valkey adapter for a horizontally-scalable API tier
The gateway used the default in-memory Socket.IO adapter, so rooms/emits were process-local; it
only "worked" across instances by accident because every replica ran its own QueueEvents and
re-emitted every event locally — fragile, O(N) duplicate work, and broken for any non-QueueEvents
emit. With the api/worker split (ADR 0015) the api tier is meant to scale, so `main.ts` now wires
`@socket.io/redis-adapter` (a `RedisIoAdapter` built on two iovalkey clients from the existing
`CACHE_URL` — no new service) via `app.useWebSocketAdapter()`, **for the api role only** (workers
serve no sockets). `server.to(room).emit(...)` is now cluster-correct for ALL emits across N api
replicas (verified: the adapter's `socket.io-request/response` pub/sub channels go live in Valkey
on subscribe). The Valkey ACL gains `+@pubsub` (PUBLISH/SUBSCRIBE) — the adapter needs it.
Separately, the handshake's `Session` lookup is now Valkey-cached (`ws:sess:<id>`, 60s) so a
reconnect storm or a brief Postgres blip doesn't hammer/deny the DB. **Trade-off:** the engine.io
*polling* transport still needs sticky sessions across replicas — kept `['websocket','polling']`
for fallback robustness and deferred sticky-cookie affinity for `/socket.io` to the K8s ingress
(Workstream F); a websocket-only client would remove even that need. One new dependency
(`@socket.io/redis-adapter`), reusing Valkey.

## 0017 — Provider tier: capacity-aware backpressure + a SHARED PO-token sidecar (not in-process)
Scaling the provider tier is by REPLICAS (K8s/compose), not in-provider `--workers` — concurrency
is owned by the backend's per-provider `pLimit` + the K8s HPA, so each provider stays a single
process. Two backpressure tiers were added to both providers: **(1) honest upstream throttle** —
a googlevideo `429`/bot-check now surfaces as a provider `429 RATE_LIMITED` + `Retry-After`
(was a flat `502`), which the backend already backs off on and falls back; **(2) local saturation
of the one expensive op** — youtubejs measures event-loop delay (`monitorEventLoopDelay`), ytdl
tracks in-flight `_extract` vs the AnyIO threadpool — exposed on a new `/ready` (503 when degraded,
so K8s drains the pod) and used to `429` NEW extraction while in-flight byte streaming keeps
flowing. Not a fixed request cap — tied to actual capacity.

**PO-tokens come from a shared `bgutil-ytdlp-pot-provider` sidecar, NOT in-process.** We first
built the in-process path (youtubejs + bgutils-js + jsdom) and empirically found YouTube's
BotGuard refuses to attest outside a real browser (`VM_ERROR APF:Failed`); the cold-start token
needs a different identifier and is only partial. So generation runs in the maintained sidecar
(`provider-pot`), and both providers use it ONLY on demand (per-video, automatic): ytdl via its
`bgutil-ytdlp-pot-provider` yt-dlp plugin (`fetch_pot=if_required`, dormant until a token is
needed — no change to the working no-token path), youtubejs via `POST /get_pot` then a WEB-client
Innertube bound to the token (a bot-check escalation: detect → mint → retry → give-up + cooldown).
The stack does NOT hard-depend on the sidecar — if it's down, escalation no-ops and the backend
falls back between providers. **Trade-offs:** one extra container; the sidecar can still break on
a BotGuard change (but it's maintained). **Verified:** the sidecar mints real tokens (852-char PO
token via the youtubejs path) — the thing jsdom could not.

**youtubejs `#parallelDownload` rewrite (fixed here).** Surfaced while verifying the provider
tier: the youtubejs parallel path (files >2 MiB, the fallback streamer) stalled after ~1 segment.
Two bugs: (1) it fired concurrent `info.download({range})` calls on ONE `info`, which youtubei.js
can't do; (2) its `ReadableStream.pull()` returned WITHOUT enqueuing when a segment ended,
assuming pull would be re-invoked — it isn't, so the stream hung after the first segment. Rewrote
it to mirror ytdl: decipher the googlevideo URL ONCE (`format.decipher(player)`), then fetch byte
ranges with independent `fetch` + `Range` (real per-segment retry + `AbortController`
cancellation), and pull() now loops to advance across an exhausted segment until it enqueues.
Verified: full 3.43 MB delivered (was 1 MiB-then-stall); single + ranged paths unchanged. ytdl
(primary streamer) was never affected; this makes the youtubejs fallback stream large files too.

## 0018 — Physical API/worker split: two images (`ypd-backend`, `ypd-worker`) sharing `@ypd/backend-core`
ADR 0015 ran the API and the BullMQ pools from ONE image gated by `APP_ROLE` (`api|worker|all`), so
both tiers shipped the full dependency surface (ffmpeg, Prisma engines, Swagger, Socket.IO) regardless
of role. The split is now **physical**: `apps/backend` builds `ypd-backend` (HTTP REST + WebSocket
gateway + Prisma migrations + ENQUEUE) and a new `apps/worker` builds `ypd-worker` (the download/convert
BullMQ pools + ffmpeg + S3, with a minimal HTTP surface for `/health` + `/ready` + `/metrics` only). The
image now IS the role — **`APP_ROLE`/`all` and `runsApi`/`runsWorkers` are deleted**; local dev runs both
containers (compose already did). Shared NestJS infra (config, cache, storage, jobs/BullMQ connection,
providers, metadata service, `WorkStore`, deliverable helpers, metrics) moved to a new
`packages/backend-core` library imported by both apps; `packages/shared` stays pure Zod types (the
frontend depends on it, so it must not pull in NestJS/aws-sdk). This is a genuine slim-down: the API
image drops ffmpeg (archive zips stream from S3 via `archiver`, no transcode); the worker image drops the
entire Prisma/pg stack (no worker code path touches Postgres — its `/ready` checks valkey + s3 +
providers only), Swagger, Socket.IO, archiver and google-auth. Cross-process correctness is unchanged:
the enqueue→process bridge runs over the SHARED Valkey queue (`CACHE_URL`), `WorkStore` results are
Valkey-backed (written by the worker, read by the API), and worker `job.updateProgress` still feeds the
API's QueueEvents→Socket.IO fan-out. `backend-core` declares the framework packages (NestJS, bullmq,
reflect-metadata, rxjs, zod) as **peerDependencies** so — with this repo's exact version pinning — pnpm
dedupes a single NestJS instance across both apps (no duplicate-DI-token hazard). Migrations stay
API-owned (the worker entrypoint runs none). CI builds both images; the lint/typecheck + test jobs build
`@ypd/backend-core` right after `@ypd/shared`. **Trade-off:** one more shared package + a second
image/Dockerfile to maintain, and `provider-client` needs an explicit `Readable.fromWeb(... as ...)` cast
because backend-core's `@aws-sdk`-importing typecheck pulls the DOM `ReadableStream` into scope.
**Supersedes ADR 0015.**

## 0019 — Kubernetes on Talos: Terraform + Cilium + Helmfile, vault-free secrets
The cloud-agnostic deployment (Workstream F) is a 4-node **Talos Linux** cluster on Proxmox,
provisioned by **Terraform** (`siderolabs/talos` + `bpg/proxmox`) — immutable, API-only, no SSH. CNI,
kube-proxy replacement, and the bare-metal LoadBalancer are all **Cilium** (LB-IPAM + L2 announcement,
so a `Service type=LoadBalancer` gets a LAN IP with no MetalLB). Day-2 delivery is **imperative**
(Helmfile + Taskfile), not GitOps: add-ons (`cert-manager`, `ingress-nginx`, KEDA, local-path) via a
helmfile; the app via one **cloud-agnostic Helm chart** (`infra/helm/ypd`) where every stateful dep
(Valkey/Postgres/S3) is pluggable in-cluster ↔ managed with values only. Worker autoscaling is **KEDA**
on the API's `GET /scaling/backlog` (metrics-api scaler — no Prometheus); stock CPU HPAs elsewhere.

**Secrets are vault-free, mirroring ADR-0008's "encrypt the substrate, don't add a key-management
surface."** Two layers: (1) at rest — Talos **LUKS2** encrypts etcd's partitions (ADR-0008's LUKS),
so a Secret is ciphertext on disk; (2) provisioning — real credentials live ONLY in an **age-encrypted
SOPS file** (`infra/secrets/secrets.sops.yaml`, only `stringData` encrypted) applied out-of-band; the
chart **references Secrets by name (`existingSecret`) and never templates a credential value**, so
`helm get manifest`/git never expose one. Per-image Secret split (the worker Secret omits
`DATABASE_URL` + `GOOGLE_*`); every workload runs under a dedicated ServiceAccount with
`automountServiceAccountToken: false` and no Secret RBAC. `GET /scaling/backlog` stays **unauthenticated**
(it's `@ApiExcludeController`, leaks 3 integers, is ClusterIP-internal) — fenced by a NetworkPolicy
rather than a KEDA `TriggerAuthentication` token, which would re-introduce the key surface ADR-0008
avoids. **Trade-offs:** (a) the cross-equality invariant (in-cluster dep creds must equal the creds
embedded in `CACHE_URL`/`DATABASE_URL`/`S3_*`) is unenforced by code — the SOPS example documents it and
a future Taskfile `validate` should assert it; (b) the SOPS age private key is operator-held and rotation
is a re-encrypt + redeploy; (c) Talos machine secrets currently live in `terraform.tfstate` (gitignored)
— move to an encrypted remote backend before sharing/HA; (d) single-replica StatefulSets on a node-local
disk give persistence without HA (Longhorn is the documented HA upgrade). **Tooling note:** the toolchain
pins **Helm 3** — Helm 4's reworked plugin format + `--wait` hang helmfile and the webhook charts and
break `helm secrets`.
