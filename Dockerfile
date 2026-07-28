# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="Isolyth" \
      org.opencontainers.image.description="Secure, observable MCP server" \
      org.opencontainers.image.version="0.1.0"

# Non-root user for security
RUN useradd --no-create-home --shell /bin/false sentinel

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY server/ ./server/

# Workspace directory for sandbox
RUN mkdir -p /workspace && chown sentinel:sentinel /workspace

USER sentinel

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_LEVEL=INFO

# MCP stdio server – communicates over stdin/stdout, no port to EXPOSE
CMD ["python", "-m", "server.core.mcp_server"]
