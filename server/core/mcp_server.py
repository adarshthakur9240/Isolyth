"""
Isolyth – Core MCP Server
==========================
A stdio-based MCP server built with the official Python MCP SDK.

Responsibilities:
  • Bootstrap and run the MCP server over stdio transport
  • Maintain a dynamic tool registry (register / unregister at runtime)
  • Implement the MCP `list_tools` and `call_tool` request handlers
  • Emit structured JSON logs via Python's logging module
  • Return well-formed MCP error responses on failure
"""

import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
import json
import logging
import sys
import time
from typing import Any

import mcp.types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from server.core.auth import AuthError, authenticate_request
from server.core.rate_limit import RateLimiter
from server.core.telemetry import (
    get_tracer,
    record_tool_metrics,
    setup_telemetry,
)
from server.tools.code_exec_tool import (
    CODE_EXEC_TOOL_SCHEMA,
    code_exec_handler,
)
from server.tools.db_query_tool import (
    DB_QUERY_TOOL_SCHEMA,
    db_query_handler,
)
from server.tools.file_ops_tool import (
    FILE_OPS_TOOL_SCHEMA,
    file_ops_handler,
)
from server.tools.web_fetch_tool import (
    WEB_FETCH_TOOL_SCHEMA,
    web_fetch_handler,
)

# ── Structured JSON logging ───────────────────────────────────────────────────


class _JsonFormatter(logging.Formatter):
    """Format every log record as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D102
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if hasattr(record, "extra"):
            payload.update(record.extra)  # type: ignore[arg-type]
        return json.dumps(payload)


def _configure_logging(level: int = logging.INFO) -> logging.Logger:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger("isolyth")
    root.setLevel(level)
    root.addHandler(handler)
    return root


logger = _configure_logging()

# ── Tool registry ─────────────────────────────────────────────────────────────

ToolHandler = Callable[
    [dict[str, Any]],
    Coroutine[Any, Any, list[types.TextContent | types.ImageContent | types.EmbeddedResource]],
]


@dataclass
class ToolEntry:
    """Metadata + handler for a registered tool."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: ToolHandler


@dataclass
class ToolRegistry:
    """Dynamic registry that maps tool names → ToolEntry objects."""

    _tools: dict[str, ToolEntry] = field(default_factory=dict)

    # ── Mutation ──────────────────────────────────────────────────────────────

    def register(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        handler: ToolHandler,
    ) -> None:
        """Register (or replace) a tool by name."""
        self._tools[name] = ToolEntry(
            name=name,
            description=description,
            input_schema=input_schema,
            handler=handler,
        )
        logger.info("Tool registered", extra={"extra": {"tool": name}})

    def unregister(self, name: str) -> bool:
        """Remove a tool; return True if it existed."""
        existed = name in self._tools
        self._tools.pop(name, None)
        if existed:
            logger.info("Tool unregistered", extra={"extra": {"tool": name}})
        return existed

    # ── Query ─────────────────────────────────────────────────────────────────

    def list_tools(self) -> list[types.Tool]:
        """Return all registered tools in MCP Tool format."""
        return [
            types.Tool(
                name=entry.name,
                description=entry.description,
                inputSchema=entry.input_schema,
            )
            for entry in self._tools.values()
        ]

    def get(self, name: str) -> ToolEntry | None:
        return self._tools.get(name)

    def __len__(self) -> int:
        return len(self._tools)


# ── Server factory ────────────────────────────────────────────────────────────




# Initialize OpenTelemetry telemetry tracer
setup_telemetry()

# Global default rate limiter instance
_default_rate_limiter = RateLimiter()


# ── Server factory ────────────────────────────────────────────────────────────


def build_server(
    registry: ToolRegistry | None = None,
    rate_limiter: RateLimiter | None = None,
    require_auth: bool | None = None,
) -> tuple[Server, ToolRegistry]:
    """
    Construct and wire up the MCP Server instance with Auth, Rate Limiting,
    and OpenTelemetry + Prometheus instrumentation.

    Returns (server, registry) so callers can register additional tools
    before starting the transport.
    """
    if registry is None:
        registry = ToolRegistry()

    limiter = rate_limiter or _default_rate_limiter
    tracer = get_tracer()
    server: Server = Server("isolyth")

    # ── Handler: list_tools ───────────────────────────────────────────────────

    @server.list_tools()
    async def handle_list_tools() -> list[types.Tool]:
        tools = registry.list_tools()
        logger.info(
            "list_tools called",
            extra={"extra": {"tool_count": len(tools)}},
        )
        return tools

    # ── Handler: call_tool ────────────────────────────────────────────────────

    @server.call_tool()
    async def handle_call_tool(
        name: str,
        arguments: dict[str, Any] | None,
    ) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
        t0 = time.perf_counter()
        args = dict(arguments or {})

        logger.info(
            "call_tool called",
            extra={"extra": {"tool": name}},
        )

        # ── Step 1: Authentication Check ──────────────────────────────────────
        try:
            user_claims = authenticate_request(args, require_auth=require_auth)
            user_id = str(user_claims.get("sub", "anonymous"))
        except AuthError as exc:
            duration_s = time.perf_counter() - t0
            record_tool_metrics(name, duration_s, status="unauthorized")
            logger.warning(
                "Unauthorized tool call attempt",
                extra={"extra": {"tool": name, "error": str(exc)}},
            )
            return [
                types.TextContent(
                    type="text",
                    text=json.dumps(
                        {
                            "error": "Unauthorized",
                            "message": str(exc),
                        }
                    ),
                )
            ]

        # ── Step 2: Rate Limit Check ──────────────────────────────────────────
        allowed, rate_info = await limiter.is_allowed(user_id, name)
        if not allowed:
            duration_s = time.perf_counter() - t0
            record_tool_metrics(name, duration_s, status="rate_limited")
            logger.warning(
                "Rate limit exceeded",
                extra={"extra": {"tool": name, "user_id": user_id, "info": rate_info}},
            )
            return [
                types.TextContent(
                    type="text",
                    text=json.dumps(
                        {
                            "error": "RateLimitExceeded",
                            "message": (
                                f"Rate limit exceeded for tool {name!r}. "
                                f"Limit: {rate_info['limit']} req / {rate_info['reset_seconds']}s"
                            ),
                            "rate_limit_info": rate_info,
                        }
                    ),
                )
            ]

        # ── Step 3 & 4: Traced Execution & Metrics Recording ──────────────────
        with tracer.start_as_current_span(
            f"tool_call:{name}",
            attributes={
                "tool_name": name,
                "user_id": user_id,
            },
        ) as span:
            entry = registry.get(name)
            if entry is None:
                duration_s = time.perf_counter() - t0
                span.set_attribute("success", False)
                span.set_attribute("error", "Unknown tool")
                record_tool_metrics(name, duration_s, status="error")
                logger.warning("Unknown tool requested", extra={"extra": {"tool": name}})
                raise ValueError(f"Unknown tool: {name!r}")

            # Strip internal token from args before passing to handler
            clean_args = dict(args)
            clean_args.pop("_auth_token", None)
            clean_args.pop("auth_token", None)

            try:
                result = await entry.handler(clean_args)
                duration_s = time.perf_counter() - t0
                span.set_attribute("duration_ms", round(duration_s * 1000, 2))
                span.set_attribute("success", True)
                record_tool_metrics(name, duration_s, status="success")
                logger.info(
                    "call_tool succeeded",
                    extra={"extra": {"tool": name, "user_id": user_id}},
                )
                return result
            except Exception as exc:
                duration_s = time.perf_counter() - t0
                span.set_attribute("duration_ms", round(duration_s * 1000, 2))
                span.set_attribute("success", False)
                span.set_attribute("error.message", str(exc))
                record_tool_metrics(name, duration_s, status="error")
                logger.exception(
                    "call_tool handler raised an exception",
                    extra={"extra": {"tool": name, "user_id": user_id}},
                )
                return [
                    types.TextContent(
                        type="text",
                        text=json.dumps(
                            {
                                "error": type(exc).__name__,
                                "message": str(exc),
                            }
                        ),
                    )
                ]

    return server, registry


# ── Real tool registration ────────────────────────────────────────────────────


def _register_real_tools(registry: ToolRegistry) -> None:
    """Register all production tool implementations."""

    registry.register(
        name="db_query",
        description=(
            "Execute a read-only SQL SELECT statement against the configured "
            "PostgreSQL database and return rows as JSON. "
            "INSERT/UPDATE/DELETE/DROP and other mutations are blocked."
        ),
        input_schema=DB_QUERY_TOOL_SCHEMA,
        handler=db_query_handler,
    )

    registry.register(
        name="web_fetch",
        description=(
            "Fetch the content of a public URL (http:// or https:// only) and "
            "return the response body as text. Internal/private IP ranges are "
            "blocked to prevent SSRF attacks."
        ),
        input_schema=WEB_FETCH_TOOL_SCHEMA,
        handler=web_fetch_handler,
    )

    registry.register(
        name="file_ops",
        description=(
            "Read a file or list a directory within the sandboxed workspace. "
            "Path traversal (../) is blocked; all paths are validated against "
            "the configured sandbox root before any filesystem access."
        ),
        input_schema=FILE_OPS_TOOL_SCHEMA,
        handler=file_ops_handler,
    )

    registry.register(
        name="code_exec",
        description=(
            "Evaluate a restricted arithmetic/math expression inside a WASM "
            "sandbox and return the numeric result. Supports +, -, *, /, ^, %, "
            "parentheses, functions (sqrt, abs, floor, ceil, round, min, max, "
            "sin, cos, tan, log), and constants (pi, e)."
        ),
        input_schema=CODE_EXEC_TOOL_SCHEMA,
        handler=code_exec_handler,
    )


# ── Built-in demo tools (stubs) ───────────────────────────────────────────────
# Kept only for use by test_mcp_server.py which tests the registry/server
# wiring in isolation without needing real implementations.


def _register_builtin_stubs(registry: ToolRegistry) -> None:
    """Register placeholder stubs so the server isn't completely empty."""

    async def _stub(args: dict[str, Any]) -> list[types.TextContent]:
        return [
            types.TextContent(
                type="text",
                text=json.dumps(
                    {
                        "error": "not_implemented",
                        "message": "This tool is a stub and not yet implemented",
                    }
                ),
            )
        ]

    registry.register(
        name="db_query",
        description="Execute a read-only SQL query against the configured database.",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "SQL SELECT statement"},
                "params": {
                    "type": "array",
                    "items": {},
                    "description": "Positional query parameters",
                },
            },
            "required": ["query"],
        },
        handler=_stub,
    )

    registry.register(
        name="web_fetch",
        description="Fetch the content of a URL and return it as text.",
        input_schema={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to fetch"},
                "headers": {"type": "object", "description": "Optional HTTP headers"},
            },
            "required": ["url"],
        },
        handler=_stub,
    )

    registry.register(
        name="file_ops",
        description="Read, write, or list files inside the sandboxed workspace.",
        input_schema={
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["read", "write", "list"],
                    "description": "File operation to perform",
                },
                "path": {"type": "string", "description": "Relative file path"},
                "content": {
                    "type": "string",
                    "description": "Content to write (only for 'write')",
                },
            },
            "required": ["operation", "path"],
        },
        handler=_stub,
    )

    registry.register(
        name="code_exec",
        description="Execute a sandboxed Python snippet and return stdout/stderr.",
        input_schema={
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python source to execute"},
                "timeout": {
                    "type": "integer",
                    "description": "Max execution time in seconds",
                    "default": 10,
                },
            },
            "required": ["code"],
        },
        handler=_stub,
    )


# ── Entry point ───────────────────────────────────────────────────────────────


async def main() -> None:
    logger.info("Isolyth server starting")
    server, registry = build_server()
    _register_real_tools(registry)
    logger.info(
        "Tools loaded",
        extra={"extra": {"count": len(registry)}},
    )

    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())

