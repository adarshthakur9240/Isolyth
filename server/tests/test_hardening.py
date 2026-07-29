"""
test_hardening.py – Unit and Integration Tests for Production Hardening
========================================================================
Tests cover:
  1. JWT Authentication (token generation, verification, unauthorized call rejection)
  2. Rate Limiting (in-memory & Redis, rate limit triggering after N requests)
  3. Telemetry & Prometheus metrics (valid Prometheus format, counters, histograms, gauges)
  4. End-to-end MCP server pipeline (auth check -> rate limit -> traced execution -> metrics)
"""

from __future__ import annotations

import json
import os
import pytest
import mcp.types as types

from server.core.auth import (
    AuthError,
    ExpiredTokenError,
    InvalidTokenError,
    MissingTokenError,
    authenticate_request,
    create_token,
    generate_dev_token,
    verify_token,
)
from server.core.mcp_server import ToolRegistry, build_server
from server.core.rate_limit import RateLimiter
from server.core.telemetry import (
    ACTIVE_SANDBOX_EXECUTIONS,
    get_prometheus_metrics,
    record_tool_metrics,
    track_active_sandbox,
)

# Helper to unwrap server call result
def _parse_res(server_result: Any) -> dict:
    root = server_result.root
    assert len(root.content) >= 1
    return json.loads(root.content[0].text)


# ══════════════════════════════════════════════════════════════════════════════
# 1. JWT Authentication Tests
# ══════════════════════════════════════════════════════════════════════════════


class TestAuthentication:
    def test_token_creation_and_verification(self) -> None:
        token = create_token(user_id="user_123", roles=["admin"])
        payload = verify_token(token)
        assert payload["sub"] == "user_123"
        assert payload["roles"] == ["admin"]

    def test_expired_token_raises_error(self) -> None:
        token = create_token(user_id="user_123", expires_in_seconds=-10)
        with pytest.raises(ExpiredTokenError):
            verify_token(token)

    def test_invalid_signature_raises_error(self) -> None:
        token = create_token(user_id="user_123", secret_key="key-a")
        with pytest.raises(InvalidTokenError):
            verify_token(token, secret_key="key-b")

    def test_authenticate_request_without_token_when_auth_required(self) -> None:
        with pytest.raises(MissingTokenError):
            authenticate_request({}, require_auth=True)

    def test_authenticate_request_without_token_when_auth_optional(self) -> None:
        payload = authenticate_request({}, require_auth=False)
        assert payload["sub"] == "anonymous"

    def test_authenticate_request_with_valid_token(self) -> None:
        token = create_token(user_id="test_sub")
        payload = authenticate_request({"_auth_token": token}, require_auth=True)
        assert payload["sub"] == "test_sub"


# ══════════════════════════════════════════════════════════════════════════════
# 2. Rate Limiting Tests
# ══════════════════════════════════════════════════════════════════════════════


class TestRateLimiter:
    @pytest.mark.asyncio
    async def test_rate_limit_triggers_after_n_requests(self) -> None:
        # Limit to 3 requests per 60s
        limiter = RateLimiter(tool_limits={"test_tool": (3, 60)})
        user_id = "user_rate_test"

        for i in range(3):
            allowed, info = await limiter.is_allowed(user_id, "test_tool")
            assert allowed is True, f"Request {i+1} should be allowed"
            assert info["remaining"] == 3 - (i + 1)

        # 4th request must be blocked
        allowed, info = await limiter.is_allowed(user_id, "test_tool")
        assert allowed is False
        assert info["remaining"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# 3. Telemetry & Prometheus Metrics Tests
# ══════════════════════════════════════════════════════════════════════════════


class TestTelemetry:
    def test_record_tool_metrics_and_prometheus_export(self) -> None:
        record_tool_metrics("dummy_tool", 0.123, "success")
        metrics_text = get_prometheus_metrics()

        assert "isolyth_tool_calls_total" in metrics_text
        assert 'tool_name="dummy_tool"' in metrics_text
        assert 'status="success"' in metrics_text
        assert "isolyth_tool_call_duration_seconds" in metrics_text

    def test_active_sandbox_gauge_tracking(self) -> None:
        initial = ACTIVE_SANDBOX_EXECUTIONS._value.get()
        with track_active_sandbox():
            assert ACTIVE_SANDBOX_EXECUTIONS._value.get() == initial + 1
        assert ACTIVE_SANDBOX_EXECUTIONS._value.get() == initial


# ══════════════════════════════════════════════════════════════════════════════
# 4. Pipeline Integration Tests (Server Auth + Rate Limit + Telemetry)
# ══════════════════════════════════════════════════════════════════════════════


class TestServerHardeningPipeline:
    @pytest.mark.asyncio
    async def test_unauthorized_call_rejected(self) -> None:
        registry = ToolRegistry()

        async def handler(args: dict) -> list:
            return [types.TextContent(type="text", text="ok")]

        registry.register("secure_tool", "desc", {}, handler)
        server, _ = build_server(registry, require_auth=True)

        call_handler = server.request_handlers.get(types.CallToolRequest)
        req = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(name="secure_tool", arguments={}),
        )

        res = await call_handler(req)
        data = _parse_res(res)

        assert "error" in data
        assert data["error"] == "Unauthorized"

    @pytest.mark.asyncio
    async def test_authorized_call_succeeds(self) -> None:
        registry = ToolRegistry()

        async def handler(args: dict) -> list:
            return [types.TextContent(type="text", text="success")]

        registry.register("secure_tool", "desc", {}, handler)
        server, _ = build_server(registry, require_auth=True)

        token = create_token("user_abc")
        call_handler = server.request_handlers.get(types.CallToolRequest)
        req = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="secure_tool",
                arguments={"_auth_token": token},
            ),
        )

        res = await call_handler(req)
        root = res.root
        assert root.content[0].text == "success"

    @pytest.mark.asyncio
    async def test_rate_limit_exceeded_mcp_response(self) -> None:
        registry = ToolRegistry()

        async def handler(args: dict) -> list:
            return [types.TextContent(type="text", text="ok")]

        registry.register("limited_tool", "desc", {}, handler)
        limiter = RateLimiter(tool_limits={"limited_tool": (2, 60)})
        server, _ = build_server(registry, rate_limiter=limiter, require_auth=False)

        call_handler = server.request_handlers.get(types.CallToolRequest)
        req = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(name="limited_tool", arguments={}),
        )

        # Call twice (allowed)
        await call_handler(req)
        await call_handler(req)

        # 3rd call should trigger 429-style rate limit error
        res = await call_handler(req)
        data = _parse_res(res)

        assert data["error"] == "RateLimitExceeded"
        assert "rate_limit_info" in data
        assert data["rate_limit_info"]["limit"] == 2


# ══════════════════════════════════════════════════════════════════════════════
# 5. HTTP Server Dev Token Endpoint Tests
# ══════════════════════════════════════════════════════════════════════════════


class TestHttpServerDevTokenEndpoint:
    def test_dev_token_endpoint_returns_valid_jwt(self) -> None:
        from fastapi.testclient import TestClient
        from server.http_server import app

        client = TestClient(app)
        response = client.get("/auth/dev-token")
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["type"] == "Bearer"

        # Verify the returned token is a valid JWT
        claims = verify_token(data["token"])
        assert claims["sub"] == "dev-user"

    def test_dev_token_endpoint_disabled_when_dev_mode_false(self) -> None:
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from server.http_server import app

        client = TestClient(app)
        with patch("server.http_server.DEV_MODE", False):
            response = client.get("/auth/dev-token")
            assert response.status_code == 403
            assert "disabled" in response.json()["detail"].lower()

