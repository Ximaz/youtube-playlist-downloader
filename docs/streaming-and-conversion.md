# Streaming, conversion & the S3 "cache"

This is the heart of the backend: how one video becomes one (or more) artifacts in S3 and,
eventually, an entry in the download zip — without ever buffering a whole file in memory.

## The two-stage pipeline

The work is split across two independent BullMQ pools (see [architecture.md](architecture.md)) so
downloads and conversions run concurrently. Before any job runs, `POST /downloads` **probes** every
video's metadata: unresolvable ones are excluded as `unavailable`, and the probe's durations let the
queue schedule **shortest-first**. Videos already in S3 for the requested format are recorded done
up front (the `HeadObject` pre-filter) and never enter a queue.

**Download stage** — `PipelineService.download`, one invocation per `download-video` job:

1. **Stream the original(s)** — `ProviderClientService.openStream(id, kind)` opens an HTTP stream
   from the first healthy provider; its `X-Format-*` headers give the real container/codec/ext.
   The returned stream is wrapped in an **inactivity watchdog** (30 s default) so a slowloris
   upstream destroys itself instead of pinning the worker. `merged` fetches video + audio
   concurrently behind a **shared `AbortController`**: if either sibling fails (provider 5xx,
   byte-cap tripped, S3 hiccup), the other is aborted immediately so an orphaned half-upload
   can't land in S3.
2. **Upload to S3** — each original streams straight into the multipart `Upload`
   (`{id}.src.{audio|video}.{ext}`) through a `ByteCap` transform that errors past
   `contentLength × 1.05` (or an absolute 8 GiB cap when size is unknown) — a misbehaving
   provider can't fill the bucket. On upload failure the source stream is destroyed in a
   `finally` so undici sockets return to the keep-alive pool. For a plain `original` request
   that *is* the deliverable and the video is done. For `converted`/`merged` it enqueues a
   `convert` job carrying the originals' S3 keys, then releases its slot.

**Convert stage** — `PipelineService.convert`, one invocation per `convert-video` job:

3. **Fetch originals** — pull the S3 object(s) the download stage produced into a temp dir.
4. **ffmpeg** — `FfmpegService` spawns the binary directly (fluent-ffmpeg is deprecated) and parses
   `-progress pipe:1` to report a percentage. Each invocation is bounded with
   `-threads N` where `N = max(1, floor(availableParallelism / convertConcurrency))` (and
   `-x264-params threads=N` for h264 paths) so two concurrent converts on a 4-core host don't
   schedule 8 software threads each and spend more time context-switching than encoding.
   Spawned children are tracked so `OnModuleDestroy` (Phase-1 graceful shutdown) sends
   `SIGTERM` → `SIGKILL` if the process is slow to exit — standalone deployments outside
   Docker no longer leak orphan ffmpegs on stop.
5. **Upload** — the converted/merged artifact is streamed to S3.

### Reliability + feedback knobs

- **Download retries**: download jobs use `attempts: 3` + exponential backoff, and
  `removeOnFail: false` keeps failure records for inspection. The convert pool stays at
  `attempts: 1` (ffmpeg is deterministic — a failure is a content issue we want to surface,
  not retry).
- **Probe + downloads distinguish "providers down" from "video gone"** via
  `ProvidersUnavailableError` vs `NotFoundException`. A transient provider outage flags work
  as `failed` (retryable), only a genuine 404 across every provider flags it `skipped`. See
  [provider-api.md](provider-api.md) and ADR 0010.
- **Re-click safety**: `DownloadService.enqueue` also checks the `WorkStore` for items in the
  `'convert'` / `'done'` states and refuses to re-enqueue them. Combined with the deterministic
  BullMQ `jobId` (`workJobId('dl|cv', …)`), re-clicking Download after a refresh creates a
  new `BatchGroup` but generates zero new jobs for work already in flight.
- **Progress emission is throttled** (≥ 250 ms gap OR ≥ 2-percentage-point delta) inside both
  `ByteProgress` and `FfmpegService.#run`, so a fast download doesn't fire ~500 BullMQ events
  per video.

Why re-read from S3 instead of teeing the download into a temp file? It keeps the pools truly
independent: the convert worker needs nothing from the download worker's process but the S3 keys, so
the two scale separately and a download slot frees the moment bytes land in S3. The original lives in
S3 regardless (it's the deliverable for `original` requests, a durable cache otherwise). Memory stays
bounded — download is a single `pipe` into the S3 `Upload`; convert streams S3 → temp file → ffmpeg.
Temp dirs are always cleaned up in a `finally`.

## ffmpeg recipes

| Goal | Command shape |
|---|---|
| Audio → m4a + cover | `ffmpeg -i audio.weba -i thumb.jpg -map 0:a -c:a aac -b:a 256k -map 1:v -c:v mjpeg -disposition:v attached_pic -movflags +faststart out.m4a` |
| Video → mp4 | `ffmpeg -i video.webm -c:v libx264 -preset veryfast -crf 23 -an -movflags +faststart out.mp4` |
| Merged → mp4 | `ffmpeg -i video.webm -i audio.weba -map 0:v -map 1:a -c:v libx264 -crf 23 -c:a aac -b:a 192k -movflags +faststart out.mp4` |
| Merged → webm (original) | `ffmpeg -i video.webm -i audio.weba -map 0:v -map 1:a -c copy out.webm` (no re-encode; only when both originals are webm-family — vp8/vp9/av1 video + opus/vorbis audio) |
| Merged → mkv (original, fallback) | `ffmpeg -i video.mp4 -i audio.m4a -map 0:v -map 1:a -c copy out.mkv` (no re-encode; matroska accepts h264/aac etc. when YouTube's "best" isn't webm-compatible. Picked over `.mp4` because matroska accepts any codec combo without a per-pair compatibility decision; playback typically needs VLC/MPV.) |

The m4a cover-art path is what makes converted audio show artwork in Apple Music. The mp4 paths
re-encode (VP9/AV1 → H.264), which is CPU-heavy — hence the concurrency-limited worker.

## S3 layout

Keys are the **video id** (ASCII, so no S3/UTF-8 filename trouble) plus a role-namespaced suffix so a
video can hold several distinct deliverables at once without collisions:

```
{id}.json                    canonical metadata (title, author, duration, thumbnails) — durable cache
{id}.src.audio.{weba|m4a}    original audio        {id}.cvt.audio.m4a   converted audio (aac + cover)
{id}.src.video.{webm|mp4}    original video        {id}.cvt.video.mp4   converted video (h264)
{id}.merged.webm             merged original       {id}.merged.mp4      merged converted
```

The `src`/`cvt`/`merged` namespacing matters: a flat `{id}.mp4` would be ambiguous between
video-converted, merged-converted and an original-mp4 video, so they are kept on separate keys. The
archive route reads `{id}.json` to recover the human title and names the zip entry `{title}.{ext}`.
Two layers of caching fall out of this: Valkey (24h, fast) for metadata, and S3 (durable) for both
metadata and the media artifacts — a repeat download of the same id/selection is pre-filtered against
S3 and served straight from it.

## Provider streaming notes

- **provider-ytdl** extracts the chosen format's direct googlevideo URL and *proxies* it server-side
  with `httpx` (forwarding the format's headers and any `Range`). Those URLs are IP-bound and
  short-lived, so they are never handed to the browser — only streamed through the provider.
  A **module-level `httpx.AsyncClient`** (with `max_keepalive_connections=64`) is reused across the
  single-stream proxy AND every parallel range fetch — TLS handshakes to googlevideo are reused
  instead of paid for per request, and the client is closed via the FastAPI `lifespan` hook on
  SIGTERM. The yt-dlp `_extract` result is cached in-process for 10 min keyed by
  `(video_id, extra_opts)`, so the typical "`GET /videos/:id` then `GET /videos/:id/stream`"
  pair invokes yt-dlp once instead of twice.
- **provider-youtubejs** streams via `info.download()` using the **`ANDROID_VR`** client, which (as
  of 2026) returns pre-deciphered URLs without a PO token; the web clients no longer do. Override
  with `YOUTUBEJS_STREAM_CLIENTS`. `getInfo` results are likewise cached for 10 min, and a
  detected session-expired error (signature mismatch / visitor data) drops the cached `Innertube`
  instance so the next call rebuilds it instead of bricking the provider until restart.
- **Both providers** advertise `Accept-Ranges` / `Content-Length` only when the **exact** size
  is known (yt-dlp's `filesize`, not `filesize_approx`) — see ADR 0009 for the bug that
  motivated it.
- **Parallel ranged downloads** (defeating YouTube's per-connection throttle) are cancel-aware:
  ytdl uses `client.stream(...)` so `task.cancel()` actually aborts the upstream socket;
  youtubejs's `ReadableStream` exposes a `cancel()` callback that stops scheduling new segment
  fetches when the consumer disconnects, and pipes segment bodies through (no per-segment
  `readAll` materialization, so memory stays ~one segment worth instead of `CONCURRENCY ×
  SEGMENT_SIZE`).
- Both prefer **opus/webm** audio (the genuine best quality and our "WEBA original"), falling back to
  m4a only when opus is unavailable — so audio behaves consistently across providers.
- **Thumbnail fetch (convert stage only)** runs through an SSRF guard:
  `ThumbnailSchema.url` is a real URL (Zod), and `PipelineService.#downloadThumbnail` rejects
  non-`https://`, loopback / RFC 1918 / link-local / IPv6 ULA hosts, follows no redirects,
  uses an `AbortSignal.timeout`, and caps the response at 1 MiB. A compromised provider
  can't steer the worker at internal services or fill the worker tmpdir with a junk URL.

## PO tokens / bot checks

If YouTube starts returning `403`s for streaming, enable a PO-token provider (behind env flags):
youtube.js can generate tokens in-process via LuanRT's BgUtils; ytdl uses the
`bgutil-ytdlp-pot-provider` plugin. Neither is required today.
