"""Shared error type + handlers that render the contract error envelope."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import get_logger

log = get_logger()


class ProviderError(Exception):
    """An error mapped to the contract's `{ "error": { code, message } }` envelope."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _envelope(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProviderError)
    async def _provider_error(_: Request, exc: ProviderError) -> JSONResponse:
        if exc.status >= 500:
            log.error("request_error", error_code=exc.code, status=exc.status, msg=exc.message)
        else:
            log.warning("request_error", error_code=exc.code, status=exc.status, msg=exc.message)
        return _envelope(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Detailed pydantic errors are logged server-side; the response body stays generic so
        # we don't echo internal field names / paths to the caller.
        log.warning("validation_error", errors=exc.errors())
        return _envelope(400, "BAD_REQUEST", "Request validation failed.")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            # Derive the resource kind from the route — a 404 on /playlists/{id} is a
            # missing playlist, not a missing video.
            code = "PLAYLIST_NOT_FOUND" if "/playlists/" in request.url.path else "VIDEO_NOT_FOUND"
        else:
            code = "BAD_REQUEST"
        return _envelope(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # `str(exc)` can leak internal paths, config keys, library version strings. Log the
        # full stack via structlog (server-side only) and respond with an opaque message.
        log.exception("unexpected_error", exc_info=exc)
        return _envelope(502, "UPSTREAM_ERROR", "Internal provider error.")
