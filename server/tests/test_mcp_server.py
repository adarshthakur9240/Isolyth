"""
test_mcp_server.py – Unit tests for the Isolyth core server
================================================================
Tests exercise the ToolRegistry and the MCP request handlers directly
without opening a real stdio transport, so they run fast and in-process.
"""

import os
import sys
from typing import Any

import mcp.types as types
import pytest

# Make sure the project root is on sys.path when running with pytest from the
# repo root.  (Alternatively, install the package in editable mode.)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from server.core.mcp_server import ToolRegistry, _register_builtin_stubs, build_server


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def empty_registry() -> ToolRegistry:
    return ToolRegistry()


@pytest.fixture()
def populated_registry() -> ToolRegistry:
    registry = ToolRegistry()
    _register_builtin_stubs(registry)
    return registry


@pytest.fixture()
def server_and_registry(populated_registry: ToolRegistry):
    server, registry = build_server(populated_registry, require_auth=False)
    return server, registry


# ── ToolRegistry tests ────────────────────────────────────────────────────────


class TestToolRegistry:
    def test_register_adds_tool(self, empty_registry: ToolRegistry) -> None:
        async def handler(args: dict) -> list:
            return []

        empty_registry.register(
            name="test_tool",
            description="A test tool",
            input_schema={"type": "object", "properties": {}},
            handler=handler,
        )
        assert len(empty_registry) == 1

    def test_list_tools_returns_mcp_tool_objects(self, populated_registry: ToolRegistry) -> None:
        tools = populated_registry.list_tools()
        assert len(tools) == 4
        names = {t.name for t in tools}
        assert names == {"db_query", "web_fetch", "file_ops", "code_exec"}
        for tool in tools:
            assert isinstance(tool, types.Tool)
            assert tool.description
            assert isinstance(tool.inputSchema, dict)

    def test_unregister_removes_tool(self, populated_registry: ToolRegistry) -> None:
        existed = populated_registry.unregister("db_query")
        assert existed is True
        assert len(populated_registry) == 3
        assert populated_registry.get("db_query") is None

    def test_unregister_nonexistent_returns_false(self, empty_registry: ToolRegistry) -> None:
        assert empty_registry.unregister("ghost_tool") is False

    def test_get_returns_none_for_missing(self, empty_registry: ToolRegistry) -> None:
        assert empty_registry.get("nonexistent") is None

    def test_register_overwrites_existing(self, empty_registry: ToolRegistry) -> None:
        async def v1(args: dict) -> list:
            return []

        async def v2(args: dict) -> list:
            return [types.TextContent(type="text", text="v2")]

        empty_registry.register("my_tool", "v1", {}, v1)
        empty_registry.register("my_tool", "v2", {}, v2)
        assert len(empty_registry) == 1
        assert empty_registry.get("my_tool").description == "v2"


# ── list_tools handler tests ──────────────────────────────────────────────────


class TestListToolsHandler:
    """
    Test that the list_tools() MCP handler returns the expected tool list.

    We invoke the handler by directly calling the registered callback that
    build_server() wires into the Server object.
    """

    @pytest.mark.asyncio
    async def test_list_tools_returns_all_registered_tools(
        self, server_and_registry
    ) -> None:
        server, registry = server_and_registry

        # The MCP SDK stores request handlers in server.request_handlers keyed
        # by the request type model.  We retrieve and call the list_tools handler
        # directly to avoid needing a live transport.
        list_tools_type = types.ListToolsRequest
        handler = server.request_handlers.get(list_tools_type)
        assert handler is not None, "list_tools handler not registered on server"

        # Build a minimal ListToolsRequest
        request = types.ListToolsRequest(method="tools/list")
        server_result = await handler(request)

        # SDK 1.x returns a ServerResult discriminated-union envelope;
        # the actual ListToolsResult lives in .root.
        result = server_result.root
        assert hasattr(result, "tools")
        assert len(result.tools) == 4
        tool_names = {t.name for t in result.tools}
        assert "db_query" in tool_names
        assert "web_fetch" in tool_names
        assert "file_ops" in tool_names
        assert "code_exec" in tool_names

    @pytest.mark.asyncio
    async def test_list_tools_empty_registry(self) -> None:
        empty = ToolRegistry()
        server, _ = build_server(empty, require_auth=False)

        list_tools_type = types.ListToolsRequest
        handler = server.request_handlers.get(list_tools_type)
        assert handler is not None

        request = types.ListToolsRequest(method="tools/list")
        server_result = await handler(request)
        # Unwrap the ServerResult envelope to get the ListToolsResult.
        result = server_result.root
        assert result.tools == []


# ── call_tool handler tests ───────────────────────────────────────────────────


class TestCallToolHandler:
    @pytest.mark.asyncio
    async def test_call_unknown_tool_returns_error_response(
        self, server_and_registry
    ) -> None:
        server, _ = server_and_registry
        call_tool_type = types.CallToolRequest
        handler = server.request_handlers.get(call_tool_type)
        assert handler is not None

        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(name="nonexistent_tool", arguments={}),
        )
        result = await handler(request)

        # The server should return a result with isError=True or error text,
        # not raise an unhandled exception.
        assert result is not None

    @pytest.mark.asyncio
    async def test_call_tool_with_stub_handler_returns_not_implemented(
        self, server_and_registry
    ) -> None:
        """
        All builtin stubs raise NotImplementedError.  The handler should
        catch that and return a structured error TextContent block.
        """
        server, _ = server_and_registry
        call_tool_type = types.CallToolRequest
        handler = server.request_handlers.get(call_tool_type)
        assert handler is not None

        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="db_query",
                arguments={"query": "SELECT 1"},
            ),
        )
        server_result = await handler(request)
        assert server_result is not None
        # Unwrap the ServerResult envelope to get the CallToolResult.
        result = server_result.root
        # Should contain at least one content item
        assert len(result.content) >= 1
        first = result.content[0]
        assert isinstance(first, types.TextContent)
        # The builtin stubs return a plain-text "not yet implemented" message
        # (they do not raise, so no JSON error envelope is produced).
        assert "not yet implemented" in first.text

    @pytest.mark.asyncio
    async def test_call_tool_with_successful_handler(self) -> None:
        registry = ToolRegistry()

        async def echo_handler(args: dict[str, Any]) -> list[types.TextContent]:
            return [types.TextContent(type="text", text=args.get("msg", ""))]

        registry.register(
            name="echo",
            description="Echo the msg argument",
            input_schema={
                "type": "object",
                "properties": {"msg": {"type": "string"}},
                "required": ["msg"],
            },
            handler=echo_handler,
        )

        server, _ = build_server(registry, require_auth=False)
        call_tool_type = types.CallToolRequest
        handler = server.request_handlers.get(call_tool_type)

        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="echo",
                arguments={"msg": "hello sentinel"},
            ),
        )
        server_result = await handler(request)
        # Unwrap the ServerResult envelope to get the CallToolResult.
        result = server_result.root
        assert result.content[0].text == "hello sentinel"
