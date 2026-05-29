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
