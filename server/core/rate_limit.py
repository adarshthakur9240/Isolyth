"""
rate_limit.py – Token Bucket / Sliding Window Rate Limiter
===========================================================
Provides Redis-backed rate limiting per tool and per user, with an in-memory
fallback when Redis is unavailable.

Environment variables:
  REDIS_URL – Connection string for Redis instance (e.g., redis://localhost:6379/0).
              If unset or unreachable, falls back to in-memory rate limiting.
"""

import asyncio
import logging
import os
import time
from typing import Any

logger = logging.getLogger("isolyth.rate_limit")

# Try importing redis async client
try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None  # type: ignore[assignment]


# ── Configuration & Tool Limits ───────────────────────────────────────────────

# Default per-tool limits: (max_requests, window_seconds)
DEFAULT_TOOL_LIMITS: dict[str, tuple[int, int]] = {
    "db_query": (10, 60),      # 10 requests per 60s
    "web_fetch": (30, 60),     # 30 requests per 60s
    "file_ops": (60, 60),      # 60 requests per 60s
    "code_exec": (20, 60),     # 20 requests per 60s
}

DEFAULT_FALLBACK_LIMIT: tuple[int, int] = (60, 60)  # 60 requests per 60s


# ── Rate Limiter Class ────────────────────────────────────────────────────────


class RateLimiter:
    """
    Per-tool, per-user rate limiter backed by Redis with an in-memory fallback.

    Parameters
    ----------
    redis_url:
        Optional Redis DSN string (defaults to env `REDIS_URL`).
    tool_limits:
        Optional custom tool limits dict mapping `tool_name -> (max_reqs, window_s)`.
    """

    def __init__(
        self,
        redis_url: str | None = None,
        tool_limits: dict[str, tuple[int, int]] | None = None,
    ) -> None:
        self.redis_url = redis_url if redis_url is not None else os.environ.get("REDIS_URL")
        self.tool_limits = tool_limits or dict(DEFAULT_TOOL_LIMITS)

        # In-memory storage: key -> list of float timestamps
        self._memory_store: dict[str, list[float]] = {}
        self._memory_lock = asyncio.Lock()

        # Redis client handle (lazy)
        self._redis_client: Any = None
        self._redis_failed: bool = False

    async def _get_redis(self) -> Any:
        """Get or initialize async Redis client if available."""
        if self._redis_failed or not self.redis_url or aioredis is None:
            return None

        if self._redis_client is None:
            try:
                client = aioredis.from_url(
                    self.redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_timeout=1.0,
                )
                await client.ping()
                self._redis_client = client
                logger.info("Connected to Redis for rate limiting")
            except Exception as exc:
                logger.warning(
                    "Failed to connect to Redis; using in-memory rate limiting fallback",
                    extra={"error": str(exc)},
                )
                self._redis_failed = True
                self._redis_client = None

        return self._redis_client

    def get_limit_config(self, tool_name: str) -> tuple[int, int]:
        """Return (max_requests, window_seconds) for *tool_name*."""
        return self.tool_limits.get(tool_name, DEFAULT_FALLBACK_LIMIT)

    async def is_allowed(
        self, user_id: str, tool_name: str
    ) -> tuple[bool, dict[str, Any]]:
        """
        Check if request is permitted under rate limits.

        Returns
        -------
        (allowed: bool, info: dict)
        where info contains:
          - limit: max requests allowed in window
          - remaining: remaining request quota
          - reset_seconds: time until full reset
          - tool_name: target tool
        """
        if os.environ.get("RATE_LIMIT_DISABLED", "").lower() in ("true", "1", "yes") or \
           os.environ.get("RATE_LIMIT_MODE", "").lower() == "disabled":
            return True, {
                "limit": 999999,
                "remaining": 999999,
                "reset_seconds": 60,
                "tool_name": tool_name,
            }

        max_requests, window_seconds = self.get_limit_config(tool_name)
        key = f"rate_limit:{user_id}:{tool_name}"

        r_client = await self._get_redis()
        if r_client is not None:
            try:
                return await self._check_redis(
                    r_client, key, max_requests, window_seconds, tool_name
                )
            except Exception as exc:
                logger.warning(
                    "Redis rate limit check failed; falling back to in-memory",
                    extra={"error": str(exc)},
                )
                self._redis_failed = True

        return await self._check_in_memory(
            key, max_requests, window_seconds, tool_name
        )

    async def _check_redis(
        self,
        client: Any,
        key: str,
        max_requests: int,
        window_seconds: int,
        tool_name: str,
    ) -> tuple[bool, dict[str, Any]]:
        now = time.time()
        cutoff = now - window_seconds

        async with client.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, cutoff)
            pipe.zcard(key)
            pipe.zadd(key, {str(now): now})
            pipe.expire(key, window_seconds)
            results = await pipe.execute()

        current_count = results[1]
        if current_count >= max_requests:
            # Over limit: remove the newly added timestamp
            await client.zrem(key, str(now))
            remaining = 0
            allowed = False
        else:
            remaining = max(0, max_requests - (current_count + 1))
            allowed = True

        info = {
            "limit": max_requests,
            "remaining": remaining,
            "reset_seconds": window_seconds,
            "tool_name": tool_name,
        }
        return allowed, info

    async def _check_in_memory(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        tool_name: str,
    ) -> tuple[bool, dict[str, Any]]:
        now = time.time()
        cutoff = now - window_seconds

        async with self._memory_lock:
            timestamps = self._memory_store.get(key, [])
            # Filter out stale timestamps
            timestamps = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= max_requests:
                remaining = 0
                allowed = False
            else:
                timestamps.append(now)
                remaining = max_requests - len(timestamps)
                allowed = True

            self._memory_store[key] = timestamps

            info = {
                "limit": max_requests,
                "remaining": remaining,
                "reset_seconds": window_seconds,
                "tool_name": tool_name,
            }
            return allowed, info

    async def close(self) -> None:
        """Close Redis connection if initialized."""
        if self._redis_client is not None:
            try:
                await self._redis_client.aclose()
            except Exception:
                pass
            self._redis_client = None
