# Build context: repo root (see compose.yaml). Stage 1 builds the viewer; stage 2 runs the agent server,
# which serves it. Layout mirrors the repo so REPO_ROOT resolves to /app and static_dir to /app/frontend/dist.
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY shared/ /app/shared/
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/app/backend/.venv/bin:$PATH" \
    CASES_DIR=/app/frontend/dist/cases
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
RUN uv sync --frozen --no-dev
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN useradd --create-home appuser && chown -R appuser /app/frontend/dist/cases
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1
CMD ["uvicorn", "jarvis_neuro.agent.app:app", "--host", "0.0.0.0", "--port", "8000"]
