# YPD — YouTube Playlist Downloader

Download whole YouTube playlists (public, unlisted, or — via OAuth2.0 read-only — the
public/unlisted videos inside your private playlists), as original (`webm`/`weba`) or
ffmpeg-converted (`mp4`/`m4a`) audio, video, or merged files, delivered as a streamed zip.

It is a three-layer system, each layer ignorant of the layer above:

```
 Browser (Vue)  ──REST + WebSocket──►  Backend (NestJS)  ──HTTP──►  Providers
                                         │  Valkey (cache + queue + state) │
                                         │  S3 (artifacts + metadata JSON) │
                                         │  ffmpeg (conversion)            ├─ provider-ytdl      (Python / yt-dlp)
                                         └─ Postgres (OAuth tokens)        └─ provider-youtubejs (Node / youtubei.js)
```

1. **Providers** — two interchangeable, stateless HTTP servers with an *identical* API
   ([`docs/provider-api.md`](docs/provider-api.md)). They only fetch metadata and stream one
   encoded media track. The backend tries them in order (`PROVIDER_ORDER`) and falls back.
2. **Backend** — NestJS (Node 24). Metadata caching (Valkey), S3 upload, a BullMQ download
   pipeline (provider stream → tee → S3 + ffmpeg), a streamed zip archive, WebSocket progress,
   and OpenAPI docs.
3. **Frontend** — Vue 3 (intentionally **unstyled**): paste a playlist, pick the output, watch
   live progress, download the archive.

See [`docs/architecture.md`](docs/architecture.md) for the full design and data flow.

## Prerequisites

- Docker + Docker Compose (the only requirement for the full stack).
- For local development outside Docker: Node 24 + `pnpm` 10, `uv` (Python 3.13), and `ffmpeg`.

## Quick start

```bash
# Bootstrap per-service envs from their .env.example siblings.
for s in backend cache database frontend providers storage; do
  cp "secrets/$s/.env.example" "secrets/$s/.env"
done

# Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in secrets/backend/.env if you want
# the OAuth flow (sign-in + private-playlist picker). Public playlists work without it.

docker compose up -d --build  # builds 4 images, starts 7 services
```

Then open:

- **Frontend:** http://localhost:8080
- **API + Swagger:** http://localhost:3000/docs
- **Liveness / Readiness:** http://localhost:3000/health · http://localhost:3000/ready
- **Prometheus metrics:** http://localhost:3000/metrics

Paste a playlist URL (or id), choose audio/video/merged × original/converted, click Download,
watch per-video progress, then download the zip. Or sign in with Google and pick from your
own playlists (including private ones).

## Services & ports

| Service | What | Host port |
|---|---|---|
| `frontend` | Nuxt 4 SPA (Nitro server, runtime-configured) | `8080` |
| `backend` | NestJS API + WebSocket | `3000` |
| `provider-ytdl` | yt-dlp HTTP server | internal `5000` |
| `provider-youtubejs` | youtubei.js HTTP server | internal `5001` |
| `storage` | SeaweedFS S3 gateway (dev only) | `127.0.0.1:8333` |
| `cache` | Valkey (cache + queue + OAuth state) | `127.0.0.1:6379` |
| `database` | PostgreSQL 17 (OAuth tokens) | `127.0.0.1:5432` |

All services share the `network-backend` Docker network. Only the frontend, backend, and the
infra ports (bound to `127.0.0.1`) are reachable from the host; the providers are internal.

## Output formats

| Selection | Original | Converted (ffmpeg) |
|---|---|---|
| Audio | `.weba` (opus/webm) | `.m4a` (aac) **with thumbnail cover art** for Apple Music |
| Video | `.webm` (vp9, no audio) | `.mp4` (h264) |
| Merged | `.webm` (vp9 + opus, muxed) | `.mp4` (h264 + aac) |

Originals are always kept in S3; converted artifacts are produced from the local copy without
re-downloading. All S3 keys are the video id (`{id}.weba`, `{id}.json`, …); the zip entry names
use the video title.

## API

- `GET /videos/:id` — video metadata (Valkey-cached 24h; also persisted to S3 as `{id}.json`).
- `GET /playlists/:id` — public/unlisted playlist's video ids.
- `POST /downloads` — body `{ playlistId | videoIds, selection, format }` →
  `{ batchId, videoIds, unavailable }`. A signed-in user's batch is session-scoped (archive
  refuses cross-session access); anonymous batches stay reachable with the (UUID) batchId.
- `POST /downloads/status` — body `{ videoIds, selection, format }` → current per-work-item
  state; lets the UI repaint after a refresh.
- WebSocket: connect, `subscribe({ videoIds, selection, format })`, receive `video:progress`.
  Cookie-authenticated — unauthenticated handshakes are rejected at the gateway.
- `GET /downloads/:batchId/archive` — streamed zip of the batch's deliverables.
- `GET /auth/*` — Google OAuth flow + private playlist picker (`/auth/google`, `/auth/me`,
  `/auth/playlists`, `/auth/playlists/:id`, `POST /auth/sign-out`). See [`docs/oauth.md`](docs/oauth.md).
- `GET /health` (liveness) and `GET /ready` (probes Prisma + Valkey + S3 + providers).
- `GET /metrics` — Prometheus exposition (provider request duration, queue depth,
  S3 op duration, contract violations, fallbacks).

Full schema at `/docs` (Swagger).

## Configuration

All configuration is via environment variables — see [`.env.example`](.env.example) for the full
list with comments. The backend uses single connection strings (`CACHE_URL`, `DATABASE_URL`) and
the `S3_` convention (so swapping the dev SeaweedFS for any real S3 provider needs no code change).

The frontend reads `BACKEND_URL` at **container start** (not build time): a Nitro startup plugin
copies it into `runtimeConfig.public.backendUrl`, which Nuxt injects into the SPA bootstrap.
Change `BACKEND_URL` in `secrets/frontend/.env`, `docker compose restart frontend`, refresh —
no rebuild required. The same URL is used for REST and WebSocket (Socket.IO connects to the
same origin).

## Development

```bash
pnpm install                       # backend, frontend, shared (workspace)
pnpm --filter @ypd/shared build    # build shared types first

# providers
cd apps/providers/ytdl && uv run uvicorn app.main:app --port 5000
cd apps/providers/youtubejs && pnpm install --ignore-workspace && pnpm dev   # :5001

# backend / frontend
pnpm --filter @ypd/backend start:dev
pnpm --filter @ypd/frontend dev
```

Quality gates: `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r format:check` (TypeScript), and
`uv run ruff check . && uv run mypy app` in `apps/providers/ytdl` (Python).

## Project layout

```
apps/providers/ytdl        Python / yt-dlp / FastAPI / uv
apps/providers/youtubejs   Node / youtubei.js / Hono / pnpm (standalone)
apps/backend               NestJS (Node) / pnpm (workspace)
apps/frontend              Nuxt 4 (Vue 3 + Nitro) / Naive UI / pnpm (workspace)
packages/shared            TS DTOs + WS message types (backend ↔ frontend only)
docs/                      architecture, provider API, streaming/conversion, OAuth, ADRs
secrets/<service>/         per-service .env (+ .env.example); real .env is gitignored
```

## Known limitations

- **OAuth tokens are encrypted at rest only by the underlying disk volume** (ADR 0008 — see
  [`docs/decisions/`](docs/decisions/)). `pg_dump` from a backup container will expose them; only
  trust hosts you control. App-level AEAD is an intentional non-goal — the threat model is
  "machine I control" + "anyone with shell on it has equal access to the keys anyway."
- **PO tokens / bot checks:** YouTube may require a PO token for streaming. youtube.js streams
  via the `ANDROID_VR` client (works without one today); both providers have env hooks to add a
  PO-token provider if 403s appear. See [`docs/streaming-and-conversion.md`](docs/streaming-and-conversion.md).
- **MP4 conversion is CPU-heavy** (VP9/AV1 → H.264); it runs in concurrency-limited workers.
- **`storage` is for local dev only** (SeaweedFS); production should point `S3_*` at a real provider.
- **Prisma migrate runs at backend startup** by default. In prod, set `MIGRATE_ON_START=false`
  in `secrets/backend/.env` and run `prisma migrate deploy` from a controlled CI / init-container
  step so rolling restarts don't race against their own migrations.
