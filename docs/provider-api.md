# Provider API contract

A **provider** is a small, stateless HTTP server that knows how to talk to YouTube and
nothing else. It fetches metadata and streams a single encoded media track. It does **no**
caching, S3, ffmpeg, auth, or business logic — those live in the backend.

The backend treats every provider as a drop-in replacement and tries them in a configured
order (`PROVIDER_ORDER`), falling back to the next on any failure. Therefore **every provider
MUST implement this contract identically**: same paths, query params, JSON shapes, status
codes, error envelope, and request logging.

This repo ships two providers — `provider-ytdl` (Python / yt-dlp) and `provider-youtubejs`
(Node / youtubei.js) — but the contract is deliberately language-agnostic. A machine-readable
JSON Schema mirror of this document lives at
[`docs/provider-contract.schema.json`](provider-contract.schema.json) — point ajv (TS/JS),
datamodel-code-generator (Pydantic), or quicktype (Go/Rust/Swift/…) at it to generate types
in your provider's language. The schema is derived from the same Zod definitions the backend
uses to validate incoming provider responses (see
`apps/backend/src/providers/provider-client.service.ts`); regenerate via
`pnpm --filter @ypd/backend contract:export`.

> **Terminology.** "stream" here = **the encoded media track of a regular video** — one
> adaptive format identified by an `itag` (e.g. itag 140 = m4a audio, itag 251 = webm/opus
> audio, itag 248 = webm/vp9 video). This is **not** about YouTube Live / community streams,
> which are out of scope.

---

## Conventions

- Base URL: `http://<host>:<port>` (ytdl = `:5000`, youtubejs = `:5001`).
- All JSON responses are `Content-Type: application/json; charset=utf-8`.
- All video/playlist IDs are the raw YouTube IDs (the backend extracts them from URLs; a
  provider never sees a YouTube URL).
- **Logging:** one structured JSON line per request at `info`, with at least:
  `{ "level", "ts", "service", "method", "path", "status", "duration_ms", "id"? }`.
  Failures log at `warn` (4xx) / `error` (5xx) with an added `error_code`.
- **Timeouts/retries** are the backend's responsibility; providers should just succeed or
  fail fast with the correct status code.

---

## `GET /health`

Liveness probe. Never touches YouTube.

`200 OK`
```json
{ "status": "ok", "service": "ytdl", "version": "2026.3.17" }
```
- `service`: `"ytdl"` or `"youtubejs"` (stable identifier; used in logs).
- `version`: the underlying library version (informational).

---

## `GET /metrics`

Prometheus text exposition (`Content-Type: text/plain; version=0.0.4`). Process-level
counters/histograms (`requests_total{path,status}`, `request_duration_seconds{path}`) plus
the default Node/Python process metrics. Path labels are normalized (`/videos/:id`,
`/videos/:id/stream`, `/playlists/:id`) so cardinality stays bounded regardless of traffic.

The backend's `MetricsService` adds matching counters for the fan-out side
(`provider_request_duration_seconds`, `provider_fallbacks_total`, `contract_violations_total`).
A single Prometheus job can scrape all three services and dashboard them together.

---

## Request correlation

Every request is logged with a `request_id` field. If the backend sends a
`x-ypd-request-id` header (it always does once the middleware in
`apps/backend/src/main.ts` mints one), the provider adopts that id; otherwise it generates a
fresh UUID. The header is echoed back on the response, so the backend's logs and the
provider's logs can be joined on the same id.

---

## `GET /videos/:id`

Fetch a single video's metadata plus the **best** audio and video format descriptors.

`200 OK`
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "...",
  "author": "...",
  "channelId": "UC...",
  "durationSeconds": 213,
  "publishedAt": "2009-10-25",
  "thumbnails": [
    { "url": "https://...", "width": 1280, "height": 720 }
  ],
  "bestAudio": {
    "itag": 251,
    "ext": "weba",
    "container": "webm",
    "codec": "opus",
    "bitrate": 130000,
    "contentLength": 3456789
  },
  "bestVideo": {
    "itag": 248,
    "ext": "webm",
    "container": "webm",
    "codec": "vp9",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "contentLength": 23456789
  }
}
```

Field rules (identical across providers):
- `publishedAt`: `YYYY-MM-DD` (date only; providers normalize from their own format).
- `thumbnails`: ordered, largest last is **not** required; the backend picks the largest by
  `width*height`. At least one entry SHOULD be present.
- `ext`: the file extension the backend will use for the **original** download —
  `weba` (webm audio), `webm` (webm video), `m4a` (mp4 audio), `mp4` (mp4 video).
- `container`: `webm` | `mp4`. `codec`: e.g. `opus` | `mp4a` (audio); `vp9` | `av01` | `avc` (video).
- `contentLength`: bytes if known, else omit the field (do not send `null`).
- `bestAudio` / `bestVideo`: omit the key entirely if that kind is unavailable.

The backend caches this object (Valkey, 24h) and persists it to S3 as `{id}.json`.

---

## `GET /playlists/:id`

Resolve a playlist to the complete, ordered list of its video IDs. Providers MUST paginate
to return **all** entries, not just the first page. Private/deleted entries that cannot be
resolved to a playable ID are omitted.

`200 OK`
```json
{
  "id": "PL...",
  "title": "My playlist",
  "author": "...",
  "videoIds": ["dQw4w9WgXcQ", "..."]
}
```
- `author`: omit if unknown.
- `videoIds`: order preserved as in the playlist; may be empty (`[]`) for an empty playlist.

---

## `GET /videos/:id/stream`

Stream the raw bytes of **one** encoded media track. The backend pipes the response body
straight into the S3 multipart upload (and, when converting, a tee to a temp file for ffmpeg).

Query params:
- `kind` (**required**): `audio` | `video`.
- `itag` (optional): force a specific format. If omitted, the provider streams the same
  "best" format it reported in `GET /videos/:id` for that `kind`.

Response: `200 OK` (or `206 Partial Content` if a `Range` request header was sent), body =
raw media bytes. Headers:
- `Content-Type`: `audio/webm` | `audio/mp4` | `video/webm` | `video/mp4`.
- `Content-Length`: set **only** when the *exact* size is known (e.g. yt-dlp's `filesize`,
  not `filesize_approx`); omitted otherwise. Lying here corrupts S3 PUTs and triggers 502s
  on parallel ranged downloads — see ADR 0009.
- `Accept-Ranges`: `bytes` when `Content-Length` is known, omitted otherwise.
- `Content-Range`: set on `206`.
- `X-Format-Itag`, `X-Format-Container`, `X-Format-Codec`, `X-Format-Ext`: describe the
  format actually being streamed, so the backend names files and drives ffmpeg without
  re-fetching metadata.

Providers SHOULD honor a `Range` request header and respond `206` so the backend can resume,
accept single-range requests (`bytes=N-M`, `bytes=N-`, `bytes=-N`) and reply `416 Range Not
Satisfiable` for multi-range requests (a single `Content-Range` header can't express them).

The backend pulls the body through an **inactivity watchdog** (default 30 s, env
`STREAM_INACTIVITY_MS`): if the upstream stops sending data after headers arrive, the worker
destroys the stream so a slowloris provider can't pin a download slot indefinitely.

---

## Error envelope

Every non-2xx response uses the same shape:
```json
{ "error": { "code": "VIDEO_NOT_FOUND", "message": "human-readable detail" } }
```

| HTTP | `code` | When |
|------|--------|------|
| 400  | `BAD_REQUEST`        | missing/invalid params (e.g. no `kind`) |
| 404  | `VIDEO_NOT_FOUND`    | video does not exist / is private / removed |
| 404  | `PLAYLIST_NOT_FOUND` | playlist does not exist / is private |
| 404  | `FORMAT_NOT_FOUND`   | requested `kind`/`itag` not available |
| 416  | `BAD_REQUEST`        | multi-range / unsatisfiable `Range` |
| 429  | `RATE_LIMITED`       | provider was throttled upstream (include `Retry-After`) |
| 502  | `UPSTREAM_ERROR`     | YouTube/network failure, bot-check, generic upstream issue |

The envelope is **decoded by the backend**, not just status-sniffed. `ProviderErrorEnvelopeSchema`
in [`packages/shared/src/providers.ts`](../packages/shared/src/providers.ts) is the source of
truth; `ProviderClientService.#peekErrorCode` parses every non-2xx body and uses the code to
drive fallback semantics:

- **`VIDEO_NOT_FOUND` / `PLAYLIST_NOT_FOUND` / `FORMAT_NOT_FOUND`** on **every** provider →
  the backend throws `NotFoundException`. The video is genuinely gone upstream; the download
  pipeline records it as `skipped` (terminal, non-retryable, also seeds a Valkey negative
  cache for 60 s so subsequent batches short-circuit).
- **At least one transport-level failure** (network / 5xx / contract violation / timeout) →
  the backend throws `ProvidersUnavailableError` instead. The download pipeline maps that to
  `failed` (BullMQ retries via `attempts: 3` + exponential backoff). See ADR 0010 for why
  conflating the two used to permanently flag transient failures as "unavailable".
- **`429`** with `Retry-After`: the backend waits up to 30 s and retries the **same**
  provider once before falling through to the next. Honour the header — saying you're rate-
  limited and then refusing to be polled politely is worse than failing fast.

Provider calls are globally bounded by a `p-limit` semaphore in `ProviderClientService`
(default 16, env `PROVIDER_GLOBAL_CONCURRENCY`) so a 100-video probe can't open 100 sockets
per provider.

---

## How to add a new provider

1. Build an HTTP server (any language) that implements the four endpoints above with the
   exact shapes, status codes, error envelope, and JSON request logging.
2. Containerize it; expose its port on the `network-backend` Docker network (not to the host).
3. Register it with the backend:
   - add a base-URL env var, e.g. `PROVIDER_FOO_URL=http://provider-foo:5002`;
   - add its short name to `PROVIDER_ORDER` (e.g. `ytdl,youtubejs,foo`) in the desired
     fallback position.

That's all — the backend needs no code change. It builds its `ProviderRegistry` from
`PROVIDER_ORDER` + the matching `PROVIDER_<NAME>_URL` variables and walks them in order.
