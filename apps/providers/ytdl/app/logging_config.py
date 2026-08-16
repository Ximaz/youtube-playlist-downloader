"""Structured JSON logging shared by every request. Field names match the contract:
level, ts, service, msg, plus per-request method/path/status/duration_ms/id."""

from __future__ import annotations

import logging
from typing import cast

import structlog

_SERVICE = "ytdl"
_configured = False


class _SkipHealthAccessFilter(logging.Filter):
    """Drop uvicorn access-log lines for successful /health probes (fired on the
    healthcheck interval). Errors (status >= 400) still pass through."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 5:
            path = str(args[2]).split("?", 1)[0]
            status = args[4]
            if path == "/health" and isinstance(status, int) and status < 400:
                return False
        return True


def configure_logging(level: str = "INFO") -> None:
    global _configured
    if _configured:
        return
    logging.basicConfig(format="%(message)s", level=getattr(logging, level.upper(), logging.INFO))
    logging.getLogger("uvicorn.access").addFilter(_SkipHealthAccessFilter())
    # httpx logs every request line at INFO — one per byte range, so a single 70 MB download
    # emits ~70 of them, and each line contains the FULL signed googlevideo URL (its `sig` and
    # any `pot` are credentials). Keep its warnings, drop the per-request spam.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", key="ts"),
            structlog.processors.EventRenamer("msg"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger() -> structlog.stdlib.BoundLogger:
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger().bind(service=_SERVICE))
