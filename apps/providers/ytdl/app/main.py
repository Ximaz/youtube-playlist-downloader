"""provider-ytdl HTTP server. Routes are thin: validate input, call the service, return."""

from __future__ import annotations

import os
import re
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    Counter,
    Histogram,
    generate_latest,
)
from starlette.responses import JSONResponse, Response, StreamingResponse

from .errors import ProviderError, install_error_handlers
from .logging_config import configure_logging, get_logger
from .services.youtube_service import YoutubeService, close_shared_http_client

REQUEST_ID_HEADER = "x-ypd-request-id"
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

configure_logging(os.getenv("LOG_LEVEL", "info"))
log = get_logger()
service = YoutubeService()

# Same metric naming as provider-youtubejs so a single Prometheus dashboard works for both.
_requests_total = Counter(
    "requests_total",
    "FastAPI HTTP requests by path family + status family.",
    ["path", "status"],
)
_request_duration_seconds = Histogram(
    "request_duration_seconds",
    "FastAPI request handling latency by path family.",
    ["path"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
)


def _path_label(path: str) -> str:
    if path.startswith("/videos/") and path.endswith("/stream"):
        return "/videos/:id/stream"
    if path.startswith("/videos/"):
        return "/videos/:id"
    if path.startswith("/playlists/"):
        return "/playlists/:id"
    return path


def _status_family(status: int) -> str:
    if status >= 500:
        return "5xx"
    if status >= 400:
        return "4xx"
    if status >= 300:
        return "3xx"
    if status >= 200:
        return "2xx"
    return "other"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Module-level httpx.AsyncClient holds keep-alive connections to googlevideo across
    # parallel range fetches — release them on shutdown so SIGTERM doesn't strand sockets.
    try:
        yield
    finally:
        await close_shared_http_client()


app = FastAPI(title="provider-ytdl", version=service.library_version, lifespan=lifespan)
install_error_handlers(app)


@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


@app.middleware("http")
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    start = time.perf_counter()
    incoming = request.headers.get(REQUEST_ID_HEADER)
    request_id = incoming if incoming and _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id

    duration = time.perf_counter() - start
    path_label = _path_label(request.url.path)
    _request_duration_seconds.labels(path=path_label).observe(duration)
    _requests_total.labels(path=path_label, status=_status_family(response.status_code)).inc()

    # Skip successful /health + /ready probes — they fire on the healthcheck/readiness interval
    # and only add noise; errors (status >= 400) are still logged so a degraded container shows.
    if request.url.path in ("/health", "/ready") and response.status_code < 400:
        return response
    if request.url.path == "/metrics":
        return response
    duration_ms = round(duration * 1000, 1)
    entity_id = request.path_params.get("video_id") or request.path_params.get("playlist_id")
    log.info(
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=duration_ms,
        id=entity_id,
        request_id=request_id,
    )
    return response


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": service.name, "version": service.library_version}


@app.get("/ready")
async def ready() -> Response:
    # Readiness: honest saturation signal (in-flight extractions vs the threadpool capacity) so
    # an orchestrator drains/stops routing to an overloaded replica and an HPA scales out. 503
    # when degraded; liveness stays on /health. No YouTube call — probing never spends quota.
    degraded = service.saturated
    body = {
        "status": "degraded" if degraded else "ready",
        "service": service.name,
        "inflightExtracts": service.inflight_extracts,
        "extractCapacity": service.extract_capacity,
    }
    return JSONResponse(content=body, status_code=503 if degraded else 200)


@app.get("/videos/{video_id}")
async def get_video(video_id: str) -> dict[str, object]:
    return await service.get_video_metadata(video_id)


@app.get("/playlists/{playlist_id}")
async def get_playlist(playlist_id: str) -> dict[str, object]:
    return await service.get_playlist(playlist_id)


@app.get("/videos/{video_id}/stream")
async def stream_video(
    video_id: str,
    request: Request,
    kind: str = Query(...),
) -> StreamingResponse:
    if kind not in ("audio", "video"):
        raise ProviderError(400, "BAD_REQUEST", "kind must be 'audio' or 'video'")
    itag = request.query_params.get("itag")
    return await service.stream(video_id, kind, itag, request.headers.get("range"))
