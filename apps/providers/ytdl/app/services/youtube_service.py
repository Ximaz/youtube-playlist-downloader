"""All YouTube/yt-dlp business logic. The FastAPI routes are thin and only delegate here."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError
from yt_dlp.version import __version__ as YTDLP_VERSION

from ..errors import ProviderError

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

# Parallel ranged download: extract once, then fetch N byte ranges concurrently to defeat
# YouTube's per-connection throttle. Keep segments small (~1 MiB): YouTube's throttle ramps
# up *within* a connection, so small ranges stay in the fast burst. Tunable via env; 1 disables.
_SEGMENT_SIZE = max(1, int(os.environ.get("STREAM_SEGMENT_SIZE", str(1024 * 1024))))
_SEGMENT_CONCURRENCY = max(1, int(os.environ.get("STREAM_SEGMENT_CONCURRENCY", "4")))
_MIN_PARALLEL_SIZE = _SEGMENT_SIZE * 2
# A single range can still get a transient throttle/RST/timeout from googlevideo. Without a
# retry one bad segment kills the whole download (the backend then sees undici 'terminated').
# Retry the segment a couple of times with exponential backoff before giving up. Tunable.
_SEGMENT_RETRIES = max(0, int(os.environ.get("STREAM_SEGMENT_RETRIES", "2")))
_SEGMENT_RETRY_BACKOFF = max(0.0, float(os.environ.get("STREAM_SEGMENT_RETRY_BACKOFF", "0.5")))

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

    # --- blocking extraction (run in a threadpool) -----------------------------------------

    def _extract(self, url: str, extra_opts: dict[str, Any]) -> Info:
        opts = {"quiet": True, "no_warnings": True, "skip_download": True, **extra_opts}
        with YoutubeDL(opts) as ydl:
            return ydl.sanitize_info(ydl.extract_info(url, download=False))  # type: ignore[no-any-return]

    async def _extract_cached(self, url: str, extra_opts: dict[str, Any]) -> Info:
        key = (url, frozenset(extra_opts.items()))
        cached = self._extract_cache.get(key)
        if cached is not None:
            return cached  # type: ignore[no-any-return]
        info = await run_in_threadpool(self._extract, url, extra_opts)
        self._extract_cache.set(key, info)
        return info

    def _classify(self, exc: DownloadError, not_found_code: str) -> ProviderError:
        msg = str(exc)
        lowered = msg.lower()
        if any(hint in lowered for hint in _NOT_FOUND_HINTS):
            return ProviderError(404, not_found_code, msg)
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
        # flat extraction carries each entry's title for free — surface it as an id->title map
        # so the backend/UI can label rows immediately instead of showing raw video ids.
        video_titles = {e["id"]: e["title"] for e in entries if e.get("title")}
        dto: dict[str, Any] = {
            "id": info.get("id") or playlist_id,
            "title": info.get("title"),
            "videoIds": [e["id"] for e in entries],
        }
        if video_titles:
            dto["videoTitles"] = video_titles
        author = info.get("uploader") or info.get("channel")
        if author:
            dto["author"] = author
        return dto

    async def stream(
        self, video_id: str, kind: str, itag: str | None, range_header: str | None
    ) -> StreamingResponse:
        try:
            info = await self._extract_cached(_watch_url(video_id), {"noplaylist": True})
        except DownloadError as exc:
            raise self._classify(exc, "VIDEO_NOT_FOUND") from exc
        fmt = self._select(info.get("formats") or [], kind, itag)
        if fmt is None:
            raise ProviderError(404, "FORMAT_NOT_FOUND", f"no {kind} format available")
        # A client Range is served as-is; a full download is parallelized across byte ranges.
        if range_header:
            return await self._proxy(fmt, kind, range_header)
        return await self._stream_full(fmt, kind)

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

    async def _proxy(self, fmt: Format, kind: str, range_header: str | None) -> StreamingResponse:
        req_headers = dict(fmt.get("http_headers") or {})
        if range_header:
            req_headers["Range"] = range_header

        client = _shared_http_client()
        request = client.build_request("GET", fmt["url"], headers=req_headers)
        upstream = await client.send(request, stream=True)
        if upstream.status_code >= 400:
            await upstream.aclose()
            raise ProviderError(502, "UPSTREAM_ERROR", f"upstream returned {upstream.status_code}")

        container, ext = self._container_ext(fmt.get("ext"), kind)
        codec = self._codec(fmt, kind) or ""
        out_headers = {
            "Accept-Ranges": "bytes",
            "X-Format-Itag": str(self._itag(fmt)),
            "X-Format-Container": container,
            "X-Format-Codec": codec,
            "X-Format-Ext": ext,
        }
        if (cl := upstream.headers.get("content-length")) is not None:
            out_headers["Content-Length"] = cl
        if (cr := upstream.headers.get("content-range")) is not None:
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
            body(), status_code=upstream.status_code, media_type=media_type, headers=out_headers
        )

    # --- parallel ranged download ----------------------------------------------------------

    async def _stream_full(self, fmt: Format, kind: str) -> StreamingResponse:
        """Full download: parallelize across byte ranges to defeat YouTube's throttle.

        We need the EXACT byte length for ranged segments — `filesize_approx` (yt-dlp's
        bitrate*duration estimate) is unsafe: over-estimate causes Range requests past EOF
        (502s); under-estimate truncates with a wrong Content-Length (corrupts S3 PUTs). When
        yt-dlp doesn't report the exact `filesize`, we PROBE it with a 1-byte ranged request
        (Content-Range carries the true total) rather than falling back to a single un-ranged
        GET — that bare GET is exactly what YouTube throttles to a stall ('terminated')."""
        total = fmt.get("filesize")
        if not total:
            total = await self._probe_total(fmt)
        if total and int(total) > _MIN_PARALLEL_SIZE and _SEGMENT_CONCURRENCY > 1:
            return self._parallel_response(fmt, kind, int(total))
        # Small file (burst completes before the throttle ramps) or size genuinely unknown
        # (server didn't return Content-Range): a single stream is acceptable / unavoidable.
        return await self._proxy(fmt, kind, None)

    async def _probe_total(self, fmt: Format) -> int | None:
        """Discover the exact content length via a 1-byte ranged GET. googlevideo answers with
        `Content-Range: bytes 0-0/<total>`. Returns None if the server doesn't support ranges."""
        headers = {**dict(fmt.get("http_headers") or {}), "Range": "bytes=0-0"}
        try:
            client = _shared_http_client()
            async with client.stream("GET", fmt["url"], headers=headers) as resp:
                cr = resp.headers.get("content-range")
                if cr and "/" in cr:
                    tail = cr.rsplit("/", 1)[-1].strip()
                    if tail.isdigit():
                        return int(tail)
        except httpx.HTTPError:
            return None
        return None

    def _parallel_response(self, fmt: Format, kind: str, total: int) -> StreamingResponse:
        url = fmt["url"]
        base_headers = dict(fmt.get("http_headers") or {})
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
        ranges = [
            (start, min(start + _SEGMENT_SIZE, total) - 1)
            for start in range(0, total, _SEGMENT_SIZE)
        ]

        async def body() -> Any:
            client = _shared_http_client()
            tasks: dict[int, asyncio.Task[bytes]] = {}

            async def fetch(i: int) -> bytes:
                start, end = ranges[i]
                headers = {**base_headers, "Range": f"bytes={start}-{end}"}
                # Retry a throttled/reset/timed-out segment a few times before failing the whole
                # stream — a single transient blip shouldn't surface to the backend as 'terminated'.
                # Retryable: transport errors (timeout/RST) + 408/429/5xx. A real 4xx is permanent.
                for attempt in range(_SEGMENT_RETRIES + 1):
                    try:
                        # client.stream() is cancel-aware: task.cancel() aborts the upstream socket
                        # immediately. client.get() reads to completion regardless of caller state.
                        async with client.stream("GET", url, headers=headers) as resp:
                            if resp.status_code >= 400:
                                code = resp.status_code
                                retryable = code in (408, 429) or code >= 500
                                if retryable and attempt < _SEGMENT_RETRIES:
                                    await asyncio.sleep(_SEGMENT_RETRY_BACKOFF * (2**attempt))
                                    continue
                                raise ProviderError(
                                    502, "UPSTREAM_ERROR", f"segment {i} -> {resp.status_code}"
                                )
                            return await resp.aread()
                    except httpx.TransportError as exc:  # timeout / RST / protocol error
                        if attempt < _SEGMENT_RETRIES:
                            await asyncio.sleep(_SEGMENT_RETRY_BACKOFF * (2**attempt))
                            continue
                        raise ProviderError(
                            502, "UPSTREAM_ERROR", f"segment {i} failed after retries: {exc}"
                        ) from exc
                # Unreachable: the loop either returns the bytes or raises on the last attempt.
                raise ProviderError(502, "UPSTREAM_ERROR", f"segment {i} exhausted retries")

            # Keep at most _SEGMENT_CONCURRENCY fetches in flight, but yield strictly in order.
            try:
                n = len(ranges)
                for i in range(min(_SEGMENT_CONCURRENCY, n)):
                    tasks[i] = asyncio.create_task(fetch(i))
                for nxt in range(n):
                    chunk = await tasks.pop(nxt)
                    scheduled = nxt + _SEGMENT_CONCURRENCY
                    if scheduled < n:
                        tasks[scheduled] = asyncio.create_task(fetch(scheduled))
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
