# syntax=docker/dockerfile:1.7
# Slipstream control plane + web console. The agentgateway binary is pinned to
# 1.7.0 so apply --validate-only and the optional data-plane service use the
# same release the adapter renders for.

FROM node:22-alpine AS web-builder
WORKDIR /workspace
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

FROM python:3.12-slim AS runtime
ARG AG_VERSION=1.7.0
ARG AG_ARCH=amd64
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/api/src \
    SLIPSTREAM_WEB_DIST_DIR=/app/web/dist \
    SLIPSTREAM_DATA_PLANE_CONFIG_DIR=/data/ag-config \
    SLIPSTREAM_AG_BINARY=/usr/local/bin/agentgateway

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /usr/local/bin/agentgateway \
       "https://github.com/agentgateway/agentgateway/releases/download/v${AG_VERSION}/agentgateway-linux-${AG_ARCH}" \
    && chmod 0755 /usr/local/bin/agentgateway \
    && /usr/local/bin/agentgateway --version

WORKDIR /app
COPY api/pyproject.toml /app/api/pyproject.toml
COPY api/src /app/api/src
COPY api/scripts /app/api/scripts
RUN pip install --no-cache-dir -e /app/api
COPY --from=web-builder /workspace/web/dist /app/web/dist
COPY docker/entrypoint.sh /usr/local/bin/slipstream-entrypoint
RUN chmod 0755 /usr/local/bin/slipstream-entrypoint \
    && useradd --create-home --uid 10001 slipstream \
    && mkdir -p /data/ag-config \
    && chown -R slipstream:slipstream /app /data
USER slipstream
WORKDIR /app/api
EXPOSE 3700
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
    CMD curl -fsS http://127.0.0.1:3700/admin/health || exit 1
ENTRYPOINT ["/usr/local/bin/slipstream-entrypoint"]
CMD ["uvicorn", "l06_api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "3700"]
