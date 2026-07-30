"""
telemetry.py – OpenTelemetry Tracing & Prometheus Metrics
==========================================================
Provides OpenTelemetry tracing and Prometheus metrics instrumentation for
the Isolyth MCP tool server.

Metrics exposed:
  • `isolyth_tool_calls_total` (Counter, labels: tool_name, status)
  • `isolyth_tool_call_duration_seconds` (Histogram, labels: tool_name)
  • `isolyth_active_sandbox_executions` (Gauge)

Tracing:
  • OpenTelemetry Tracer setup with ConsoleSpanExporter.
"""

from collections.abc import Generator
import contextlib
import logging
import os

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from prometheus_client import (
    REGISTRY,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

logger = logging.getLogger("isolyth.telemetry")

# ── OpenTelemetry Tracing Setup ───────────────────────────────────────────────

_tracer_provider: TracerProvider | None = None
_tracer: trace.Tracer | None = None


def setup_telemetry() -> trace.Tracer:
    """Initialize OpenTelemetry tracer provider."""
    global _tracer_provider, _tracer

    if _tracer is not None:
        return _tracer

    provider = TracerProvider()

    # Console span exporter is disabled by default to avoid console clutter.
    # Enable by setting OTEL_CONSOLE_EXPORTER=true or DEBUG=true.
    enable_console_exporter = os.environ.get("OTEL_CONSOLE_EXPORTER", "").lower() in ("true", "1", "yes") or \
                             os.environ.get("DEBUG", "").lower() in ("true", "1", "yes") or \
                             os.environ.get("ISOLYTH_DEBUG", "").lower() in ("true", "1", "yes")

    if enable_console_exporter:
        processor = SimpleSpanProcessor(ConsoleSpanExporter())
        provider.add_span_processor(processor)
        logger.info("OpenTelemetry tracing initialized with ConsoleSpanExporter")
    else:
        logger.info("OpenTelemetry tracing initialized (ConsoleSpanExporter disabled)")

    trace.set_tracer_provider(provider)

    _tracer_provider = provider
    _tracer = trace.get_tracer("isolyth", "0.1.0")
    return _tracer


def get_tracer() -> trace.Tracer:
    """Get the initialized OpenTelemetry tracer."""
    if _tracer is None:
        return setup_telemetry()
    return _tracer


# ── Prometheus Metrics Setup ──────────────────────────────────────────────────

TOOL_CALLS_TOTAL = Counter(
    "isolyth_tool_calls_total",
    "Total number of tool call invocations",
    ["tool_name", "status"],
)

TOOL_CALL_DURATION_SECONDS = Histogram(
    "isolyth_tool_call_duration_seconds",
    "Duration of tool calls in seconds",
    ["tool_name"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

ACTIVE_SANDBOX_EXECUTIONS = Gauge(
    "isolyth_active_sandbox_executions",
    "Number of active WASM sandbox executions currently running",
)


def record_tool_metrics(tool_name: str, duration_s: float, status: str) -> None:
    """
    Record execution metrics for a tool call.

    Parameters
    ----------
    tool_name: Name of tool called.
    duration_s: Duration in seconds.
    status: "success", "error", "unauthorized", or "rate_limited".
    """
    TOOL_CALLS_TOTAL.labels(tool_name=tool_name, status=status).inc()
    TOOL_CALL_DURATION_SECONDS.labels(tool_name=tool_name).observe(duration_s)


@contextlib.contextmanager
def track_active_sandbox() -> Generator[None, None, None]:
    """Context manager to track active sandbox execution gauge."""
    ACTIVE_SANDBOX_EXECUTIONS.inc()
    try:
        yield
    finally:
        ACTIVE_SANDBOX_EXECUTIONS.dec()


def get_prometheus_metrics() -> str:
    """
    Export current Prometheus metrics as formatted text string.
    """
    return generate_latest(REGISTRY).decode("utf-8")
