"""
http_server.py – HTTP Bridge Server for Isolyth MCP Tool Server
================================================================
Exposes the MCP Tool Server over HTTP (FastAPI) for load testing with Locust,
external API integration, and Prometheus metrics scraping.

Endpoints:
  POST /tools/call  – Invoke a tool by name with arguments and optional JWT bearer token.
  GET  /metrics     – Prometheus metrics endpoint.
  GET  /health      – Health check endpoint.

Usage:
  python server/http_server.py
  or
  uvicorn server.http_server:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from server.core.auth import generate_dev_token
from server.core.mcp_server import build_server, _register_real_tools
from server.core.telemetry import get_prometheus_metrics

logger = logging.getLogger("isolyth.http")

# Build the MCP server instance & register real tools
server, registry = build_server(require_auth=True)
_register_real_tools(registry)

# Create FastAPI application
app = FastAPI(
    title="Isolyth MCP Tool Server",
    description="High-performance HTTP API for sandboxed WASM tools and MCP server execution.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ─────────────────────────────────────────────────


class DevTokenResponse(BaseModel):
    token: str = Field(..., description="JWT bearer token")
    type: str = Field(default="Bearer", description="Token type")
    expires_in: int = Field(..., description="Token lifetime in seconds")


class ToolCallRequest(BaseModel):
    name: str = Field(..., description="Name of tool to call (e.g. 'code_exec', 'file_ops')")
    arguments: dict[str, Any] = Field(default_factory=dict, description="Tool arguments object")


# ── Endpoints ─────────────────────────────────────────────────────────────────


DEV_MODE: bool = os.environ.get("DEV_MODE", "true").lower() in ("true", "1", "yes")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "isolyth-mcp-server"}


@app.get("/auth/dev-token", response_model=DevTokenResponse)
async def dev_token_endpoint() -> dict[str, Any]:
    """
    Generate a 24-hour JWT bearer token for local development and dashboard debugging.

    SECURITY NOTE FOR PRODUCTION:
    This endpoint is intended for local dev/testing only. In production, this endpoint
    MUST be disabled by setting environment variable `DEV_MODE=false`, or protected behind
    an admin authentication check.
    """
    if not DEV_MODE:
        raise HTTPException(
            status_code=403,
            detail="Dev token generation is disabled in production environments (DEV_MODE=false)."
        )
    return {"token": generate_dev_token(), "type": "Bearer", "expires_in": 86400}



@app.get("/metrics")
async def prometheus_metrics() -> Response:
    metrics_text = get_prometheus_metrics()
    return Response(content=metrics_text, media_type="text/plain; version=0.0.4")


from mcp.types import CallToolRequest, CallToolRequestParams


@app.post("/tools/call")
async def call_tool_endpoint(
    request: ToolCallRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Invoke an MCP tool by name.
    Passes token via Authorization header or arguments dict.
    """
    handler = server.request_handlers.get(CallToolRequest)

    if handler is None:
        raise HTTPException(status_code=500, detail="CallTool handler not registered")

    args = dict(request.arguments)
    if authorization and "auth_token" not in args and "_auth_token" not in args:
        args["_auth_token"] = authorization

    mcp_request = CallToolRequest(
        method="tools/call",
        params=CallToolRequestParams(name=request.name, arguments=args),
    )

    try:
        server_result = await handler(mcp_request)
        result_root = server_result.root

        # Extract content
        contents = []
        for item in getattr(result_root, "content", []):
            if hasattr(item, "text"):
                try:
                    contents.append(json.loads(item.text))
                except Exception:
                    contents.append(item.text)

        return {
            "success": not getattr(result_root, "isError", False),
            "tool": request.name,
            "content": contents,
        }
    except Exception as exc:
        logger.exception("HTTP tool call failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    logger.info("Starting Isolyth HTTP server on port %d", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
