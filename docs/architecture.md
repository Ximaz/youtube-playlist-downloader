# Architecture

YPD is a three-layer system. Each layer only knows about the layer directly below it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Frontend (Nuxt 4 SPA, Vue 3 + Naive UI, runtime-configured Nitro server) │
│  paste playlist · pick output · live progress · download zip             │
└───────────────▲───────────────────────────────┬──────────────────────────┘
       REST (/playlists, /downloads, /archive)  │ WebSocket (video:progress)
┌───────────────┴───────────────────────────────▼────────────────────────────┐
│ Backend (NestJS, Node 24)                                                  │
│  ┌─────────────┐  ┌───────────────┐  ┌───────────────────────────────────┐ │
│  │ Metadata    │  │ ProviderClient│  │ Download pipeline (BullMQ)        │ │
│  │ cache-aside │  │ ordered       │  │ download pool: provider → S3      │ │
│  │ (Valkey)    │  │ fallback      │  │ convert pool: S3 → ffmpeg → S3    │ │
│  └─────┬───────┘  └──────┬────────┘  └────────────────┬──────────────────┘ │
│        │ Valkey          │ HTTP                       │ S3 + ffmpeg        │
└────────┼─────────────────┼────────────────────────────┼────────────────────┘
         │                 │                            │
   ┌─────▼─────┐   ┌───────▼────────┐  ┌────────────────▼─────────┐  ┌─────────────┐
   │  Valkey   │   │   Providers    │  │   S3 (SeaweedFS in dev)  │  │  Postgres   │
   │ cache +   │   │ ytdl, youtubejs│  │  {id}.weba/.webm/.m4a/   │  │ OAuth tokens│
   │ queue +   │   │ (identical API)│  │  .mp4/.json              │  │ (Prisma 7)  │
   │ state     │   └────────────────┘  └──────────────────────────┘  └─────────────┘
   └───────────┘
```

## Why three layers

- **Providers are dumb and interchangeable.** YouTube extraction is the most fragile part of the
  system (it breaks whenever YouTube changes). Isolating it behind a tiny fixed contract means we
  can run two independent implementations (yt-dlp and youtube.js), fall back between them, and add
  more without touching the backend. They hold no state, no caching, no business logic.
- **The backend owns all the logic.** Caching, storage, conversion, batching, progress, and auth
  live in one place. It is the only component that knows about S3, Valkey, ffmpeg, and the queue.
- **The frontend only talks to the backend.** It never sees a provider, S3, or the queue.

## Request flows

**Metadata** (`GET /videos/:id`): Valkey cache hit → return. Miss → `ProviderClient` (ytdl first,
youtube.js fallback) → cache for 24h → also persist `{id}.json` to S3 (the durable title source
the archive route reads later).

**Download** (`POST /downloads`): resolve the playlist/videoIds → **probe** every video's metadata
(bounded, cache-aside) so ones no provider can resolve are marked `unavailable` and excluded from
the batch up front (stable X/Y), while the probe's durations let us queue **shortest-first**. The
remaining videos already in S3 are recorded done immediately; the rest are enqueued on the
`download` queue (priority = duration). Returns `{ batchId, videoIds, unavailable }`. The browser
opens a WebSocket and `subscribe`s by `{ videoIds, selection, format }`; each work item is its own
room (`work:<videoId>:<selection>:<format>`).

**Two-stage worker** (see [streaming-and-conversion.md](streaming-and-conversion.md)): the
`download` pool streams the required original(s) straight to S3. For a plain original that is the
deliverable; for `converted`/`merged` it enqueues a `convert` job and frees its slot. The
independent `convert` pool pulls the originals back from S3, runs ffmpeg, and uploads the result —
so the two pools run concurrently (up to `DOWNLOAD_CONCURRENCY` + `CONVERT_CONCURRENCY` tasks).
Progress is reported with `job.updateProgress`, surfaced to the browser via `QueueEvents` → the
socket.io gateway.

**Archive** (`GET /downloads/:batchId/archive`): read the batch's per-video results from Valkey,
stream each deliverable out of S3 into an `archiver` zip piped straight to the HTTP response. Never
buffered, never cached. **Refuses with 409** if any video in the batch is still pending or failed
— a partial zip is worse than no zip (see [ADR 0012](decisions/README.md#0012--archive-strict-completeness-409-on-partial-batch)).
When the client disconnects mid-stream, `archive.abort()` fires and per-entry S3 streams are
destroyed in a `finally` so connections don't leak. If the batch was created by a signed-in
user, the `ypd_session` cookie must match the one recorded on the `BatchGroup` (anonymous
batches still rely on the 122-bit `batchId` UUID as their capability).

## Backend internals (NestJS modules)

| Module | Responsibility |
|---|---|
| `ConfigModule` | typed env access (`AppConfigService`); nothing else reads `process.env` |
| `CacheModule` | one Valkey connection (iovalkey): JSON get/set with TTL |
| `StorageModule` | S3 (aws-sdk v3): streaming `Upload`, get/head, JSON put/get; bucket auto-create |
| `ProvidersModule` | `ProviderRegistry` (from `PROVIDER_ORDER`) + `ProviderClientService` (ordered fallback) |
| `MetadataModule` | `/videos/:id`, `/playlists/:id` — cache-aside + S3 JSON |
| `JobsModule` | BullMQ root connection + two queues (`download`, `convert`), Valkey-backed |
| `DownloadModule` | `POST /downloads`, the download + convert workers, `PipelineService`, `FfmpegService`, `WorkStore`, and the archive route. Concurrency of both pools is set in `OnModuleInit` from `AppConfigService` (no `process.env` reads in the worker code) |
| `RealtimeModule` | socket.io gateway bridging BullMQ `QueueEvents` → per-work-item rooms; cookie-auth on handshake via a custom `SecureIoAdapter` (see [oauth.md](oauth.md)); replays both stored `WorkResult` AND mid-flight `job.progress` on `subscribe` so a refresh resumes live updates instead of restarting from "queued" |
| `ObservabilityModule` | Prometheus exposition (`/metrics`), BullMQ queue-depth collector polling `getJobCounts` every 5 s, `MetricsService` injected by `ProviderClientService` + `StorageService` to record per-provider latency / fallbacks / contract violations / S3 op timings. Backend also mints a `x-ypd-request-id` header per request and forwards it on (`provider-ytdl`/`provider-youtubejs` echo it back) so logs across the three services join on the same id |
| `HealthModule` | `/health` (cheap liveness, used by `HEALTHCHECK`) and `/ready` (probes Prisma `SELECT 1`, Valkey `GET`, S3 `HeadObject`, provider `HEAD /health`; returns `503 Service Unavailable` with a per-check report when any leg fails) |
| `AuthModule` | Google OAuth flow with cookie-bound state + PKCE; `YouTubeDataService` for the picker (Zod-validated at the YouTube Data API seam); SCAN-based playlist cache invalidation on sign-out; per-session refresh mutex via `CacheService.withLock` |

A global `AllExceptionsFilter` (registered in `main.ts`) wraps every uncaught error into a
uniform `{ "error": { "code", "message" } }` envelope — the same shape both providers already
emit, so the frontend's `api.ts` decodes ALL errors through one path. 500-class errors log
the full stack server-side and respond with an opaque message; HttpException subclasses
preserve their declared status. `app.enableShutdownHooks()` is on, so `OnModuleDestroy`
actually fires on SIGTERM (closes BullMQ workers, Prisma, Valkey, and the ffmpeg children
tracked by `FfmpegService`) — without it, in-flight jobs got SIGKILL'd on every deploy.

## Jobs & workers (BullMQ on Valkey)

Heavy work never runs in a request handler. Two independent `WorkerHost` pools process the batch:
a `download` pool (concurrency `DOWNLOAD_CONCURRENCY`, I/O-bound) and a `convert` pool (concurrency
`CONVERT_CONCURRENCY`, ffmpeg/CPU-bound). A download hands off to a convert job on success, so a
converted/merged batch keeps both pools busy at once instead of serialising download-then-convert
per video.

The unit of work is a (videoId, selection, format) triple, not a batch — `WorkStore` keeps each
work item's result in Valkey keyed by `result:<videoId>:<selection>:<format>` (6 h TTL). Deterministic
BullMQ job ids (`dl_…` / `cv_…`) make in-flight dedup free: re-clicking Download or another playlist
referencing the same video is a no-op while the job is in flight, and the S3 pre-filter short-circuits
once it's done. `batchId` survives only as a thin handle bundling work items for the archive URL,
optionally scoped to the creator's session for cross-session refusal.

The same Valkey instance backs the response cache (iovalkey), the job queues (BullMQ's own ioredis
connection), `WorkStore`, OAuth state (10-min TTL — see [oauth.md](oauth.md) and ADR 0008 in
[`docs/decisions/`](decisions/README.md)), OAuth playlist caches (per-session, SCAN-cleared on
sign-out), and the OAuth refresh mutex. Per-video failures are caught and recorded — a broken video
is *excluded* from the batch, never fatal to it. Provider-transient failures (timeout / 5xx / network)
are distinguished from upstream 404s via `ProvidersUnavailableError`, so the download stage retries
those instead of marking videos permanently unavailable. ffmpeg runs as a separate OS process with
`-threads` capped per concurrent convert job, so CPU work never blocks the event loop and concurrent
convertions don't oversubscribe cores.
