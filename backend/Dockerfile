# API image: Python 3.12 + uv, production dependencies only.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first so code changes do not reinstall them.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" \
    CC_DATABASE_URL="sqlite+aiosqlite:////data/cc_platform.db" \
    CC_HOST=0.0.0.0 \
    CC_RELOAD=false

RUN mkdir -p /data
VOLUME /data
EXPOSE 8000

# cc-api: checks the configuration first (exit 2 with the list of problems), then serves with
# graceful shutdown (CC_SHUTDOWN_TIMEOUT_SECONDS) and the app's trusted-proxy handling.
CMD ["cc-api"]
