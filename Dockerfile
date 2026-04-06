ARG BASE_IMAGE=ghcr.io/coollabsio/openclaw-base:2026.3.23

FROM ${BASE_IMAGE}

ARG GIT_SHA=dev
ARG BUILD_DATE=unknown
ENV BUILD_GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE}

ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    nginx \
    apache2-utils \
  && rm -rf /var/lib/apt/lists/*

# Remove default nginx site
RUN rm -f /etc/nginx/sites-enabled/default

COPY scripts/ /app/scripts/
COPY config/ /app/config/
RUN chmod +x /app/scripts/*.sh

ENV NPM_CONFIG_PREFIX="/data/npm-global" \
    UV_TOOL_DIR="/data/uv/tools" \
    UV_CACHE_DIR="/data/uv/cache" \
    GOPATH="/data/go" \
    PATH="/data/npm-global/bin:/data/uv/tools/bin:/data/go/bin:${PATH}"

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8080}/healthz || exit 1

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
