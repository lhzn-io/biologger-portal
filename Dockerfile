# biologger-portal: one image with the built web app and the FastAPI server.
#
#   docker build -t biologger-portal .
#   docker run --rm -p 127.0.0.1:8797:8797 -v /Users/lhzn/Projects/whoi-mpg/datasets:/data biologger-portal
#
# Bind the published port to 127.0.0.1: in production the only way in is the Cloudflare Tunnel.

# Stage 1: build the web app.
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY configs/ /src/configs/
# The animal models' key, compiled into the viewer: deploy/hub.sh makes one per build and packs the models under
# it. Empty (a plain docker build) draws a plain marker instead of the species model.
ARG VITE_MODEL_KEY=""
RUN npm run build

# Stage 2: the server's environment. git fetches the pinned biologger-sim tag; it stays out of the final image.
FROM python:3.12-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.3 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/ ./
RUN uv sync --frozen --no-dev

# Stage 3: the runtime, serving the build.
FROM python:3.12-slim
COPY --from=server /app/server /app/server
COPY --from=web /src/web/dist /app/web/dist
COPY configs/sim-profiles/ /app/configs/sim-profiles/

ENV PORTAL_WEB_DIST=/app/web/dist \
    PORTAL_DATASETS_ROOT=/data \
    PORTAL_SIM_PROFILES_DIR=/app/configs/sim-profiles
EXPOSE 8797
CMD ["/app/server/.venv/bin/biologger-portal", "serve", "--host", "0.0.0.0", "--port", "8797"]
