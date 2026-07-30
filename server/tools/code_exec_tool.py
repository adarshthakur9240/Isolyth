"""
code_exec_tool – Code Execution Tool (via WASM Expression Evaluator)
=====================================================================
Evaluates a restricted arithmetic/math expression inside a WASM sandbox
and returns the numeric result.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Design Decision: Expression Evaluator, NOT a Python/JS Interpreter
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You might expect this tool to run arbitrary Python or JavaScript code inside
the WASM sandbox.  It intentionally does NOT, for the following reasons:

  1. WASM ≠ language runtime.
     Running Python or JS inside WASM requires embedding an *entire language
     runtime* (CPython compiled to WASM32, or QuickJS) inside the .wasm
     binary.  These runtimes are 5–30 MB, have their own attack surfaces,
     and make supply-chain auditing hard.

  2. The sandbox is still host-process-level.
     Our ``WasmSandbox`` enforces memory, fuel, and time limits at the
     wasmtime level, which is excellent — but the WASM module can still
     call arbitrary host functions that the Linker exposes.  A Python
     runtime compiled to WASM would import many system calls via WASI,
     giving it a much larger blast radius than a hand-rolled evaluator.

  3. Principle of Least Privilege.
     For an LLM-oriented tool server the most common "code" requests are
     arithmetic, unit conversion, and simple formula evaluation.  A safe
     single-purpose evaluator covers 90 % of that without the risk surface
     of a full interpreter.

  4. Future path.
     If arbitrary code execution is genuinely needed, the right approach is
     to run a full gVisor/firecracker microVM container and proxy requests
     to it — not to embed a language runtime inside a WASM module.  That is
     out of scope for this phase.

The evaluator (eval_src/src/main.rs) supports:
  • Integer and floating-point literals
  • Operators: + - * / ^ (power) % (modulo)
  • Parentheses for grouping
  • Built-in functions: abs, sqrt, floor, ceil, round, min, max
  • Constants: pi, e
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The evaluator WASM is built from:
    server/wasm_modules/eval_src/

Build command:
    cd server/wasm_modules/eval_src
    cargo build --target wasm32-wasip1 --release
    cp target/wasm32-wasip1/release/eval.wasm ../eval.wasm

Environment variables:
  CODE_EXEC_WASM_PATH  – path to eval.wasm (default: auto-discovered from
                         this file's location)
  CODE_EXEC_MAX_FUEL   – fuel budget (default: 10_000_000)
  CODE_EXEC_TIMEOUT_S  – wall-clock timeout in seconds (default: 3)
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

import mcp.types as types

from server.core.sandbox import SandboxInvalidModule, WasmSandbox, WasmSandboxConfig

logger = logging.getLogger("isolyth.tools.code_exec")

# ── Configuration ─────────────────────────────────────────────────────────────

# Default: eval.wasm sits next to factorial.wasm.
_TOOL_DIR = Path(__file__).parent
_DEFAULT_WASM_PATH = _TOOL_DIR.parent / "wasm_modules" / "eval.wasm"

CODE_EXEC_WASM_PATH: Path = Path(
    os.environ.get("CODE_EXEC_WASM_PATH", str(_DEFAULT_WASM_PATH))
)
CODE_EXEC_MAX_FUEL: int = int(os.environ.get("CODE_EXEC_MAX_FUEL", "10_000_000"))
CODE_EXEC_TIMEOUT_S: float = float(os.environ.get("CODE_EXEC_TIMEOUT_S", "3"))

# ── Lazy singleton sandbox ────────────────────────────────────────────────────
# WasmSandbox compilation is expensive; reuse the compiled module across calls.
_sandbox: WasmSandbox | None = None
_sandbox_load_error: str | None = None


def _get_sandbox() -> WasmSandbox:
    """Return the cached WasmSandbox, loading it once on first call."""
    global _sandbox, _sandbox_load_error

    if _sandbox_load_error:
        raise RuntimeError(_sandbox_load_error)

    if _sandbox is None:
        if not CODE_EXEC_WASM_PATH.exists():
            _sandbox_load_error = (
                f"eval.wasm not found at {CODE_EXEC_WASM_PATH}. "
                "Build it with: cd server/wasm_modules/eval_src && "
                "cargo build --target wasm32-wasip1 --release && "
                "cp target/wasm32-wasip1/release/eval.wasm ../eval.wasm"
            )
            raise RuntimeError(_sandbox_load_error)

        config = WasmSandboxConfig(
            max_fuel=CODE_EXEC_MAX_FUEL,
            timeout_seconds=CODE_EXEC_TIMEOUT_S,
            # 16 MB is plenty for a pure expression evaluator.
            max_memory_bytes=16 * 1024 * 1024,
        )
        try:
            _sandbox = WasmSandbox(CODE_EXEC_WASM_PATH, config)
        except SandboxInvalidModule as exc:
            _sandbox_load_error = f"Failed to load eval.wasm: {exc}"
            raise RuntimeError(_sandbox_load_error) from exc

    return _sandbox


# ── Tool handler ──────────────────────────────────────────────────────────────


async def code_exec_handler(args: dict[str, Any]) -> list[types.TextContent]:
    """
    Evaluate a math expression inside the WASM sandbox.

    Input schema fields:
      expression (str, required) – Arithmetic expression to evaluate.
        Examples: "2 + 2", "sqrt(2) * pi", "floor(3.7)", "2 ^ 10"
    """
    expression: str = args.get("expression", "").strip()
    if not expression:
        return _error("expression parameter is required and must not be empty")

    # Basic length guard — a huge expression could stress the evaluator.
    if len(expression) > 2048:
        return _error("Expression too long (max 2048 characters)")

    try:
        sandbox = _get_sandbox()
    except RuntimeError as exc:
        return _error(str(exc))

    # The evaluator reads one line from stdin and writes the result (or an
    # error message) to stdout, then exits 0 on success or 1 on parse error.
    result = sandbox.execute(expression.encode() + b"\n")

    if result["success"]:
        output = (result.get("output") or "").strip()
        payload = {
            "expression": expression,
            "result": output,
            "fuel_consumed": result.get("fuel_consumed"),
            "duration_s": result.get("duration_s"),
        }
        logger.info(
            "Expression evaluated",
            extra={"expression": expression, "result": output},
        )
        return [types.TextContent(type="text", text=json.dumps(payload))]
    else:
        error_msg = result.get("error") or "Evaluation failed"
        return _error(f"Evaluation error: {error_msg}")


# ── Schema exposed to the MCP registry ───────────────────────────────────────

CODE_EXEC_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "expression": {
            "type": "string",
            "description": (
                "A math expression to evaluate. Supports +, -, *, /, ^ (power), "
                "%, parentheses, functions (abs, sqrt, floor, ceil, round, min, max), "
                "and constants (pi, e). Example: 'sqrt(2) * pi'"
            ),
        },
    },
    "required": ["expression"],
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _error(message: str) -> list[types.TextContent]:
    return [
        types.TextContent(
            type="text",
            text=json.dumps({"error": message}),
        )
    ]

