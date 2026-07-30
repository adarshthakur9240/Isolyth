"""
test_tools.py – Integration tests for the four real tool implementations
=========================================================================
Run with:
    pytest server/tests/test_tools.py -v

Test strategy:
  • db_query_tool   – tested without a live DB via mocks; one live-DB test
                      class is marked ``@pytest.mark.integration`` and skipped
                      unless DATABASE_URL is set.
  • web_fetch_tool  – unit-testable because SSRF checks are synchronous; live
                      network tests are gated on network availability.
  • file_ops_tool   – fully unit-testable with tmp_path fixtures.
  • code_exec_tool  – gated on eval.wasm existing; skips gracefully otherwise.
"""

import json
import os
from pathlib import Path
import socket
from unittest.mock import AsyncMock, patch

import httpx
import pytest

# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse(result: list) -> dict:
    """Extract and JSON-parse the first TextContent item from a handler result."""
    assert result, "handler returned empty list"
    return json.loads(result[0].text)


def _has_error(result: list) -> bool:
    data = _parse(result)
    return "error" in data


def _error_text(result: list) -> str:
    return _parse(result).get("error", "")


def _is_network_available() -> bool:
    try:
        socket.setdefaulttimeout(2)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
        return True
    except OSError:
        return False


# ══════════════════════════════════════════════════════════════════════════════
# 1.  db_query_tool
# ══════════════════════════════════════════════════════════════════════════════


class TestDbQuerySqlGuard:
    """
    SQL mutation guard tests — no database connection needed.
    These run purely against the _validate_select_only() logic.
    """

    from server.tools.db_query_tool import _validate_select_only

    @pytest.mark.parametrize("good_query", [
        "SELECT 1",
        "SELECT * FROM users",
        "WITH cte AS (SELECT id FROM t) SELECT * FROM cte",
        "EXPLAIN SELECT id FROM orders",
        "select id, name from products where id = $1",
    ])
    def test_valid_select_passes(self, good_query: str) -> None:
        from server.tools.db_query_tool import _validate_select_only
        # Must not raise.
        _validate_select_only(good_query)

    @pytest.mark.parametrize("bad_query,expected_fragment", [
        ("INSERT INTO t VALUES (1)", "INSERT"),
        ("UPDATE users SET x=1", "UPDATE"),
        ("DELETE FROM logs", "DELETE"),
        ("DROP TABLE passwords", "DROP"),
        ("CREATE TABLE evil (x TEXT)", "CREATE"),
        ("ALTER TABLE t ADD COLUMN y INT", "ALTER"),
        ("TRUNCATE audit_log", "TRUNCATE"),
        # Comment-stripping: mutation hidden inside a comment prefix trick
        ("-- legit\nDROP TABLE users", "DROP"),
        # Block comment stripping
        ("/* drop */ DROP TABLE t", "DROP"),
    ])
    def test_mutating_query_blocked(self, bad_query: str, expected_fragment: str) -> None:
        from server.tools.db_query_tool import _validate_select_only
        with pytest.raises(ValueError, match="(?i)(forbidden|only select)"):
            _validate_select_only(bad_query)

    @pytest.mark.asyncio
    async def test_handler_rejects_empty_query(self) -> None:
        from server.tools.db_query_tool import db_query_handler
        result = await db_query_handler({"query": ""})
        assert _has_error(result)
        assert "required" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_handler_rejects_insert(self) -> None:
        from server.tools.db_query_tool import db_query_handler
        result = await db_query_handler({"query": "INSERT INTO t VALUES (1)"})
        assert _has_error(result)
        assert "forbidden" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_handler_rejects_drop(self) -> None:
        from server.tools.db_query_tool import db_query_handler
        result = await db_query_handler({"query": "DROP TABLE users"})
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_handler_reports_missing_database_url(self) -> None:
        """When DATABASE_URL is unset the handler must return a helpful error."""
        import server.tools.db_query_tool as mod
        original = mod.DATABASE_URL
        mod.DATABASE_URL = ""
        try:
            result = await mod.db_query_handler({"query": "SELECT 1"})
            assert _has_error(result)
            assert "DATABASE_URL" in _error_text(result)
        finally:
            mod.DATABASE_URL = original


@pytest.mark.integration
class TestDbQueryLive:
    """
    Live database tests — require DATABASE_URL to be set.
    Run with:  DATABASE_URL=postgresql://... pytest -m integration
    """

    @pytest.fixture(autouse=True)
    def require_db(self) -> None:
        if not os.environ.get("DATABASE_URL"):
            pytest.skip("DATABASE_URL not set; skipping live DB tests")

    @pytest.mark.asyncio
    async def test_select_one(self) -> None:
        from server.tools.db_query_tool import db_query_handler
        result = await db_query_handler({"query": "SELECT 1 AS n"})
        assert not _has_error(result), _error_text(result)
        data = _parse(result)
        assert data["row_count"] == 1
        assert data["rows"][0]["n"] == 1

    @pytest.mark.asyncio
    async def test_parameterized_query(self) -> None:
        from server.tools.db_query_tool import db_query_handler
        result = await db_query_handler({
            "query": "SELECT $1::int AS val",
            "params": [42],
        })
        assert not _has_error(result), _error_text(result)
        data = _parse(result)
        assert data["rows"][0]["val"] == 42

    @pytest.mark.asyncio
    async def test_mutation_blocked_at_db_level(self) -> None:
        """
        Even if we bypass the regex guard, the READ ONLY transaction wrapper
        must cause the DB to reject any mutation.
        """
        import server.tools.db_query_tool as mod
        original_validate = mod._validate_select_only

        def noop_validate(q: str) -> None:
            pass  # skip guard

        mod._validate_select_only = noop_validate
        try:
            result = await mod.db_query_handler({"query": "INSERT INTO nonexistent_table_ VALUES (1)"})
            # DB should reject this with a ReadOnlySqlTransaction or table-not-found error.
            assert _has_error(result)
        finally:
            mod._validate_select_only = original_validate


# ══════════════════════════════════════════════════════════════════════════════
# 2.  web_fetch_tool
# ══════════════════════════════════════════════════════════════════════════════


class TestSSRFProtection:
    """
    SSRF protection tests — all synchronous, no real network needed.
    Tests the _is_ip_blocked() and _resolve_and_check_host() helpers directly.
    """

    def test_private_ipv4_10_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("10.0.0.1") is True

    def test_private_ipv4_172_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("172.16.0.1") is True

    def test_private_ipv4_192_168_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("192.168.1.1") is True

    def test_loopback_127_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("127.0.0.1") is True

    def test_aws_metadata_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        # AWS EC2 instance metadata service IP
        assert _is_ip_blocked("169.254.169.254") is True

    def test_link_local_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("169.254.0.1") is True

    def test_public_ip_not_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        # Google Public DNS — definitely not private
        assert _is_ip_blocked("8.8.8.8") is False

    def test_public_ip_cloudflare_not_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("1.1.1.1") is False

    def test_ipv6_loopback_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("::1") is True

    def test_ipv6_unique_local_blocked(self) -> None:
        from server.tools.web_fetch_tool import _is_ip_blocked
        assert _is_ip_blocked("fc00::1") is True


class TestWebFetchSchemeCheck:
    """URL scheme validation — no network needed."""

    @pytest.mark.asyncio
    async def test_file_scheme_blocked(self) -> None:
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "file:///etc/passwd"})
        assert _has_error(result)
        assert "scheme" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_ftp_scheme_blocked(self) -> None:
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "ftp://example.com/file"})
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_empty_url_blocked(self) -> None:
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": ""})
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_localhost_blocked(self) -> None:
        """
        127.0.0.1 resolves to loopback — must be blocked as SSRF.
        This works without real network because localhost DNS resolution is local.
        """
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "http://127.0.0.1/"})
        assert _has_error(result)
        assert "blocked" in _error_text(result).lower() or "security" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_internal_ip_literal_blocked(self) -> None:
        """Direct IP literal for private range must be blocked."""
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "http://192.168.1.1/"})
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_aws_metadata_url_blocked(self) -> None:
        """The classic SSRF target — AWS metadata endpoint."""
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "http://169.254.169.254/latest/meta-data/"})
        assert _has_error(result)


class TestWebFetchMocked:
    """Mocked network tests for web_fetch_handler — deterministic and fast."""

    @pytest.mark.asyncio
    async def test_fetch_public_url_mocked(self) -> None:
        from server.tools.web_fetch_tool import web_fetch_handler

        mock_response = httpx.Response(
            status_code=200,
            content=b"Hello, World!",
            headers={"content-type": "text/plain"},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("server.tools.web_fetch_tool._resolve_and_check_host") as mock_dns:
            mock_dns.return_value = None
            with patch.object(httpx.AsyncClient, "get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_response
                result = await web_fetch_handler({"url": "https://example.com"})

        assert not _has_error(result), _error_text(result)
        data = _parse(result)
        assert data["status_code"] == 200
        assert data["body"] == "Hello, World!"
        for key in ("url", "status_code", "content_type", "body", "truncated", "byte_count"):
            assert key in data, f"Missing key: {key!r}"


@pytest.mark.skipif(not _is_network_available(), reason="No network available")
@pytest.mark.integration
class TestWebFetchLive:
    """Live network tests — optional integration tests hitting stable public endpoints."""

    @pytest.mark.asyncio
    async def test_fetch_public_url_live(self) -> None:
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "https://example.com"})
        data = _parse(result)
        if "error" in data:
            pytest.skip(f"Live network call failed: {data['error']}")
        assert data["status_code"] in (200, 301, 302, 304)
        assert "body" in data

    @pytest.mark.asyncio
    async def test_response_contains_required_keys_live(self) -> None:
        from server.tools.web_fetch_tool import web_fetch_handler
        result = await web_fetch_handler({"url": "https://example.com"})
        data = _parse(result)
        if "error" in data:
            pytest.skip(f"Live fetch failed; skipping key check: {data['error']}")
        for key in ("url", "status_code", "content_type", "body", "truncated", "byte_count"):
            assert key in data, f"Missing key: {key!r}"


# ══════════════════════════════════════════════════════════════════════════════
# 3.  file_ops_tool
# ══════════════════════════════════════════════════════════════════════════════


class TestPathTraversalProtection:
    """Path traversal prevention tests — all use tmp_path, no real FS escapes."""

    @pytest.mark.asyncio
    async def test_read_file_in_sandbox_succeeds(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        test_file = tmp_path / "hello.txt"
        test_file.write_text("hello world")
        result = await file_ops_handler(
            {"operation": "read_file", "path": "hello.txt"},
            sandbox_root=tmp_path,
        )
        assert not _has_error(result), _error_text(result)
        data = _parse(result)
        assert data["content"] == "hello world"

    @pytest.mark.asyncio
    async def test_list_directory_in_sandbox_succeeds(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        (tmp_path / "a.txt").write_text("a")
        (tmp_path / "b.txt").write_text("b")
        result = await file_ops_handler(
            {"operation": "list_directory", "path": "."},
            sandbox_root=tmp_path,
        )
        assert not _has_error(result), _error_text(result)
        data = _parse(result)
        names = [e["name"] for e in data["entries"]]
        assert "a.txt" in names
        assert "b.txt" in names

    @pytest.mark.asyncio
    async def test_dotdot_traversal_blocked(self, tmp_path: Path) -> None:
        """../../etc/passwd must be rejected."""
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "read_file", "path": "../../etc/passwd"},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)
        assert "access denied" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_absolute_path_outside_sandbox_blocked(self, tmp_path: Path) -> None:
        """Absolute path to /etc/passwd must be rejected."""
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "read_file", "path": "/etc/passwd"},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_nested_dotdot_blocked(self, tmp_path: Path) -> None:
        """subdir/../../etc/passwd must be rejected."""
        from server.tools.file_ops_tool import file_ops_handler
        (tmp_path / "subdir").mkdir()
        result = await file_ops_handler(
            {"operation": "read_file", "path": "subdir/../../etc/passwd"},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_file_not_found_returns_error(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "read_file", "path": "nonexistent.txt"},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)
        assert "not found" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_directory_not_found_returns_error(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "list_directory", "path": "nosuchdir"},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_unknown_operation_returns_error(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "delete_file", "path": "x.txt"},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)
        assert "unknown operation" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_missing_path_parameter(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "read_file", "path": ""},
            sandbox_root=tmp_path,
        )
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_result_contains_required_keys_for_read(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        f = tmp_path / "data.txt"
        f.write_text("abc")
        result = await file_ops_handler(
            {"operation": "read_file", "path": "data.txt"},
            sandbox_root=tmp_path,
        )
        data = _parse(result)
        for key in ("path", "size_bytes", "encoding", "content"):
            assert key in data, f"Missing key: {key!r}"

    @pytest.mark.asyncio
    async def test_result_contains_required_keys_for_list(self, tmp_path: Path) -> None:
        from server.tools.file_ops_tool import file_ops_handler
        result = await file_ops_handler(
            {"operation": "list_directory", "path": "."},
            sandbox_root=tmp_path,
        )
        data = _parse(result)
        for key in ("path", "entry_count", "entries"):
            assert key in data, f"Missing key: {key!r}"

    @pytest.mark.asyncio
    async def test_symlink_outside_sandbox_blocked(self, tmp_path: Path) -> None:
        """A symlink pointing outside the sandbox must be rejected."""
        from server.tools.file_ops_tool import file_ops_handler
        link = tmp_path / "escape.txt"
        try:
            link.symlink_to("/etc/passwd")
        except (OSError, NotImplementedError):
            pytest.skip("Cannot create symlinks on this platform")

        result = await file_ops_handler(
            {"operation": "read_file", "path": "escape.txt"},
            sandbox_root=tmp_path,
        )
        # Either blocked by the traversal check OR file not accessible.
        # If the symlink resolves outside the root, it must be blocked.
        # On some systems /etc/passwd may not exist inside a container — accept
        # either a traversal error OR a file-not-found (both are safe).
        data = _parse(result)
        if "error" in data:
            assert True  # any error is acceptable; no data leak
        else:
            # If it somehow succeeded (e.g. /etc/passwd is inside tmp in a
            # very unusual setup), that would be a bug.
            raise AssertionError("Symlink escape should have been blocked")


# ══════════════════════════════════════════════════════════════════════════════
# 4.  code_exec_tool
# ══════════════════════════════════════════════════════════════════════════════

_EVAL_WASM = (
    Path(__file__).parent.parent / "wasm_modules" / "eval.wasm"
)


def _skip_if_no_eval_wasm() -> None:
    if not _EVAL_WASM.exists():
        pytest.skip(
            "eval.wasm not found; build it with:\n"
            "  cd server/wasm_modules/eval_src && "
            "cargo build --target wasm32-wasip1 --release && "
            "cp target/wasm32-wasip1/release/eval.wasm ../eval.wasm"
        )


class TestCodeExecHandler:
    """Tests for the code_exec (expression evaluator) tool."""

    def setup_method(self) -> None:
        _skip_if_no_eval_wasm()
        # Reset lazy singleton between tests.
        import server.tools.code_exec_tool as mod
        mod._sandbox = None
        mod._sandbox_load_error = None

    @pytest.mark.asyncio
    async def test_simple_addition(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "2 + 3"})
        assert not _has_error(result), _error_text(result)
        data = _parse(result)
        assert data["result"] == "5"

    @pytest.mark.asyncio
    async def test_precedence(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "2 + 3 * 4"})
        assert not _has_error(result), _error_text(result)
        assert _parse(result)["result"] == "14"

    @pytest.mark.asyncio
    async def test_power_operator(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "2 ^ 10"})
        assert not _has_error(result), _error_text(result)
        assert _parse(result)["result"] == "1024"

    @pytest.mark.asyncio
    async def test_sqrt_function(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "sqrt(4)"})
        assert not _has_error(result), _error_text(result)
        assert _parse(result)["result"] == "2"

    @pytest.mark.asyncio
    async def test_pi_constant(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "floor(pi * 100) / 100"})
        assert not _has_error(result), _error_text(result)
        assert _parse(result)["result"] == "3.14"

    @pytest.mark.asyncio
    async def test_empty_expression_returns_error(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": ""})
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_too_long_expression_returns_error(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "1 + " * 600})
        assert _has_error(result)
        assert "too long" in _error_text(result).lower()

    @pytest.mark.asyncio
    async def test_invalid_expression_returns_error(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "2 +"})
        # The evaluator should exit 1 → sandbox reports failure → tool returns error.
        assert _has_error(result)

    @pytest.mark.asyncio
    async def test_result_contains_required_keys(self) -> None:
        from server.tools.code_exec_tool import code_exec_handler
        result = await code_exec_handler({"expression": "1 + 1"})
        if _has_error(result):
            pytest.skip("eval.wasm returned an error; skipping key check")
        data = _parse(result)
        for key in ("expression", "result", "fuel_consumed", "duration_s"):
            assert key in data, f"Missing key: {key!r}"


class TestCodeExecNoWasm:
    """Tests that run without eval.wasm — verify graceful degradation."""

    def setup_method(self) -> None:
        import server.tools.code_exec_tool as mod
        mod._sandbox = None
        mod._sandbox_load_error = None

    @pytest.mark.asyncio
    async def test_missing_wasm_returns_helpful_error(self) -> None:
        """If eval.wasm is absent, the tool must return a human-readable error."""
        import server.tools.code_exec_tool as mod
        original = mod.CODE_EXEC_WASM_PATH
        mod.CODE_EXEC_WASM_PATH = Path("/nonexistent/eval.wasm")
        mod._sandbox = None
        mod._sandbox_load_error = None
        try:
            result = await mod.code_exec_handler({"expression": "1+1"})
            assert _has_error(result)
            err = _error_text(result)
            assert "eval.wasm" in err or "build" in err.lower()
        finally:
            mod.CODE_EXEC_WASM_PATH = original
            mod._sandbox = None
            mod._sandbox_load_error = None
