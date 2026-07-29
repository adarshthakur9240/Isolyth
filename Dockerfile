# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Isolyth – Production Dockerfile                                            ║
# ║  Multi-stage build: builder → runtime                                       ║
# ║  Final image runs as non-root user 'sentinel' on port 8000                  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install only the C build tools needed for asyncpg / cryptography.
# These stay in the builder stage – they never reach the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python deps into a relocatable prefix so we can
# COPY just that directory into the slimmer runtime stage.
COPY requirements.txt .
RUN pip install --upgrade pip --quiet \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="Isolyth" \
      org.opencontainers.image.description="Secure, observable MCP + FastAPI server" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.source="https://github.com/your-org/isolyth"

# libpq is needed at runtime by asyncpg (the build artefact links against it).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user with no login shell.
RUN groupadd --gid 1001 sentinel \
    && useradd  --uid 1001 --gid sentinel \
                --no-create-home --shell /bin/false sentinel

WORKDIR /app

# Copy installed Python packages from the builder stage.
COPY --from=builder /install /usr/local

# Copy the application source.
# Separate COPY layers so Docker cache can skip re-copying source on
# a deps-only change and vice-versa.
COPY server/      ./server/

# WASM modules live inside server/wasm_modules – already covered above.
# Sandbox workspace: the file_ops tool writes here; keep it writable
# by the non-root user.
RUN mkdir -p /workspace \
    && chown sentinel:sentinel /workspace

# Switch to non-root for all subsequent operations.
USER sentinel

# Python runtime tuning.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PORT=8000 \
    LOG_LEVEL=INFO

EXPOSE 8000

# Health probe: the /health endpoint must return 200.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c \
        "import urllib.request, sys; \
         r = urllib.request.urlopen('http://localhost:8000/health', timeout=4); \
         sys.exit(0 if r.status == 200 else 1)"

# Default: run the FastAPI/uvicorn HTTP server.
# Override CMD to run the raw MCP stdio server instead:
#   docker run isolyth python -m server.core.mcp_server
CMD ["python", "-m", "uvicorn", \
     "server.http_server:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
