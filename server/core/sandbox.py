"""
Isolyth – WASM Sandbox Executor
================================
Provides a ``WasmSandbox`` class that executes untrusted WebAssembly modules
with strict resource limits:

  • **Memory limit** – enforced via ``Store.set_limits(memory_size=...)``
  • **Fuel limit** – wasmtime's instruction-level metering; the engine
    decrements a counter on every "fuel-consuming" opcode and raises
    ``TrapCode.OUT_OF_FUEL`` when exhausted.
  • **Wall-clock timeout** – a ``threading.Timer`` increments the engine epoch,
    which causes a ``TrapCode.INTERRUPT`` trap inside the running WASM thread.
  • **No filesystem / network** – WASI is configured with only stdin/stdout/stderr
    backed by temp files; no directory preopens are added.

Legacy ``Sandbox`` / ``SandboxConfig`` classes are preserved below for
backward compatibility with existing code.

Usage::

    sandbox = WasmSandbox("path/to/module.wasm")
    result = sandbox.execute(b"10\\n")
    # {"success": True, "output": "3628800\\n", "error": None,
    #  "duration_s": 0.003, "fuel_consumed": 12345}
"""

from dataclasses import dataclass, field
import logging
import os
from pathlib import Path
import tempfile
import threading
import time
from typing import Any

from wasmtime import (
    Config,
    Engine,
    ExitTrap,
    Linker,
    Module,
    Store,
    Trap,
    TrapCode,
    WasiConfig,
    WasmtimeError,
)

logger = logging.getLogger("isolyth.sandbox")


# ── Custom exception hierarchy ────────────────────────────────────────────────


class SandboxError(Exception):
    """Base class for all sandbox-related errors."""


class SandboxTimeout(SandboxError):
    """Raised when execution exceeds the wall-clock deadline."""


class SandboxOutOfFuel(SandboxError):
    """Raised when the module exhausts its instruction-fuel budget."""


class SandboxMemoryExceeded(SandboxError):
    """Raised when the module attempts to grow memory past the configured limit."""


class SandboxInvalidModule(SandboxError):
    """Raised when the .wasm file cannot be compiled or is malformed."""


# ── WasmSandbox configuration ─────────────────────────────────────────────────


@dataclass
class WasmSandboxConfig:
    """Tunable resource limits for a WASM sandbox execution."""

    # Maximum linear-memory the guest module may use (bytes).
    max_memory_bytes: int = 64 * 1024 * 1024  # 64 MB

    # Maximum number of WASM "fuel units" consumed before trapping.
    # Roughly one unit per basic operation; 100 M is generous for most programs.
    max_fuel: int = 100_000_000

    # Wall-clock timeout in seconds; execution is interrupted via epoch.
    timeout_seconds: float = 5.0

    # Extra key=value pairs surfaced in structured log output.
    extra_log_fields: dict[str, Any] = field(default_factory=dict)


# ── Main sandbox class ────────────────────────────────────────────────────────


class WasmSandbox:
    """
    Execute an untrusted WASM module with enforced resource limits.

    Parameters
    ----------
    wasm_path:
        Path to the compiled ``.wasm`` file.
    config:
        Optional ``WasmSandboxConfig``; defaults are used when omitted.

    Raises
    ------
    SandboxInvalidModule
        If the .wasm file cannot be found, read, or compiled.
    """

    def __init__(
        self,
        wasm_path: str | Path,
        config: WasmSandboxConfig | None = None,
    ) -> None:
        self.wasm_path = Path(wasm_path)
        self.config = config or WasmSandboxConfig()

        # Build a shared Engine with fuel consumption + epoch interruption enabled.
        # Both features must be switched on at Engine creation time (Config is
        # immutable once an Engine is constructed from it).
        engine_cfg = Config()
        engine_cfg.consume_fuel = True        # enable per-instruction fuel metering
        engine_cfg.epoch_interruption = True  # enable epoch-based wall-clock kills

        self._engine = Engine(engine_cfg)

        # Compile the module once; reuse the compiled artifact across calls.
        try:
            wasm_bytes = self.wasm_path.read_bytes()
        except FileNotFoundError as exc:
            raise SandboxInvalidModule(
                f"WASM file not found: {self.wasm_path}"
            ) from exc
        except OSError as exc:
            raise SandboxInvalidModule(
                f"Cannot read WASM file {self.wasm_path}: {exc}"
            ) from exc

        try:
            self._module = Module(self._engine, wasm_bytes)
        except WasmtimeError as exc:
            raise SandboxInvalidModule(
                f"Failed to compile WASM module: {exc}"
            ) from exc

        logger.info(
            "WasmSandbox initialised",
            extra={
                "wasm_path": str(self.wasm_path),
                "max_memory_bytes": self.config.max_memory_bytes,
                "max_fuel": self.config.max_fuel,
                "timeout_seconds": self.config.timeout_seconds,
            },
        )

    # ── Public API ────────────────────────────────────────────────────────────

    def execute(self, input_data: bytes | str) -> dict[str, Any]:
        """
        Run the WASM module with *input_data* piped to its stdin.

        Parameters
        ----------
        input_data:
            Raw bytes or a JSON-serialisable string sent to the module's stdin.

        Returns
        -------
        dict with keys:

        * ``success``      – ``True`` iff the module exited cleanly (exit code 0).
        * ``output``       – captured stdout as a string (may be empty).
        * ``error``        – error message string or ``None``.
        * ``duration_s``   – wall-clock seconds consumed.
        * ``fuel_consumed`` – instruction units used (``None`` if unavailable).
        * ``exit_code``    – WASI exit code (``None`` for non-WASI modules).
        """
        if isinstance(input_data, str):
            input_data = input_data.encode()

        start = time.perf_counter()
        result: dict[str, Any] = {
            "success": False,
            "output": None,
            "error": None,
            "duration_s": 0.0,
            "fuel_consumed": None,
            "exit_code": None,
        }

        try:
            from server.core.telemetry import track_active_sandbox
            with track_active_sandbox():
                output, fuel_remaining = self._run(input_data)
            fuel_consumed = self.config.max_fuel - fuel_remaining
            result.update(
                success=True,
                output=output,
                fuel_consumed=fuel_consumed,
            )

        except SandboxTimeout as exc:
            result["error"] = (
                f"Timeout: execution exceeded {self.config.timeout_seconds}s"
            )
            logger.warning("Sandbox timeout", extra={"reason": str(exc)})

        except SandboxOutOfFuel as exc:
            result["error"] = (
                f"OutOfFuel: module consumed all {self.config.max_fuel} fuel units"
            )
            logger.warning("Sandbox out-of-fuel", extra={"reason": str(exc)})

        except SandboxMemoryExceeded as exc:
            result["error"] = (
                f"MemoryExceeded: module tried to exceed "
                f"{self.config.max_memory_bytes} bytes"
            )
            logger.warning("Sandbox memory exceeded", extra={"reason": str(exc)})

        except SandboxInvalidModule as exc:
            result["error"] = f"InvalidModule: {exc}"
            logger.error("Sandbox invalid module", extra={"reason": str(exc)})

        except SandboxError as exc:
            result["error"] = str(exc)
            logger.error("Sandbox generic error", extra={"reason": str(exc)})

        except Exception as exc:  # noqa: BLE001
            result["error"] = f"Unexpected error: {type(exc).__name__}: {exc}"
            logger.exception("Sandbox unexpected exception")

        finally:
            result["duration_s"] = round(time.perf_counter() - start, 6)

        log_extra: dict[str, Any] = {
            "wasm_path": str(self.wasm_path),
            "success": result["success"],
            "duration_s": result["duration_s"],
            "fuel_consumed": result["fuel_consumed"],
            "error": result["error"],
            **self.config.extra_log_fields,
        }
        if result["success"]:
            logger.info("Sandbox execution completed", extra=log_extra)
        else:
            logger.warning("Sandbox execution failed", extra=log_extra)

        return result

    # ── Internal execution machinery ──────────────────────────────────────────

    def _run(self, input_data: bytes) -> tuple[str, int]:
        """
        Low-level: spin up a Store, configure WASI, run the module, return
        (stdout_text, fuel_remaining).  All sandbox errors are translated into
        the typed exceptions declared above.

        We use real filesystem temp files because wasmtime's ``WasiConfig``
        only accepts file paths (not Python file-objects or BytesIO).
        """
        with (
            tempfile.NamedTemporaryFile(delete=False, suffix=".wasm_stdin") as stdin_f,
            tempfile.NamedTemporaryFile(delete=False, suffix=".wasm_stdout") as stdout_f,
            tempfile.NamedTemporaryFile(delete=False, suffix=".wasm_stderr") as stderr_f,
        ):
            stdin_path = stdin_f.name
            stdout_path = stdout_f.name
            stderr_path = stderr_f.name
            stdin_f.write(input_data)

        try:
            return self._execute_with_files(stdin_path, stdout_path, stderr_path)
        finally:
            for p in (stdin_path, stdout_path, stderr_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass

    def _execute_with_files(
        self,
        stdin_path: str,
        stdout_path: str,
        stderr_path: str,
    ) -> tuple[str, int]:
        """
        Create a fresh Store, wire I/O, set limits, arm the timeout thread,
        then call ``_start`` / ``main`` and return (stdout_text, fuel_remaining).
        """
        # ── Store ──────────────────────────────────────────────────────────
        store = Store(self._engine)

        # Fuel budget: how many WASM instructions we allow before trapping.
        store.set_fuel(self.config.max_fuel)

        # Memory limit: prevent the guest from growing its linear memory beyond
        # max_memory_bytes.  -1 means "no limit" for the other categories.
        store.set_limits(memory_size=self.config.max_memory_bytes)

        # Epoch deadline: once the background timer increments the engine
        # epoch, the very next epoch check inside the JIT raises INTERRUPT.
        store.set_epoch_deadline(1)

        # ── WASI configuration ─────────────────────────────────────────────
        wasi_cfg = WasiConfig()
        # Empty argv and env; no preopened directories → zero FS/network access.
        wasi_cfg.argv = []
        wasi_cfg.env = []
        wasi_cfg.stdin_file = stdin_path
        wasi_cfg.stdout_file = stdout_path
        wasi_cfg.stderr_file = stderr_path
        # NOTE: deliberately NOT calling wasi_cfg.preopen_dir(…).
        store.set_wasi(wasi_cfg)

        # ── Wall-clock timeout via epoch ───────────────────────────────────
        # The timer runs on a daemon thread.  When it fires it calls
        # ``engine.increment_epoch()``.  Because the Store's epoch_deadline is 1,
        # the very next epoch poll inside the compiled WASM code raises INTERRUPT.
        timed_out_flag = threading.Event()

        def _on_timeout() -> None:
            timed_out_flag.set()
            self._engine.increment_epoch()

        timer = threading.Timer(self.config.timeout_seconds, _on_timeout)
        timer.daemon = True
        timer.start()

        try:
            linker = Linker(self._engine)
            linker.define_wasi()

            instance = linker.instantiate(store, self._module)

            # WASI command modules export ``_start``; fall back to ``main``.
            exports = instance.exports(store)
            start_fn = exports.get("_start") or exports.get("main")
            if start_fn is None:
                raise SandboxError(
                    "WASM module exports neither '_start' nor 'main'."
                )
            start_fn(store)

        except ExitTrap as exc:
            # Normal WASI process exit via proc_exit(0) → success.
            # Non-zero exit codes → treat as error.
            if exc.code != 0:
                raise SandboxError(
                    f"WASM module exited with non-zero code: {exc.code}"
                ) from exc
            # exit code 0: fall through to read stdout

        except Trap as exc:
            code = exc.trap_code
            if timed_out_flag.is_set() or code == TrapCode.INTERRUPT:
                raise SandboxTimeout(
                    f"Execution killed after {self.config.timeout_seconds}s"
                ) from exc
            if code == TrapCode.OUT_OF_FUEL:
                raise SandboxOutOfFuel(
                    f"Module consumed all {self.config.max_fuel} fuel units"
                ) from exc
            if code in (
                TrapCode.MEMORY_OUT_OF_BOUNDS,
                TrapCode.ALLOCATION_TOO_LARGE,
            ):
                raise SandboxMemoryExceeded(
                    f"Module exceeded memory limit of "
                    f"{self.config.max_memory_bytes} bytes"
                ) from exc
            # Any other trap (stack overflow, unreachable, divide-by-zero…)
            raise SandboxError(f"WASM trap ({code}): {exc.message}") from exc

        except WasmtimeError as exc:
            # Linker / instantiation errors (missing imports, invalid module).
            msg = str(exc)
            if "memory" in msg.lower() and "limit" in msg.lower():
                raise SandboxMemoryExceeded(msg) from exc
            raise SandboxError(f"Wasmtime error: {msg}") from exc

        finally:
            timer.cancel()

        # ── Collect output ─────────────────────────────────────────────────
        try:
            with open(stdout_path, "rb") as fh:
                raw_output = fh.read()
            stdout_text = raw_output.decode("utf-8", errors="replace")
        except OSError:
            stdout_text = ""

        try:
            fuel_remaining = store.get_fuel()
        except WasmtimeError:
            fuel_remaining = 0

        return stdout_text, fuel_remaining


# ── Convenience wrapper ───────────────────────────────────────────────────────


def run_wasm(
    wasm_path: str | Path,
    input_data: bytes | str,
    config: WasmSandboxConfig | None = None,
) -> dict[str, Any]:
    """
    One-shot helper: create a ``WasmSandbox``, execute once, return the result.

    Raises ``SandboxInvalidModule`` if the module cannot be compiled.
    """
    sandbox = WasmSandbox(wasm_path, config)
    return sandbox.execute(input_data)


# ── Legacy process-sandbox classes (preserved for backward compat) ────────────


@dataclass
class SandboxConfig:
    """Tunable parameters for the legacy process execution sandbox."""

    workspace_root: Path = field(default_factory=lambda: Path("/tmp/isolyth_workspace"))
    max_cpu_seconds: int = 10
    max_memory_mb: int = 128
    allowed_network_hosts: list[str] = field(default_factory=list)
    enable_network: bool = False


class Sandbox:
    """
    Legacy process-level execution sandbox context manager (stub).

    Usage::

        async with Sandbox(config) as sb:
            result = await sb.run_python(code)
    """

    def __init__(self, config: SandboxConfig | None = None) -> None:
        self.config = config or SandboxConfig()
        self._workspace: Path | None = None

    async def __aenter__(self) -> "Sandbox":
        self._workspace = self.config.workspace_root
        self._workspace.mkdir(parents=True, exist_ok=True)
        logger.info(
            "Sandbox entered",
            extra={"workspace": str(self._workspace)},
        )
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        logger.info("Sandbox exited")

    def safe_path(self, relative: str | Path) -> Path:
        """Resolve *relative* inside the workspace and raise if it escapes."""
        if self._workspace is None:
            raise RuntimeError("Sandbox is not active – use as async context manager")
        resolved = (self._workspace / relative).resolve()
        if not str(resolved).startswith(str(self._workspace.resolve())):
            raise PermissionError(
                f"Path {relative!r} attempts to escape the sandbox workspace."
            )
        return resolved

    async def run_python(self, code: str, *, timeout: int | None = None) -> dict[str, str]:
        """Execute *code* inside the sandbox (stub – not yet implemented)."""
        raise NotImplementedError("run_python is not yet implemented")


__all__ = [
    # WASM sandbox
    "WasmSandbox",
    "WasmSandboxConfig",
    "SandboxError",
    "SandboxTimeout",
    "SandboxOutOfFuel",
    "SandboxMemoryExceeded",
    "SandboxInvalidModule",
    "run_wasm",
    # Legacy process sandbox
    "Sandbox",
    "SandboxConfig",
]

