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
RUN npm run build

# Stage 2: the server, serving the build.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.3 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/ ./
RUN uv sync --frozen --no-dev
COPY --from=web /src/web/dist /app/web/dist

ENV PORTAL_WEB_DIST=/app/web/dist \
    PORTAL_DATASETS_ROOT=/data
EXPOSE 8797
CMD ["/app/server/.venv/bin/biologger-portal", "serve", "--host", "0.0.0.0", "--port", "8797"]
