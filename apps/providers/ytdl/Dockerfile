# syntax=docker/dockerfile:1

# ---- builder: resolve the frozen lockfile into a self-contained .venv ----
FROM python:3.13-slim AS builder
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
RUN pip install --no-cache-dir uv==0.11.16
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ---- runtime: just python + the prebuilt venv + app code ----
FROM python:3.13-slim AS runtime
ENV PATH="/app/.venv/bin:$PATH" \
    PORT=5000 \
    LOG_LEVEL=info \
    PYTHONUNBUFFERED=1
WORKDIR /app
# tini = PID 1 init: reaps zombies (yt-dlp spawns ffprobe + subshells), forwards SIGTERM
# to uvicorn so FastAPI's lifespan shutdown closes the shared httpx pool cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --chown=app:app app ./app
USER app
EXPOSE 5000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=12 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health').status==200 else 1)" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
