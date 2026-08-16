"""All YouTube/yt-dlp business logic. The FastAPI routes are thin and only delegate here."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse
from yt_dlp import YoutubeDL
from yt_dlp.plugins import load_all_plugins
from yt_dlp.utils import DownloadError
from yt_dlp.version import __version__ as YTDLP_VERSION

from ..errors import ProviderError
from ..logging_config import get_logger

log = get_logger()

# yt-dlp loads plugins lazily on the FIRST YoutubeDL() construction, and its loader re-executes
# each plugin module through `spec.loader.exec_module`, bypassing Python's per-module import lock.
# Our extractions run concurrently in the AnyIO threadpool, so several constructions race: modules
# get executed twice and observed half-initialised, which surfaces as `cannot import name
# 'BgUtilPTPBase'` / `PoTokenProvider ... already registered` and can leave the bgutil PO-token
# provider unregistered for the whole process. Load once here, at import time, single-threaded.
load_all_plugins()

# A request for /videos/:id is almost always followed by /videos/:id/stream from the same
# backend worker. Caching the yt-dlp `_extract` result for ~10 min halves yt-dlp invocations
# per work item (each invocation spawns extractors, runs JS, etc. — measurably expensive).
_EXTRACT_TTL_SECONDS = 600
_EXTRACT_MAX_ENTRIES = 512

# Module-level connection pool so we reuse the TLS handshake to googlevideo.com across
# parallel segments + sequential proxies. Closed via FastAPI shutdown hook in main.py.
_http_client: httpx.AsyncClient | None = None


def _shared_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=None, pool=10.0),
            limits=httpx.Limits(max_keepalive_connections=64, max_connections=128),
        )
    return _http_client


async def close_shared_http_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


class _TTLCache:
    """Tiny size + TTL bound cache (LRU-ish via dict insertion order)."""

    def __init__(self, max_entries: int, ttl_seconds: float) -> None:
        self._max = max_entries
        self._ttl = ttl_seconds
        self._data: dict[Any, tuple[float, Any]] = {}

    def get(self, key: Any) -> Any | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at < time.monotonic():
            self._data.pop(key, None)
            return None
        # Touch for recency (dict preserves insertion order).
        self._data.pop(key)
        self._data[key] = entry
        return value

    def set(self, key: Any, value: Any) -> None:
        if len(self._data) >= self._max:
            # Evict the oldest (first) entry.
            self._data.pop(next(iter(self._data)))
        self._data[key] = (time.monotonic() + self._ttl, value)


Format = dict[str, Any]
Info = dict[str, Any]

_CONTENT_TYPE = {
    ("webm", "audio"): "audio/webm",
    ("mp4", "audio"): "audio/mp4",
    ("webm", "video"): "video/webm",
    ("mp4", "video"): "video/mp4",
}

# Every download is fetched as EXPLICIT byte ranges, never as a plain un-ranged GET: googlevideo
# now rejects an un-ranged GET on these signed URLs about half the time (403) while answering the
# same URL's bounded ranges with 206. Ranges are also fetched N-at-a-time to defeat YouTube's
# per-connection throttle. Keep segments small (~1 MiB): the throttle ramps up *within* a
# connection, so small ranges stay in the fast burst. Tunable via env; 1 disables parallelism.
_SEGMENT_SIZE = max(1, int(os.environ.get("STREAM_SEGMENT_SIZE", str(1024 * 1024))))
_SEGMENT_CONCURRENCY = max(1, int(os.environ.get("STREAM_SEGMENT_CONCURRENCY", "4")))
_MIN_PARALLEL_SIZE = _SEGMENT_SIZE * 2
# A single range can still get a transient throttle/RST/timeout from googlevideo. Without a
# retry one bad segment kills the whole download (the backend then sees undici 'terminated').
# Retry the segment a couple of times with exponential backoff before giving up. Tunable.
_SEGMENT_RETRIES = max(0, int(os.environ.get("STREAM_SEGMENT_RETRIES", "2")))
_SEGMENT_RETRY_BACKOFF = max(0.0, float(os.environ.get("STREAM_SEGMENT_RETRY_BACKOFF", "0.5")))
# A 403 is different: the signed URL itself was rejected (bot-check / rate-limit / expiry), so
# replaying it is pointless — the video is fine, the URL is not. Re-extract for a fresh URL on the
# same itag and replay the range against that. The budget counts refreshes SINCE THE LAST SEGMENT
# THAT SUCCEEDED, not per download: a long file may legitimately need several over its lifetime,
# whereas a video whose every fresh URL is refused makes no progress and should fail over to the
# other provider quickly. Refreshes are self-limiting anyway — each one costs a yt-dlp extraction.
_URL_REFRESHES = max(0, int(os.environ.get("STREAM_URL_REFRESHES", "3")))

# Tier 2 backpressure: yt-dlp `_extract` is the expensive op and runs in the AnyIO threadpool;
# once in-flight extractions reach capacity, new ones queue. Track them and shed NEW extraction
# (429 + Retry-After) at the cap, and report /ready degraded at DEGRADE_AT — so K8s drains the
# pod and the backend backs off. Byte streaming (already past extraction) is never gated. This
# guards the one resource that actually saturates, tied to capacity — not an arbitrary req cap.
_EXTRACT_MAX_INFLIGHT = max(1, int(os.environ.get("EXTRACT_MAX_INFLIGHT", "40")))
_EXTRACT_DEGRADE_AT = max(
    1, int(os.environ.get("EXTRACT_DEGRADE_AT", str(max(1, int(_EXTRACT_MAX_INFLIGHT * 0.8)))))
)

# Substrings meaning YouTube is throttling THIS egress IP (vs a local fault) → 429 RATE_LIMITED,
# the real "scale out / rotate IP" signal the backend backs off on.
_RATE_LIMIT_HINTS = (
    "429",
    "too many requests",
    "rate-limit",
    "rate limit",
    "rate_limit",
    "throttl",
)


def _parse_retry_after(value: str | None) -> int:
    """Clamp an upstream Retry-After (seconds) into a sane bound; default 5s when absent/bad."""
    if value and value.strip().isdigit():
        return min(30, max(1, int(value.strip())))
    return 5


# Shared bgutil POT provider sidecar. When set, the installed bgutil-ytdlp-pot-provider plugin
# fetches a PO token from it whenever yt-dlp's chosen client/format requires one (per-video,
# automatic; dormant otherwise — does NOT change the working no-token path). Unset ⇒ no token
# fetching, so a video that newly requires one fails and the backend falls back to youtubejs.
#
# We do NOT force a token-bearing player client. As of 2026-08 every client that requires a GVS
# PO token (`web`, `web_safari`, `mweb`, `ios`, `tv_simply`) is SABR-only — it returns no directly
# fetchable https URLs at all — and `tv` reports DRM. The one client that still serves plain URLs,
# `android_vr` (yt-dlp's default), needs no token. So the plugin stays wired for the day that
# changes, but the download path is plain-URL + byte ranges.
_POT_BASE_URL = (os.environ.get("POT_PROVIDER_BASE_URL") or "").rstrip("/")


class _UpstreamForbidden(Exception):
    """Internal: googlevideo rejected the media URL with 403 and re-extracting a fresh URL did not
    help, so `stream()` can surface a clean 502 (backend fails over to the other provider) instead
    of a truncated body. Raised only before any bytes are committed; never leaves the module."""


class _MediaSource:
    """The signed googlevideo URL for one (video, kind, itag), refreshable in place.

    googlevideo can 403 a signed URL at any moment — bot-check, per-IP rate limit, expiry — and it
    does so mid-download, not just up front. The URL is stale, the video is not: re-extracting
    yields a fresh URL for the same itag that resumes at the very byte range that failed. Segments
    read `url`/`headers` through this object so a single refresh repairs the whole in-flight
    download; concurrent segments that hit 403 on the same generation coalesce onto one refresh."""

    def __init__(
        self, refresh: Callable[[], Awaitable[Format]], fmt: Format, label: str = ""
    ) -> None:
        self._refresh = refresh
        self._lock = asyncio.Lock()
        self._label = label
        self._since_progress = 0
        self.fmt = fmt
        # Monotonic; identifies which URL a caller was using so refreshes coalesce.
        self.generation = 0

    @property
    def url(self) -> str:
        return str(self.fmt["url"])

    @property
    def headers(self) -> dict[str, str]:
        return dict(self.fmt.get("http_headers") or {})

    def progress(self) -> None:
        """A range came back with bytes, so the current URL works — clear the refresh budget."""
        self._since_progress = 0

    async def refresh(self, seen_generation: int) -> bool:
        """Swap in a freshly extracted URL. `seen_generation` is the generation the caller was
        using: if it is already behind, another segment refreshed and the caller just retries.
        Returns False once the refresh budget is spent."""
        async with self._lock:
            if seen_generation != self.generation:
                return True
            if self._since_progress >= _URL_REFRESHES:
                return False
            fresh = await self._refresh()
            # A response may already have committed Content-Length from the previous format, so a
            # fresh URL is only usable if it addresses the exact same bytes. Different size ⇒ give
            # up rather than emit a truncated or over-long body.
            size, fresh_size = self.fmt.get("filesize"), fresh.get("filesize")
            if size and fresh_size and int(size) != int(fresh_size):
                return False
            self.fmt = fresh
            self.generation += 1
            self._since_progress += 1
            log.info("stream_url_refresh", source=self._label, generation=self.generation)
            return True


# Substrings in yt-dlp errors that mean "gone", not "broken".
_NOT_FOUND_HINTS = (
    "private",
    "unavailable",
    "does not exist",
    "no longer exists",
    "not exist",
    "removed",
    "deleted",
    "not found",
    "terminated",
    "members-only",
    "this video is not available",
)


def _watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _playlist_url(playlist_id: str) -> str:
    return f"https://www.youtube.com/playlist?list={playlist_id}"


class YoutubeService:
    name = "ytdl"
    library_version = YTDLP_VERSION

    def __init__(self) -> None:
        # Keyed by (url, frozenset of extra_opts items) so video and playlist extractions
        # never collide and a noplaylist variant doesn't overlap with extract_flat.
        self._extract_cache = _TTLCache(_EXTRACT_MAX_ENTRIES, _EXTRACT_TTL_SECONDS)
        # In-flight blocking extractions (Tier 2 saturation signal). Mutated only on the event
        # loop around run_in_threadpool, so a plain int is safe (async is cooperative).
        self._extract_inflight = 0

    @property
    def extract_capacity(self) -> int:
        return _EXTRACT_MAX_INFLIGHT

    @property
    def inflight_extracts(self) -> int:
        return self._extract_inflight

    @property
    def saturated(self) -> bool:
        """True once in-flight extractions reach the /ready degrade threshold."""
        return self._extract_inflight >= _EXTRACT_DEGRADE_AT

    # --- blocking extraction (run in a threadpool) -----------------------------------------

    def _extract(self, url: str, extra_opts: dict[str, Any]) -> Info:
        opts = {"quiet": True, "no_warnings": True, "skip_download": True, **extra_opts}
        extractor_args: dict[str, Any] = dict(opts.get("extractor_args") or {})
        if _POT_BASE_URL:
            # Point the bgutil HTTP POT plugin at the sidecar. yt-dlp's default fetch_pot is
            # "if_required", so a token is fetched only when a client/format actually needs one.
            extractor_args.setdefault("youtubepot-bgutilhttp", {"base_url": [_POT_BASE_URL]})
        if extractor_args:
            opts["extractor_args"] = extractor_args
        with YoutubeDL(opts) as ydl:
            return ydl.sanitize_info(ydl.extract_info(url, download=False))  # type: ignore[no-any-return]

    async def _extract_cached(
        self, url: str, extra_opts: dict[str, Any], force: bool = False
    ) -> Info:
        key = (url, frozenset(extra_opts.items()))
        # `force` is the URL-refresh path: the cached info holds the very URL googlevideo just
        # 403'd, so it must be re-extracted and the cache overwritten, not read.
        cached = None if force else self._extract_cache.get(key)
        if cached is not None:
            return cached  # type: ignore[no-any-return]
        # Tier 2: shed a NEW extraction when the threadpool is at capacity (cache hits bypass —
        # they're cheap and don't touch the threadpool). 429 + Retry-After → backend backs off.
        if self._extract_inflight >= _EXTRACT_MAX_INFLIGHT:
            raise ProviderError(
                429,
                "RATE_LIMITED",
                f"provider saturated ({self._extract_inflight} extractions in flight)",
                retry_after=1,
            )
        self._extract_inflight += 1
        try:
            info = await run_in_threadpool(self._extract, url, extra_opts)
        finally:
            self._extract_inflight -= 1
        self._extract_cache.set(key, info)
        return info

    def _classify(self, exc: DownloadError, not_found_code: str) -> ProviderError:
        msg = str(exc)
        lowered = msg.lower()
        if any(hint in lowered for hint in _NOT_FOUND_HINTS):
            return ProviderError(404, not_found_code, msg)
        if any(hint in lowered for hint in _RATE_LIMIT_HINTS):
            return ProviderError(429, "RATE_LIMITED", msg, retry_after=5)
        return ProviderError(502, "UPSTREAM_ERROR", msg)

    # --- public API ------------------------------------------------------------------------

    async def get_video_metadata(self, video_id: str) -> dict[str, Any]:
        try:
            info = await self._extract_cached(_watch_url(video_id), {"noplaylist": True})
        except DownloadError as exc:
            raise self._classify(exc, "VIDEO_NOT_FOUND") from exc
        return self._video_dto(info)

    async def get_playlist(self, playlist_id: str) -> dict[str, Any]:
        try:
            info = await self._extract_cached(_playlist_url(playlist_id), {"extract_flat": True})
        except DownloadError as exc:
            raise self._classify(exc, "PLAYLIST_NOT_FOUND") from exc
        entries = [e for e in (info.get("entries") or []) if e and e.get("id")]
        # flat extraction carries each entry's title for free — surface it per video so the
        # backend/UI can label rows immediately instead of showing raw video ids.
        videos: list[dict[str, Any]] = []
        for e in entries:
            video: dict[str, Any] = {"id": e["id"]}
            title = e.get("title")
            if title:
                video["title"] = title
            videos.append(video)
        dto: dict[str, Any] = {
            "id": info.get("id") or playlist_id,
            "title": info.get("title"),
            "videos": videos,
        }
        author = info.get("uploader") or info.get("channel")
        if author:
            dto["author"] = author
        return dto

    async def stream(
        self, video_id: str, kind: str, itag: str | None, range_header: str | None
    ) -> StreamingResponse:
        watch = _watch_url(video_id)
        source = await self._media_source(watch, kind, itag)
        try:
            # A client Range is a single proxied range — pass it straight through as a 206.
            if range_header:
                return await self._proxy(source, kind, range_header, whole=False)
            return await self._stream_full(source, kind)
        except _UpstreamForbidden as forbidden:
            raise ProviderError(
                502, "UPSTREAM_ERROR", "upstream rejected media URL (403)"
            ) from forbidden

    async def _media_source(self, watch: str, kind: str, itag: str | None) -> _MediaSource:
        """Resolve the format once and wrap it so a 403 can re-resolve it. The refresh re-selects
        by the CHOSEN itag (not by `kind` again) so a fresh URL always addresses the same bytes —
        a download that already committed Content-Length must not switch to another format."""
        fmt = await self._select_format(watch, kind, itag)
        chosen = str(fmt.get("format_id") or "") or itag

        async def refresh() -> Format:
            return await self._select_format(watch, kind, chosen, force=True)

        return _MediaSource(refresh, fmt, f"{watch.rsplit('=', 1)[-1]}/{kind}")

    async def _select_format(
        self, watch: str, kind: str, itag: str | None, force: bool = False
    ) -> Format:
        try:
            info = await self._extract_cached(watch, {"noplaylist": True}, force)
        except DownloadError as exc:
            raise self._classify(exc, "VIDEO_NOT_FOUND") from exc
        fmt = self._select(info.get("formats") or [], kind, itag)
        if fmt is None:
            raise ProviderError(404, "FORMAT_NOT_FOUND", f"no {kind} format available")
        return fmt

    # --- format selection ------------------------------------------------------------------

    def _select(self, formats: list[Format], kind: str, itag: str | None) -> Format | None:
        if itag:
            for f in formats:
                if str(f.get("format_id")) == str(itag) and f.get("url"):
                    return f
            return None
        return self._pick_audio(formats) if kind == "audio" else self._pick_video(formats)

    def _pick_audio(self, formats: list[Format]) -> Format | None:
        audios = [
            f
            for f in formats
            if f.get("acodec") not in (None, "none")
            and f.get("vcodec") in (None, "none")
            and f.get("url")
        ]
        if not audios:
            return None
        # Prefer opus/webm (the genuine best-quality audio, and our "WEBA original"); fall
        # back to whatever is best otherwise. Keeps audio choice consistent across providers.
        opus = [f for f in audios if (f.get("acodec") or "").lower().startswith("opus")]
        pool = opus or audios
        return max(pool, key=lambda f: f.get("abr") or f.get("tbr") or 0)

    def _pick_video(self, formats: list[Format]) -> Format | None:
        video_only = [
            f
            for f in formats
            if f.get("vcodec") not in (None, "none")
            and f.get("acodec") in (None, "none")
            and f.get("url")
        ]
        candidates = video_only or [
            f for f in formats if f.get("vcodec") not in (None, "none") and f.get("url")
        ]
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda f: ((f.get("height") or 0), (f.get("fps") or 0), (f.get("tbr") or 0)),
        )

    # --- streaming proxy -------------------------------------------------------------------

    async def _proxy(
        self, source: _MediaSource, kind: str, range_header: str, *, whole: bool
    ) -> StreamingResponse:
        """Stream ONE upstream ranged request straight through.

        `whole=True` means the range spans the entire file and the client never asked for a range,
        so the response is normalised to a plain 200 + Content-Length: the Range is our transport
        detail (googlevideo 403s un-ranged GETs), not something the caller requested. `whole=False`
        is a genuine client Range and keeps the upstream 206 + Content-Range."""
        client = _shared_http_client()
        while True:
            generation = source.generation
            fmt = source.fmt
            request = client.build_request(
                "GET", source.url, headers={**source.headers, "Range": range_header}
            )
            upstream = await client.send(request, stream=True)
            if upstream.status_code < 400:
                break
            retry_after = _parse_retry_after(upstream.headers.get("retry-after"))
            status = upstream.status_code
            await upstream.aclose()
            if status == 429:
                raise ProviderError(429, "RATE_LIMITED", "upstream rate-limited (429)", retry_after)
            # Nothing is committed yet, so a rejected URL is still recoverable: re-extract and
            # replay. Budget spent → clean 502 and the backend fails over.
            if status == 403:
                if await source.refresh(generation):
                    continue
                raise _UpstreamForbidden("upstream returned 403")
            raise ProviderError(502, "UPSTREAM_ERROR", f"upstream returned {status}")

        container, ext = self._container_ext(fmt.get("ext"), kind)
        out_headers = {
            "Accept-Ranges": "bytes",
            "X-Format-Itag": str(self._itag(fmt)),
            "X-Format-Container": container,
            "X-Format-Codec": self._codec(fmt, kind) or "",
            "X-Format-Ext": ext,
        }
        if (cl := upstream.headers.get("content-length")) is not None:
            out_headers["Content-Length"] = cl
        if not whole and (cr := upstream.headers.get("content-range")) is not None:
            out_headers["Content-Range"] = cr
        media_type = _CONTENT_TYPE.get((container, kind), "application/octet-stream")

        async def body() -> Any:
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                # The shared client stays open; only this response's stream is released.
                await upstream.aclose()

        return StreamingResponse(
            body(),
            status_code=200 if whole else upstream.status_code,
            media_type=media_type,
            headers=out_headers,
        )

    # --- parallel ranged download ----------------------------------------------------------

    async def _stream_full(self, source: _MediaSource, kind: str) -> StreamingResponse:
        """Serve a whole audio/video track, always over explicit byte ranges.

        Splitting into parallel segments needs the EXACT byte length — `filesize_approx` (yt-dlp's
        bitrate*duration estimate) is unsafe: over-estimate causes Range requests past EOF (502s);
        under-estimate truncates with a wrong Content-Length (corrupts S3 PUTs). When yt-dlp
        doesn't report the exact `filesize`, PROBE it with a 1-byte ranged request (Content-Range
        carries the true total); if even that is unavailable, fall back to one open-ended range."""
        total = source.fmt.get("filesize")
        if not total:
            total = await self._probe_total(source)
        if total and int(total) > _MIN_PARALLEL_SIZE:
            return await self._parallel_response(source, kind, int(total))
        # Small enough that one request suffices, or size unknown — still ranged, never a bare GET.
        span = f"bytes=0-{int(total) - 1}" if total else "bytes=0-"
        return await self._proxy(source, kind, span, whole=True)

    async def _probe_total(self, source: _MediaSource) -> int | None:
        """Discover the exact content length via a 1-byte ranged GET. googlevideo answers with
        `Content-Range: bytes 0-0/<total>`. Returns None when the total can't be established — the
        caller then serves a single open-ended range, which needs no size."""
        headers = {**source.headers, "Range": "bytes=0-0"}
        try:
            client = _shared_http_client()
            async with client.stream("GET", source.url, headers=headers) as resp:
                cr = resp.headers.get("content-range")
                if cr and "/" in cr:
                    tail = cr.rsplit("/", 1)[-1].strip()
                    if tail.isdigit():
                        return int(tail)
        except httpx.HTTPError:
            return None
        return None

    async def _fetch_segment(
        self,
        client: httpx.AsyncClient,
        source: _MediaSource,
        ranges: list[tuple[int, int]],
        i: int,
    ) -> bytes:
        """Fetch one byte range, healing the two ways googlevideo fails a healthy download:
        transient faults (timeout/RST/408/429/5xx) are replayed against the same URL after a
        backoff; a 403 means the URL itself was rejected, so the source is re-extracted and the
        range replayed against a fresh URL. Only when both budgets are spent does the download
        fail — that's what used to reach the backend as 'terminated'."""
        start, end = ranges[i]
        transient = 0
        while True:
            generation = source.generation
            headers = {**source.headers, "Range": f"bytes={start}-{end}"}
            try:
                async with client.stream("GET", source.url, headers=headers) as resp:
                    if resp.status_code < 400:
                        chunk = await resp.aread()
                        source.progress()
                        return chunk
                    code = resp.status_code
                    retry_after = _parse_retry_after(resp.headers.get("retry-after"))
            except httpx.TransportError as exc:  # timeout / RST / protocol error
                if transient < _SEGMENT_RETRIES:
                    await asyncio.sleep(_SEGMENT_RETRY_BACKOFF * (2**transient))
                    transient += 1
                    continue
                raise ProviderError(
                    502, "UPSTREAM_ERROR", f"segment {i} failed after retries: {exc}"
                ) from exc
            if code == 403:
                if await source.refresh(generation):
                    continue
                raise _UpstreamForbidden(f"segment {i} -> 403")
            if (code in (408, 429) or code >= 500) and transient < _SEGMENT_RETRIES:
                await asyncio.sleep(_SEGMENT_RETRY_BACKOFF * (2**transient))
                transient += 1
                continue
            if code == 429:
                raise ProviderError(
                    429, "RATE_LIMITED", f"segment {i} rate-limited (429)", retry_after
                )
            raise ProviderError(502, "UPSTREAM_ERROR", f"segment {i} -> {code}")

    async def _parallel_response(
        self, source: _MediaSource, kind: str, total: int
    ) -> StreamingResponse:
        ranges = [
            (start, min(start + _SEGMENT_SIZE, total) - 1)
            for start in range(0, total, _SEGMENT_SIZE)
        ]
        client = _shared_http_client()
        # Pre-flight segment 0 BEFORE committing 200 + Content-Length: an unrecoverable 403 then
        # surfaces as a clean status instead of a truncated body. Bytes are reused as chunk 0.
        first_chunk = await self._fetch_segment(client, source, ranges, 0)

        # Read the format AFTER the pre-flight: fetching segment 0 may have refreshed the source,
        # and the headers must describe the format the bytes actually came from.
        fmt = source.fmt
        container, ext = self._container_ext(fmt.get("ext"), kind)
        out_headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(total),
            "X-Format-Itag": str(self._itag(fmt)),
            "X-Format-Container": container,
            "X-Format-Codec": self._codec(fmt, kind) or "",
            "X-Format-Ext": ext,
        }
        media_type = _CONTENT_TYPE.get((container, kind), "application/octet-stream")

        async def body() -> Any:
            tasks: dict[int, asyncio.Task[bytes]] = {}
            # Keep at most _SEGMENT_CONCURRENCY fetches in flight, but yield strictly in order.
            # Segment 0 is already in hand; schedule + yield the remainder from index 1.
            try:
                yield first_chunk
                n = len(ranges)
                for i in range(1, min(_SEGMENT_CONCURRENCY + 1, n)):
                    tasks[i] = asyncio.create_task(self._fetch_segment(client, source, ranges, i))
                for nxt in range(1, n):
                    chunk = await tasks.pop(nxt)
                    scheduled = nxt + _SEGMENT_CONCURRENCY
                    if scheduled < n:
                        tasks[scheduled] = asyncio.create_task(
                            self._fetch_segment(client, source, ranges, scheduled)
                        )
                    yield chunk
            finally:
                for task in tasks.values():
                    task.cancel()
                # Shared client stays open; pending tasks' streams are released by their
                # async-with blocks as cancellation unwinds.

        return StreamingResponse(
            body(), status_code=200, media_type=media_type, headers=out_headers
        )

    # --- DTO mapping -----------------------------------------------------------------------

    def _video_dto(self, info: Info) -> dict[str, Any]:
        dto: dict[str, Any] = {
            "id": info.get("id"),
            "title": info.get("title"),
            "channelId": info.get("channel_id") or info.get("uploader_id"),
            "thumbnails": self._thumbnails(info.get("thumbnails")),
        }
        if (author := info.get("uploader") or info.get("channel")) is not None:
            dto["author"] = author
        if (duration := info.get("duration")) is not None:
            dto["durationSeconds"] = int(duration)
        if (published := self._date(info.get("upload_date"))) is not None:
            dto["publishedAt"] = published
        formats = info.get("formats") or []
        if (audio := self._pick_audio(formats)) is not None:
            dto["bestAudio"] = self._format_dto(audio, "audio")
        if (video := self._pick_video(formats)) is not None:
            dto["bestVideo"] = self._format_dto(video, "video")
        return {k: v for k, v in dto.items() if v is not None}

    def _format_dto(self, fmt: Format, kind: str) -> dict[str, Any]:
        container, ext = self._container_ext(fmt.get("ext"), kind)
        dto: dict[str, Any] = {
            "itag": self._itag(fmt),
            "ext": ext,
            "container": container,
            "codec": self._codec(fmt, kind),
        }
        if kind == "audio":
            if (br := fmt.get("abr") or fmt.get("tbr")) is not None:
                dto["bitrate"] = int(br * 1000)
        else:
            for src, dst in (("width", "width"), ("height", "height"), ("fps", "fps")):
                if fmt.get(src) is not None:
                    dto[dst] = int(fmt[src])
        if (size := fmt.get("filesize") or fmt.get("filesize_approx")) is not None:
            dto["contentLength"] = int(size)
        return {k: v for k, v in dto.items() if v is not None}

    def _itag(self, fmt: Format) -> int | str:
        fid = str(fmt.get("format_id") or "")
        return int(fid) if fid.isdigit() else fid

    def _container_ext(self, ext: str | None, kind: str) -> tuple[str, str]:
        if ext == "webm":
            return ("webm", "weba" if kind == "audio" else "webm")
        if ext in ("m4a", "mp4"):
            return ("mp4", "m4a" if kind == "audio" else "mp4")
        if ext in ("opus", "ogg"):
            return ("webm", "weba")
        return (ext or "bin", ext or "bin")

    def _codec(self, fmt: Format, kind: str) -> str | None:
        raw = (fmt.get("acodec") if kind == "audio" else fmt.get("vcodec")) or ""
        raw = raw.lower()
        if not raw or raw == "none":
            return None
        for prefix, name in (
            ("opus", "opus"),
            ("mp4a", "mp4a"),
            ("vp9", "vp9"),
            ("vp09", "vp9"),
            ("av01", "av01"),
            ("avc", "avc"),
        ):
            if raw.startswith(prefix):
                return name
        return raw.split(".")[0]

    def _date(self, upload_date: str | None) -> str | None:
        if not upload_date or len(upload_date) != 8 or not upload_date.isdigit():
            return None
        return f"{upload_date[0:4]}-{upload_date[4:6]}-{upload_date[6:8]}"

    def _thumbnails(self, thumbs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for t in thumbs or []:
            url = t.get("url")
            if not url:
                continue
            entry: dict[str, Any] = {"url": url}
            if t.get("width") is not None:
                entry["width"] = int(t["width"])
            if t.get("height") is not None:
                entry["height"] = int(t["height"])
            result.append(entry)
        return result
