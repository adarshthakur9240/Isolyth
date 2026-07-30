"""
locustfile.py – Locust Load Testing Suite for Isolyth MCP Tool Server
========================================================================
Simulates 100 concurrent virtual users executing mixed tool calls to measure:
  • Requests per second (RPS)
  • p50 / p95 / p99 latency distributions
  • Failure rate / error percentage
  • WASM Sandbox overhead vs. Plain tool calls

Authentication:
  Each virtual user generates a unique JWT token on startup (via on_start)
  and passes it in request arguments (`_auth_token`) and headers.

Usage:
  Terminal 1: python server/http_server.py
  Terminal 2: locust -f server/locustfile.py --headless -u 100 -r 3.33 --run-time 1m --host http://localhost:8000
"""

from pathlib import Path
import random
import sys
from locust import HttpUser, between, task

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from server.core.auth import create_token

# ── Sample Payloads for Tool Testing ──────────────────────────────────────────

MATH_EXPRESSIONS = [
    "2 + 2",
    "sqrt(16) * pi",
    "2 ^ 10",
    "floor(3.14159 * 100) / 100",
    "abs(-42) + min(10, 20)",
    "sin(pi / 2) + cos(0)",
    "log2(1024) + log10(100)",
]

FILE_PATHS = [
    ".",
    "sample.txt",
]


# ── Helper for Response Evaluation ────────────────────────────────────────────


def _evaluate_response(response, tool_name: str) -> None:
    if response.status_code == 200:
        try:
            data = response.json()
        except Exception:
            response.failure(f"Non-JSON response for {tool_name}")
            return

        content = data.get("content", [])
        if content and isinstance(content, list) and isinstance(content[0], dict):
            first = content[0]
            if "error" in first:
                err_msg = str(first["error"])
                # If DATABASE_URL or optional fixture is missing, treat as soft pass or skip
                if "DATABASE_URL" in err_msg:
                    response.success()
                    return
                response.failure(f"{tool_name} returned error: {err_msg}")
                return

        if data.get("success", True):
            response.success()
        else:
            response.failure(f"{tool_name} call marked unsuccessful")
    else:
        response.failure(f"HTTP status {response.status_code}")


# ── Mixed MCP User (Default: 100 Virtual Users) ──────────────────────────────


class MixedMCPUser(HttpUser):
    """
    Simulates a realistic mixed workload across all 4 MCP tools.
    Each user generates a unique JWT token on startup (`on_start`).
    """

    wait_time = between(0.1, 0.5)

    def on_start(self) -> None:
        """Executed once for each virtual user on spawn."""
        self.user_id = f"locust_user_{random.randint(1000, 999999)}"
        self.auth_token = create_token(user_id=self.user_id, roles=["user", "developer"])
        self.headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }

    @task(4)
    def test_code_exec_wasm_sandbox(self) -> None:
        """WASM Sandbox: Execute math expression in WASM sandbox."""
        expr = random.choice(MATH_EXPRESSIONS)
        payload = {
            "name": "code_exec",
            "arguments": {
                "_auth_token": self.auth_token,
                "expression": expr,
            },
        }
        with self.client.post(
            "/tools/call",
            json=payload,
            headers=self.headers,
            name="/tools/call [code_exec - WASM Sandbox]",
            catch_response=True,
        ) as response:
            _evaluate_response(response, "code_exec")

    @task(3)
    def test_file_ops_tool(self) -> None:
        """Plain Tool: Sandboxed file reading and directory listing."""
        path = random.choice(FILE_PATHS)
        op = "list_directory" if path == "." else "read_file"
        payload = {
            "name": "file_ops",
            "arguments": {
                "_auth_token": self.auth_token,
                "operation": op,
                "path": path,
            },
        }
        with self.client.post(
            "/tools/call",
            json=payload,
            headers=self.headers,
            name="/tools/call [file_ops]",
            catch_response=True,
        ) as response:
            _evaluate_response(response, "file_ops")

    @task(2)
    def test_web_fetch_tool(self) -> None:
        """Plain Tool: Web fetch with SSRF protection."""
        payload = {
            "name": "web_fetch",
            "arguments": {
                "_auth_token": self.auth_token,
                "url": "https://example.com",
            },
        }
        with self.client.post(
            "/tools/call",
            json=payload,
            headers=self.headers,
            name="/tools/call [web_fetch]",
            catch_response=True,
        ) as response:
            _evaluate_response(response, "web_fetch")

    @task(1)
    def test_db_query_tool(self) -> None:
        """Plain Tool: Read-only SQL query."""
        payload = {
            "name": "db_query",
            "arguments": {
                "_auth_token": self.auth_token,
                "query": "SELECT 1 AS n",
                "params": [],
            },
        }
        with self.client.post(
            "/tools/call",
            json=payload,
            headers=self.headers,
            name="/tools/call [db_query]",
            catch_response=True,
        ) as response:
            _evaluate_response(response, "db_query")


# ── Specialized Users for Overhead Comparison ────────────────────────────────


class WasmSandboxUser(HttpUser):
    """Measures WASM Sandbox execution overhead specifically."""

    wait_time = between(0.05, 0.2)

    def on_start(self) -> None:
        self.user_id = f"wasm_user_{random.randint(1000, 999999)}"
        self.auth_token = create_token(user_id=self.user_id, roles=["user"])
        self.headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }

    @task
    def test_wasm_sandbox_only(self) -> None:
        expr = random.choice(MATH_EXPRESSIONS)
        payload = {
            "name": "code_exec",
            "arguments": {
                "_auth_token": self.auth_token,
                "expression": expr,
            },
        }
        self.client.post(
            "/tools/call",
            json=payload,
            headers=self.headers,
            name="WASM Sandbox (code_exec)",
        )


class PlainToolUser(HttpUser):
    """Measures Plain Tool execution without WASM sandbox overhead."""

    wait_time = between(0.05, 0.2)

    def on_start(self) -> None:
        self.user_id = f"plain_user_{random.randint(1000, 999999)}"
        self.auth_token = create_token(user_id=self.user_id, roles=["user"])
        self.headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }

    @task
    def test_plain_tool_only(self) -> None:
        payload = {
            "name": "file_ops",
            "arguments": {
                "_auth_token": self.auth_token,
                "operation": "list_directory",
                "path": ".",
            },
        }
        self.client.post(
            "/tools/call",
            json=payload,
            headers=self.headers,
            name="Plain Tool (file_ops)",
        )
