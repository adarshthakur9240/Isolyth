"""
auth.py – JWT-Based Authentication Middleware
===============================================
Provides JWT token generation, validation, and request authentication for
the Isolyth MCP server.

Environment variables:
  JWT_SECRET_KEY  – Secret key used to sign and verify JWT tokens.
                    (default: "isolyth-dev-secret-key-change-in-production")
  JWT_ALGORITHM   – Algorithm used for JWT signing (default: "HS256")
  REQUIRE_AUTH    – Whether token authentication is strictly required.
                    "true" / "1" (default in production) or "false" / "0".
"""

import logging
import os
import time
from typing import Any

import jwt

logger = logging.getLogger("isolyth.auth")

# ── Configuration ─────────────────────────────────────────────────────────────

JWT_SECRET_KEY: str = os.environ.get(
    "JWT_SECRET_KEY",
    os.environ.get("JWT_SECRET", "isolyth-dev-secret-key-change-in-production"),
)
JWT_ALGORITHM: str = os.environ.get("JWT_ALGORITHM", "HS256")
REQUIRE_AUTH: bool = os.environ.get("REQUIRE_AUTH", "true").lower() in (
    "true",
    "1",
    "yes",
)


# ── Exception hierarchy ───────────────────────────────────────────────────────


class AuthError(Exception):
    """Base exception for authentication failures."""


class MissingTokenError(AuthError):
    """Raised when no bearer token is present in the request."""


class InvalidTokenError(AuthError):
    """Raised when the JWT signature or structure is invalid."""


class ExpiredTokenError(AuthError):
    """Raised when the JWT token has expired."""


# ── Token Generation & Verification ─────────────────────────────────────────


def create_token(
    user_id: str,
    roles: list[str] | None = None,
    expires_in_seconds: int = 3600,
    extra_claims: dict[str, Any] | None = None,
    secret_key: str | None = None,
) -> str:
    """
    Generate a signed JWT bearer token.

    Parameters
    ----------
    user_id:
        Subject identifier (stored in `sub` claim).
    roles:
        Optional list of user roles (e.g. ["admin", "developer"]).
    expires_in_seconds:
        Token lifetime in seconds (default: 1 hour).
    extra_claims:
        Optional dictionary of additional claims.
    secret_key:
        Signing key (defaults to JWT_SECRET_KEY).
    """
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": user_id,
        "iat": now,
        "exp": now + expires_in_seconds,
        "roles": roles or ["user"],
    }
    if extra_claims:
        payload.update(extra_claims)

    key = secret_key or JWT_SECRET_KEY
    return jwt.encode(payload, key, algorithm=JWT_ALGORITHM)


def verify_token(token: str, secret_key: str | None = None) -> dict[str, Any]:
    """
    Verify and decode a JWT bearer token.

    Returns the claims dictionary if valid.
    Raises `ExpiredTokenError` or `InvalidTokenError` on failure.
    """
    key = secret_key or JWT_SECRET_KEY
    try:
        payload = jwt.decode(token, key, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise ExpiredTokenError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise InvalidTokenError(f"Invalid token: {exc}") from exc


# ── Request Extraction & Authentication ─────────────────────────────────────


def extract_bearer_token(arguments: dict[str, Any] | None) -> str | None:
    """
    Extract bearer token from tool arguments or metadata.

    Looks in:
      1. `_auth_token` argument
      2. `authorization` or `auth_token` argument (with or without 'Bearer ' prefix)
      3. `_meta.authorization` or `_meta.auth_token` nested dict
    """
    if not arguments:
        return None

    # Check top-level argument names
    for key in ("_auth_token", "auth_token", "authorization", "bearer_token"):
        val = arguments.get(key)
        if isinstance(val, str) and val.strip():
            token_str = val.strip()
            if token_str.lower().startswith("bearer "):
                return token_str[7:].strip()
            return token_str

    # Check nested `_meta`
    meta = arguments.get("_meta")
    if isinstance(meta, dict):
        for key in ("authorization", "auth_token", "token"):
            val = meta.get(key)
            if isinstance(val, str) and val.strip():
                token_str = val.strip()
                if token_str.lower().startswith("bearer "):
                    return token_str[7:].strip()
                return token_str

    return None


def authenticate_request(
    arguments: dict[str, Any] | None,
    require_auth: bool | None = None,
) -> dict[str, Any]:
    """
    Authenticate an incoming tool request.

    Returns user claims dict (containing at least `sub` and `roles`).
    Raises `AuthError` subclass if authentication fails.
    """
    must_auth = require_auth if require_auth is not None else REQUIRE_AUTH
    token = extract_bearer_token(arguments)

    if not token:
        if must_auth:
            raise MissingTokenError(
                "Authentication required: missing bearer token in request arguments (_auth_token or authorization header)"
            )
        return {"sub": "anonymous", "roles": ["anonymous"]}

    payload = verify_token(token)
    logger.info("Request authenticated", extra={"user_id": payload.get("sub")})
    return payload


# ── Local Development Token Helper ──────────────────────────────────────────


def generate_dev_token(user_id: str = "dev-user") -> str:
    """Convenience helper to generate a local testing token (valid 24h)."""
    return create_token(
        user_id=user_id,
        roles=["admin", "developer"],
        expires_in_seconds=86400,
    )


if __name__ == "__main__":
    token = generate_dev_token()
    print("Isolyth Local Development JWT Token:")
    print("=" * 60)
    print(token)
    print("=" * 60)
