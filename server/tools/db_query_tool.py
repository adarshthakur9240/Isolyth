"""
db_query_tool – Database Query Tool
=====================================
Executes read-only SQL SELECT statements against PostgreSQL via asyncpg.

Security properties:
  • Only SELECT statements are accepted; INSERT/UPDATE/DELETE/DROP/TRUNCATE and
    any other DDL/DML is rejected before the query reaches the database.
  • Every query runs inside a READ ONLY transaction so even if validation is
    bypassed the database itself rejects mutations.
  • Query timeout (default 10 s) prevents long-running queries from monopolising
    the connection pool.
  • Parameters are passed as positional $1/$2/... placeholders, so user-supplied
    values are never interpolated into the query string (SQL injection prevention).

Environment variables:
  DATABASE_URL – asyncpg DSN, e.g.
                 postgresql://user:password@localhost:5432/mydb
  DB_QUERY_TIMEOUT_S – per-query timeout in seconds (default 10)
"""

import json
import logging
import os
import re
from typing import Any

import asyncpg
import mcp.types as types

logger = logging.getLogger("isolyth.tools.db_query")

# ── Configuration ─────────────────────────────────────────────────────────────

DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
QUERY_TIMEOUT_S: float = float(os.environ.get("DB_QUERY_TIMEOUT_S", "10"))

# Maximum number of rows returned to prevent accidental full-table dumps.
MAX_ROWS: int = int(os.environ.get("DB_MAX_ROWS", "500"))

# ── SQL safety guard ──────────────────────────────────────────────────────────

# Keywords that indicate a mutating statement.  We strip comments and
# normalise whitespace before checking so tricks like:
#   -- comment\n DROP TABLE …
# are caught too.
_MUTATING_PATTERN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE"
    r"|GRANT|REVOKE|EXEC|EXECUTE|CALL|MERGE|UPSERT|BEGIN|COMMIT|ROLLBACK)\b",
    re.IGNORECASE,
)

# Strip single-line (--) and block (/* */) SQL comments before keyword scanning.
_STRIP_LINE_COMMENT = re.compile(r"--[^\n]*")
_STRIP_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def _strip_sql_comments(sql: str) -> str:
    sql = _STRIP_LINE_COMMENT.sub(" ", sql)
    sql = _STRIP_BLOCK_COMMENT.sub(" ", sql)
    return sql


def _validate_select_only(query: str) -> None:
    """
    Raise ``ValueError`` if *query* contains any non-SELECT keyword.

    This is a defence-in-depth check; the real protection is the READ ONLY
    transaction wrapper applied at the database level.
    """
    clean = _strip_sql_comments(query).strip()

    # Must begin with SELECT (after optional WITH for CTEs).
    first_token = clean.split()[0].upper() if clean.split() else ""
    if first_token not in ("SELECT", "WITH", "EXPLAIN"):
        raise ValueError(
            f"Only SELECT statements are allowed; got leading token: {first_token!r}"
        )

    # Secondary scan for any mutating keyword anywhere in the query.
    if _MUTATING_PATTERN.search(clean):
        match = _MUTATING_PATTERN.search(clean)
        raise ValueError(
            f"Forbidden keyword detected in query: {match.group(0).upper()!r}"
        )


# ── Tool handler ──────────────────────────────────────────────────────────────


async def db_query_handler(args: dict[str, Any]) -> list[types.TextContent]:
    """
    Execute a read-only SQL query and return rows as a JSON array.

    Input schema fields:
      query  (str, required) – SQL SELECT statement.
      params (list, optional) – Positional parameters for $1/$2/… placeholders.
    """
    query: str = args.get("query", "").strip()
    params: list[Any] = args.get("params", []) or []

    if not query:
        return _error("query parameter is required and must not be empty")

    # ── Safety: validate the statement is read-only ────────────────────────────
    try:
        _validate_select_only(query)
    except ValueError as exc:
        logger.warning("SQL mutation guard triggered", extra={"reason": str(exc)})
        return _error(f"Forbidden query: {exc}")

    # ── Connectivity check ────────────────────────────────────────────────────
    if not DATABASE_URL:
        return _error(
            "DATABASE_URL environment variable is not set; "
            "cannot connect to PostgreSQL."
        )

    # ── Execute inside a READ ONLY transaction ────────────────────────────────
    conn: asyncpg.Connection | None = None
    try:
        conn = await asyncpg.connect(DATABASE_URL, timeout=5.0)

        # Wrap in READ ONLY transaction: even if the SQL guard is fooled, the
        # database itself will refuse any mutation attempt.
        async with conn.transaction(readonly=True):
            rows = await conn.fetch(
                query,
                *params,
                timeout=QUERY_TIMEOUT_S,
            )

        if len(rows) > MAX_ROWS:
            rows = rows[:MAX_ROWS]
            truncated = True
        else:
            truncated = False

        # asyncpg Row objects are not directly JSON-serialisable; convert to dicts.
        result_data: list[dict[str, Any]] = [dict(row) for row in rows]

        payload = {
            "rows": result_data,
            "row_count": len(result_data),
            "truncated": truncated,
        }
        logger.info(
            "DB query executed",
            extra={"row_count": len(result_data), "truncated": truncated},
        )
        return [types.TextContent(type="text", text=json.dumps(payload, default=str))]

    except asyncpg.exceptions.PostgresError as exc:
        logger.warning("DB query failed (postgres error)", extra={"error": str(exc)})
        return _error(f"Database error: {exc}")
    except asyncpg.exceptions.TooManyConnectionsError as exc:
        return _error(f"Connection pool exhausted: {exc}")
    except TimeoutError:
        return _error(f"Query timed out after {QUERY_TIMEOUT_S}s")
    except OSError as exc:
        return _error(f"Cannot reach database: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected DB query error")
        return _error(f"Unexpected error: {type(exc).__name__}: {exc}")
    finally:
        if conn is not None:
            await conn.close()


# ── Schema exposed to the MCP registry ───────────────────────────────────────

DB_QUERY_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "A read-only SQL SELECT statement.",
        },
        "params": {
            "type": "array",
            "items": {},
            "description": (
                "Positional parameters for $1/$2/… placeholders in the query. "
                "Always prefer parameterized queries over string interpolation."
            ),
        },
    },
    "required": ["query"],
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _error(message: str) -> list[types.TextContent]:
    return [
        types.TextContent(
            type="text",
            text=json.dumps({"error": message}),
        )
    ]

