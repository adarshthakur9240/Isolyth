"""
Tests for server/core/sandbox.py – WasmSandbox
===============================================
Run with:
    pytest server/tests/test_sandbox.py -v

These tests use pre-compiled .wasm fixtures located in
server/wasm_modules/. The WAT-based fixtures need no compiler:

  • echo_exit0.wasm    – calls proc_exit(0) immediately (clean exit, no output)
  • infinite_loop.wasm – loops forever (fuel / timeout exhaustion target)

The factorial tests require factorial.wasm, which is built from the Rust
project at server/wasm_modules/factorial_src/:

    cd server/wasm_modules/factorial_src
    cargo build --target wasm32-wasip1 --release
    cp target/wasm32-wasip1/release/factorial.wasm ../factorial.wasm

The factorial test class is skipped automatically when factorial.wasm is absent.
"""

import os
from pathlib import Path
import tempfile

import pytest

from server.core.sandbox import (
    SandboxInvalidModule,
    WasmSandbox,
    WasmSandboxConfig,
    run_wasm,
)

# ── Fixture paths ──────────────────────────────────────────────────────────────

WASM_DIR = Path(__file__).parent.parent / "wasm_modules"
ECHO_EXIT0_WASM = WASM_DIR / "echo_exit0.wasm"
INFINITE_LOOP_WASM = WASM_DIR / "infinite_loop.wasm"
FACTORIAL_WASM = WASM_DIR / "factorial.wasm"

# ── Helpers ────────────────────────────────────────────────────────────────────


def _skip_if_missing(path: Path) -> None:
    """Skip the test if the .wasm fixture isn't compiled yet."""
    if not path.exists():
        pytest.skip(f"Fixture not found: {path} – compile it first (see README)")


# ═══════════════════════════════════════════════════════════════════════════════
# 1.  Normal execution – clean exit
# ═══════════════════════════════════════════════════════════════════════════════


class TestNormalExecution:
    """Verify that a well-behaved module returns success."""

    def test_echo_exit0_succeeds(self) -> None:
        """echo_exit0.wasm calls proc_exit(0) → sandbox must report success."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        result = run_wasm(ECHO_EXIT0_WASM, b"")
        assert result["success"] is True, f"Expected success, got error: {result['error']}"
        assert result["error"] is None
        # Output is empty string (module writes nothing to stdout)
        assert result["output"] == "" or result["output"] is None or result["output"] == "\x00"

    def test_result_contains_required_keys(self) -> None:
        """Result dict must always contain the documented keys."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        result = run_wasm(ECHO_EXIT0_WASM, b"")
        for key in ("success", "output", "error", "duration_s", "fuel_consumed", "exit_code"):
            assert key in result, f"Missing key: {key!r}"

    def test_duration_is_positive(self) -> None:
        """Execution duration must be a positive float."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        result = run_wasm(ECHO_EXIT0_WASM, b"")
        assert isinstance(result["duration_s"], float)
        assert result["duration_s"] >= 0.0

    def test_fuel_consumed_is_reported(self) -> None:
        """fuel_consumed must be a non-negative integer on success."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        result = run_wasm(ECHO_EXIT0_WASM, b"")
        if result["success"]:
            assert result["fuel_consumed"] is not None
            assert result["fuel_consumed"] >= 0

    def test_string_input_is_accepted(self) -> None:
        """``execute`` must accept str input (auto-encoded to bytes)."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        sandbox = WasmSandbox(ECHO_EXIT0_WASM)
        result = sandbox.execute("hello world\n")  # str, not bytes
        assert result["success"] is True

    def test_sandbox_reuse_multiple_executions(self) -> None:
        """A single WasmSandbox instance must be safely reusable."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        sandbox = WasmSandbox(ECHO_EXIT0_WASM)
        for _ in range(3):
            result = sandbox.execute(b"")
            assert result["success"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# 2.  Factorial module (requires Rust / Cargo + wasm32-wasip1 target)
# ═══════════════════════════════════════════════════════════════════════════════


class TestFactorial:
    """
    Tests against factorial.wasm built from the Rust project at
    server/wasm_modules/factorial_src/.

    Build command (from project root):
        cd server/wasm_modules/factorial_src
        cargo build --target wasm32-wasip1 --release
        cp target/wasm32-wasip1/release/factorial.wasm ../factorial.wasm
    """

    def setup_method(self) -> None:
        _skip_if_missing(FACTORIAL_WASM)

    def test_factorial_of_0(self) -> None:
        result = run_wasm(FACTORIAL_WASM, b"0\n")
        assert result["success"] is True
        assert result["output"].strip() == "1"

    def test_factorial_of_1(self) -> None:
        result = run_wasm(FACTORIAL_WASM, b"1\n")
        assert result["success"] is True
        assert result["output"].strip() == "1"

    def test_factorial_of_10(self) -> None:
        result = run_wasm(FACTORIAL_WASM, b"10\n")
        assert result["success"] is True
        assert result["output"].strip() == "3628800"

    def test_factorial_of_20(self) -> None:
        result = run_wasm(FACTORIAL_WASM, b"20\n")
        assert result["success"] is True
        assert result["output"].strip() == "2432902008176640000"

    def test_factorial_of_34(self) -> None:
        """34! is the largest value that fits in u128 — Rust handles this correctly."""
        result = run_wasm(FACTORIAL_WASM, b"34\n")
        assert result["success"] is True
        # 34! = 295232799039604140847618609643520000000
        assert result["output"].strip() == "295232799039604140847618609643520000000"

    def test_factorial_invalid_input_negative(self) -> None:
        """Negative numbers cannot be parsed as u64; the Rust program exits with code 1."""
        result = run_wasm(FACTORIAL_WASM, b"-1\n")
        assert result["success"] is False

    def test_factorial_invalid_input_non_numeric(self) -> None:
        """Non-numeric stdin is rejected gracefully (exit code 1)."""
        result = run_wasm(FACTORIAL_WASM, b"abc\n")
        assert result["success"] is False

    def test_factorial_overflow_guard(self) -> None:
        """35! overflows u128; the Rust program detects this and exits with code 1."""
        result = run_wasm(FACTORIAL_WASM, b"35\n")
        assert result["success"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# 3.  Infinite-loop module – fuel exhaustion
# ═══════════════════════════════════════════════════════════════════════════════


class TestFuelExhaustion:
    """Verify that an infinite loop is killed by the fuel limiter."""

    def test_infinite_loop_killed_by_fuel(self) -> None:
        """Infinite loop must fail, not hang forever."""
        _skip_if_missing(INFINITE_LOOP_WASM)
        cfg = WasmSandboxConfig(
            max_fuel=500_000,      # tiny fuel budget → exhausted quickly
            timeout_seconds=30.0,  # generous wall-clock so fuel fires first
        )
        result = run_wasm(INFINITE_LOOP_WASM, b"", cfg)
        assert result["success"] is False
        assert result["error"] is not None
        # The error message should mention fuel/out-of-fuel
        err_lower = result["error"].lower()
        assert "fuel" in err_lower or "timeout" in err_lower or "trap" in err_lower, (
            f"Unexpected error: {result['error']}"
        )

    def test_infinite_loop_returns_within_reasonable_time(self) -> None:
        """Even with low fuel the sandbox must return quickly (no hang)."""
        _skip_if_missing(INFINITE_LOOP_WASM)
        import time
        cfg = WasmSandboxConfig(max_fuel=50_000, timeout_seconds=10.0)
        t0 = time.perf_counter()
        result = run_wasm(INFINITE_LOOP_WASM, b"", cfg)
        elapsed = time.perf_counter() - t0
        assert result["success"] is False
        # Should terminate well under 5 seconds even on slow machines.
        assert elapsed < 5.0, f"Sandbox took too long: {elapsed:.2f}s"


# ═══════════════════════════════════════════════════════════════════════════════
# 4.  Wall-clock timeout path
# ═══════════════════════════════════════════════════════════════════════════════


class TestWallClockTimeout:
    """Verify that an infinite loop can also be killed by the epoch timeout."""

    def test_timeout_fires_for_infinite_loop(self) -> None:
        """With huge fuel but a tiny timeout the epoch mechanism must fire."""
        _skip_if_missing(INFINITE_LOOP_WASM)
        import time
        cfg = WasmSandboxConfig(
            max_fuel=10_000_000_000,  # enormous fuel – won't run out
            timeout_seconds=0.3,       # tiny wall-clock budget
        )
        t0 = time.perf_counter()
        result = run_wasm(INFINITE_LOOP_WASM, b"", cfg)
        elapsed = time.perf_counter() - t0
        assert result["success"] is False
        # Must terminate close to the timeout (not hang)
        assert elapsed < 3.0, f"Sandbox took too long: {elapsed:.2f}s"
        err_lower = (result["error"] or "").lower()
        assert "timeout" in err_lower or "interrupt" in err_lower or "fuel" in err_lower, (
            f"Expected timeout/interrupt error, got: {result['error']}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 5.  Malformed / invalid input
# ═══════════════════════════════════════════════════════════════════════════════


class TestInvalidInput:
    """Verify that the sandbox rejects malformed WASM gracefully."""

    def test_nonexistent_wasm_file_raises(self) -> None:
        """Constructing WasmSandbox with a missing file must raise SandboxInvalidModule."""
        with pytest.raises(SandboxInvalidModule, match="not found"):
            WasmSandbox("/nonexistent/path/does_not_exist.wasm")

    def test_random_bytes_as_wasm_raises(self) -> None:
        """Feeding random bytes as .wasm content must raise SandboxInvalidModule."""
        with tempfile.NamedTemporaryFile(suffix=".wasm", delete=False) as f:
            f.write(b"\x00\x61\x73\x6d" + b"\xff" * 128)  # bad WASM magic prefix variant
            bad_path = f.name
        try:
            with pytest.raises(SandboxInvalidModule, match="(?i)(compile|invalid|wasm)"):
                WasmSandbox(bad_path)
        finally:
            os.unlink(bad_path)

    def test_empty_file_raises(self) -> None:
        """An empty .wasm file must raise SandboxInvalidModule."""
        with tempfile.NamedTemporaryFile(suffix=".wasm", delete=False) as f:
            bad_path = f.name
        try:
            with pytest.raises(SandboxInvalidModule):
                WasmSandbox(bad_path)
        finally:
            os.unlink(bad_path)

    def test_plain_text_file_raises(self) -> None:
        """A plaintext file (not WASM) must raise SandboxInvalidModule."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".wasm", delete=False
        ) as f:
            f.write("this is definitely not a wasm file\n")
            bad_path = f.name
        try:
            with pytest.raises(SandboxInvalidModule):
                WasmSandbox(bad_path)
        finally:
            os.unlink(bad_path)

    def test_result_dict_always_returned_on_error(self) -> None:
        """
        Even when the module itself crashes, execute() must always return a dict
        (never propagate exceptions at the public API boundary).
        """
        _skip_if_missing(ECHO_EXIT0_WASM)
        sandbox = WasmSandbox(ECHO_EXIT0_WASM)
        # Pass absurdly huge input – the module ignores it, but shouldn't crash the sandbox.
        result = sandbox.execute(b"A" * 1_000_000)
        assert isinstance(result, dict)
        assert "success" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 6.  Configuration validation
# ═══════════════════════════════════════════════════════════════════════════════


class TestConfiguration:
    """Verify that WasmSandboxConfig parameters are respected."""

    def test_default_config_is_created(self) -> None:
        """WasmSandboxConfig defaults must be sensible."""
        cfg = WasmSandboxConfig()
        assert cfg.max_memory_bytes == 64 * 1024 * 1024
        assert cfg.max_fuel == 100_000_000
        assert cfg.timeout_seconds == 5.0

    def test_custom_config_propagates(self) -> None:
        """Custom limits must be stored on the sandbox instance."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        cfg = WasmSandboxConfig(max_fuel=1_000, timeout_seconds=1.0)
        sb = WasmSandbox(ECHO_EXIT0_WASM, cfg)
        assert sb.config.max_fuel == 1_000
        assert sb.config.timeout_seconds == 1.0

    def test_extra_log_fields_accepted(self) -> None:
        """extra_log_fields should be stored without raising."""
        _skip_if_missing(ECHO_EXIT0_WASM)
        cfg = WasmSandboxConfig(extra_log_fields={"request_id": "abc-123"})
        sb = WasmSandbox(ECHO_EXIT0_WASM, cfg)
        result = sb.execute(b"")
        assert isinstance(result, dict)
