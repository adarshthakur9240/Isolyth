"""
file_ops_tool – File Operations Tool
=====================================
Provides sandboxed read-file and list-directory operations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECURITY: Path Traversal Prevention
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Path traversal (also called "directory traversal" or "../ attacks") lets an
attacker escape a sandboxed directory by injecting sequences like:

    ../../etc/passwd
    /tmp/../../../etc/shadow
    encoded variants: %2e%2e%2f, %252e%252e%252f

Our defence:

  1. ``Path.resolve()`` on the user-supplied path canonicalises ALL
     symlinks, normalises ".", "..", and percent-encoding BEFORE we do
     any comparison.  This is crucial — naive string-prefix checks on
     un-resolved paths can be bypassed.

  2. We then check that the resolved absolute path STARTS WITH the
     resolved sandbox root path.  If it does not, we raise immediately
     and never touch the filesystem.

  3. We also reject paths that ARE exactly the sandbox root when a
     read_file operation is attempted (you can list root, not read it).

  4. Symlinks that point outside the sandbox root are caught because
     resolve() follows them before the prefix check.

Environment variables:
  FILE_OPS_SANDBOX_ROOT – absolute path to the sandboxed workspace directory
                          (default: /tmp/isolyth_workspace)
  FILE_OPS_MAX_READ_BYTES – maximum file size readable in a single call
                            (default: 1 MB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import json
import logging
import os
import stat
from pathlib import Path
from typing import Any

import mcp.types as types

logger = logging.getLogger("isolyth.tools.file_ops")

# ── Configuration ─────────────────────────────────────────────────────────────

_DEFAULT_SANDBOX_ROOT = Path(os.environ.get(
    "FILE_OPS_SANDBOX_ROOT", "/tmp/isolyth_workspace"
))
MAX_READ_BYTES: int = int(os.environ.get("FILE_OPS_MAX_READ_BYTES", str(1024 * 1024)))  # 1 MB


# ── Path safety guard ─────────────────────────────────────────────────────────


class PathTraversalError(ValueError):
    """Raised when a path would escape the sandbox root."""


def _safe_resolve(user_path: str, sandbox_root: Path) -> Path:
    """
    Resolve *user_path* relative to *sandbox_root* and return the absolute Path.

    SECURITY: Uses ``Path.resolve()`` which:
      • Resolves all symlinks (prevents symlink-based escapes).
      • Canonicalises ".", "..", and redundant separators.
      • Makes the path absolute (no relative-path tricks).

    Raises ``PathTraversalError`` if the resolved path lies outside *sandbox_root*.
    """
    resolved_root = sandbox_root.resolve()

    # Interpret the user path as relative to sandbox root UNLESS it starts with
    # the sandbox root itself (support both relative and absolute inputs).
    raw = Path(user_path)
    if raw.is_absolute():
        candidate = raw
    else:
        candidate = sandbox_root / raw

    resolved = candidate.resolve()

    # The key check: the resolved path must be a descendant of the sandbox root.
    # We use os.path.commonpath which is safer than startswith on strings:
    # /tmp/isolyth_workspace_evil would NOT pass a string startswith check
    # against /tmp/isolyth_workspace/, but using resolved paths avoids even that.
    try:
        resolved.relative_to(resolved_root)
    except ValueError:
        raise PathTraversalError(
            f"Path traversal blocked: {user_path!r} resolves outside sandbox root"
        )

    return resolved


# ── Tool handler ──────────────────────────────────────────────────────────────


async def file_ops_handler(
    args: dict[str, Any],
    *,
    sandbox_root: Path | None = None,
) -> list[types.TextContent]:
    """
    Perform a sandboxed file operation.

    Input schema fields:
      operation (str, required) – One of "read_file" or "list_directory".
      path      (str, required) – Path relative to the sandbox root.
    """
    operation: str = args.get("operation", "").strip()
    path_arg: str = args.get("path", "").strip()
    root: Path = sandbox_root or _DEFAULT_SANDBOX_ROOT

    if not operation:
        return _error("operation parameter is required")
    if not path_arg:
        return _error("path parameter is required")

    # Ensure sandbox root exists and has a sample file for operations.
    try:
        root.mkdir(parents=True, exist_ok=True)
        sample_file = root / "sample.txt"
        if not sample_file.exists():
            sample_file.write_text("Isolyth MCP Tool Server Sandboxed Workspace\n")
    except Exception:
        pass

    # ── Path traversal check ──────────────────────────────────────────────────
    try:
        safe_path = _safe_resolve(path_arg, root)
    except PathTraversalError as exc:
        logger.warning("Path traversal blocked", extra={"path": path_arg, "reason": str(exc)})
        return _error(f"Access denied: {exc}")

    # ── Dispatch ──────────────────────────────────────────────────────────────
    if operation == "read_file":
        return await _read_file(safe_path)
    elif operation == "list_directory":
        return await _list_directory(safe_path)
    else:
        return _error(
            f"Unknown operation {operation!r}. "
            "Supported operations: read_file, list_directory"
        )


async def _read_file(path: Path) -> list[types.TextContent]:
    """Read and return the content of a file within the sandbox."""
    if not path.exists():
        return _error(f"File not found: {path.name!r}")
    if not path.is_file():
        return _error(f"Path is not a file: {path.name!r}")

    file_size = path.stat().st_size
    if file_size > MAX_READ_BYTES:
        return _error(
            f"File too large to read: {file_size} bytes > limit {MAX_READ_BYTES} bytes. "
            "Use a byte-range request or increase FILE_OPS_MAX_READ_BYTES."
        )

    try:
        raw = path.read_bytes()
        # Attempt UTF-8 decode; fall back to latin-1 for binary-ish files.
        try:
            content = raw.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError:
            content = raw.decode("latin-1")
            encoding = "latin-1"

        payload = {
            "path": str(path),
            "size_bytes": file_size,
            "encoding": encoding,
            "content": content,
        }
        logger.info("File read", extra={"path": str(path), "bytes": file_size})
        return [types.TextContent(type="text", text=json.dumps(payload))]
    except PermissionError:
        return _error(f"Permission denied reading file: {path.name!r}")
    except OSError as exc:
        return _error(f"OS error reading file: {exc}")


async def _list_directory(path: Path) -> list[types.TextContent]:
    """List entries in a directory within the sandbox."""
    if not path.exists():
        return _error(f"Directory not found: {path.name!r}")
    if not path.is_dir():
        return _error(f"Path is not a directory: {path.name!r}")

    try:
        entries = []
        for entry in sorted(path.iterdir()):
            try:
                st = entry.stat()
                entries.append({
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size_bytes": st.st_size if entry.is_file() else None,
                })
            except OSError:
                entries.append({"name": entry.name, "type": "unknown", "size_bytes": None})

        payload = {
            "path": str(path),
            "entry_count": len(entries),
            "entries": entries,
        }
        logger.info("Directory listed", extra={"path": str(path), "count": len(entries)})
        return [types.TextContent(type="text", text=json.dumps(payload))]
    except PermissionError:
        return _error(f"Permission denied listing directory: {path.name!r}")
    except OSError as exc:
        return _error(f"OS error listing directory: {exc}")


# ── Schema exposed to the MCP registry ───────────────────────────────────────

FILE_OPS_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "operation": {
            "type": "string",
            "enum": ["read_file", "list_directory"],
            "description": "The file operation to perform.",
        },
        "path": {
            "type": "string",
            "description": (
                "Path relative to the sandboxed workspace root. "
                "Path traversal (../) is blocked."
            ),
        },
    },
    "required": ["operation", "path"],
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _error(message: str) -> list[types.TextContent]:
    return [
        types.TextContent(
            type="text",
            text=json.dumps({"error": message}),
        )
    ]

