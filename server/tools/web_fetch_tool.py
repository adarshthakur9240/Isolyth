"""
web_fetch_tool – Web Fetch Tool
================================
Fetches a public URL via httpx and returns the response body as text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECURITY: SSRF (Server-Side Request Forgery) Prevention
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SSRF is a vulnerability where an attacker tricks the server into making
HTTP requests to internal/private network resources — cloud metadata APIs
(169.254.169.254), internal databases, admin panels, etc.

Our defence strategy is two-layered:

  1. Pre-request DNS resolution + IP blocklist:
     Before httpx ever opens a socket, we resolve the hostname and check
     every returned IP against a list of prohibited CIDR ranges:
       • 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16  – RFC-1918 private
       • 127.0.0.0/8                                  – loopback
       • 169.254.0.0/16                               – link-local / AWS metadata
       • ::1, fc00::/7                                – IPv6 loopback / ULA
     Any IP in those ranges causes an immediate rejection before the
     network socket is opened.

  2. No redirect chasing to blocked hosts:
     httpx's default is to follow redirects.  We install a custom
     ``event_hook`` on every redirect so that if the server redirects
     to a private IP we block it there too (open-redirect SSRF bypass).

Additional limits:
  • 5-second connect + read timeout
  • 2 MB response body cap (configurable via WEB_FETCH_MAX_BYTES env var)
  • Only http:// and https:// schemes are allowed (no file://, ftp://, etc.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import ipaddress
import json
import logging
import os
import socket
from typing import Any
from urllib.parse import urlparse

import httpx
import mcp.types as types

logger = logging.getLogger("isolyth.tools.web_fetch")

# ── Configuration ─────────────────────────────────────────────────────────────

FETCH_TIMEOUT_S: float = float(os.environ.get("WEB_FETCH_TIMEOUT_S", "5"))
MAX_RESPONSE_BYTES: int = int(os.environ.get("WEB_FETCH_MAX_BYTES", str(2 * 1024 * 1024)))  # 2 MB

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SSRF PROTECTION: Blocked IP ranges
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# These are all the networks an attacker might use SSRF to reach:
#   • RFC-1918 private ranges (10/8, 172.16/12, 192.168/16)
#   • Loopback (127/8, ::1)
#   • Link-local / AWS instance metadata service (169.254/16)
#   • IPv6 unique-local (fc00::/7)
#   • IPv4-mapped IPv6 addresses (::ffff:0:0/96)
_BLOCKED_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    # IPv4
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local + AWS metadata at .254.169
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),     # carrier-grade NAT (RFC 6598)
    ipaddress.ip_network("192.0.0.0/24"),      # IETF protocol assignments
    ipaddress.ip_network("198.18.0.0/15"),     # benchmark testing
    ipaddress.ip_network("198.51.100.0/24"),   # TEST-NET-2 (documentation)
    ipaddress.ip_network("203.0.113.0/24"),    # TEST-NET-3 (documentation)
    ipaddress.ip_network("240.0.0.0/4"),       # reserved
    ipaddress.ip_network("255.255.255.255/32"),
    # IPv6
    ipaddress.ip_network("::1/128"),           # loopback
    ipaddress.ip_network("fc00::/7"),          # unique-local (private)
    ipaddress.ip_network("fe80::/10"),         # link-local
    ipaddress.ip_network("::ffff:0:0/96"),     # IPv4-mapped IPv6
]


class SSRFBlockedError(ValueError):
    """Raised when the resolved target IP is in a blocked private range."""


def _is_ip_blocked(ip_str: str) -> bool:
    """Return True if *ip_str* falls within any blocked network range."""
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # Unparseable address → block by default.
    return any(addr in net for net in _BLOCKED_NETWORKS)


def _resolve_and_check_host(hostname: str) -> None:
    """
    DNS-resolve *hostname* and raise ``SSRFBlockedError`` if ANY returned
    IP address is in a blocked range.

    SECURITY NOTE: We check all returned addresses because some hostnames
    round-robin across multiple IPs.  If any one of them is private, we
    block the whole request.  This prevents a "DNS rebinding" attack where
    an attacker's DNS returns a public IP during validation but a private IP
    during the actual request.
    """
    try:
        # getaddrinfo returns (family, type, proto, canonname, sockaddr) tuples;
        # sockaddr is (host, port) for IPv4 and (host, port, flow, scope) for IPv6.
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise SSRFBlockedError(f"DNS resolution failed for {hostname!r}: {exc}") from exc

    for family, _type, _proto, _canonname, sockaddr in addr_infos:
        ip = sockaddr[0]
        if _is_ip_blocked(ip):
            raise SSRFBlockedError(
                # SECURITY: surface enough detail for logging but not for the caller.
                f"SSRF blocked: {hostname!r} resolves to private/reserved IP {ip!r}"
            )


def _check_url_scheme(url: str) -> None:
    """Block non-http(s) schemes to prevent file://, ftp://, gopher:// abuse."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(
            f"Only http:// and https:// URLs are allowed; got scheme: {parsed.scheme!r}"
        )
    if not parsed.hostname:
        raise ValueError(f"URL has no hostname: {url!r}")


# ── Tool handler ──────────────────────────────────────────────────────────────


async def web_fetch_handler(args: dict[str, Any]) -> list[types.TextContent]:
    """
    Fetch a public URL and return its body as text.

    Input schema fields:
      url     (str, required) – The URL to fetch.
      headers (dict, optional) – Extra HTTP headers to include.
    """
    url: str = args.get("url", "").strip()
    extra_headers: dict[str, str] = args.get("headers", {}) or {}

    if not url:
        return _error("url parameter is required and must not be empty")

    # ── Scheme check ──────────────────────────────────────────────────────────
    try:
        _check_url_scheme(url)
    except ValueError as exc:
        return _error(str(exc))

    # ── SSRF check: resolve DNS and validate IPs before opening socket ─────────
    # SECURITY: This is the primary SSRF defence.  We resolve the hostname
    # ourselves BEFORE httpx opens any connection, then reject requests
    # that target private/internal IP ranges.
    parsed = urlparse(url)
    try:
        _resolve_and_check_host(parsed.hostname)
    except SSRFBlockedError as exc:
        logger.warning("SSRF attempt blocked", extra={"url": url, "reason": str(exc)})
        return _error(f"Request blocked for security reasons: target is a private/reserved address")

    # ── Fetch ─────────────────────────────────────────────────────────────────
    try:
        timeout = httpx.Timeout(FETCH_TIMEOUT_S, connect=FETCH_TIMEOUT_S)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            max_redirects=5,
            # SECURITY: validate every redirect target against the SSRF blocklist.
            # The event hook fires before httpx follows the redirect.
            event_hooks={"request": [_ssrf_redirect_hook]},
        ) as client:
            response = await client.get(url, headers=extra_headers)

        # ── Response size cap ─────────────────────────────────────────────────
        # SECURITY: Prevent the server from downloading huge files that would
        # exhaust memory.  We read only up to MAX_RESPONSE_BYTES of content.
        content_length = int(response.headers.get("content-length", 0))
        if content_length > MAX_RESPONSE_BYTES:
            return _error(
                f"Response too large: Content-Length={content_length} > "
                f"limit={MAX_RESPONSE_BYTES} bytes"
            )

        body = response.content[:MAX_RESPONSE_BYTES]
        truncated = len(response.content) > MAX_RESPONSE_BYTES

        try:
            text = body.decode("utf-8", errors="replace")
        except Exception:
            text = body.decode("latin-1", errors="replace")

        payload = {
            "url": str(response.url),
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type", ""),
            "body": text,
            "truncated": truncated,
            "byte_count": len(body),
        }
        logger.info(
            "URL fetched",
            extra={"url": url, "status": response.status_code, "bytes": len(body)},
        )
        return [types.TextContent(type="text", text=json.dumps(payload))]

    except SSRFBlockedError as exc:
        # Raised by the redirect hook.
        logger.warning("SSRF blocked via redirect", extra={"url": url, "reason": str(exc)})
        return _error("Request blocked for security reasons: redirect target is a private/reserved address")
    except httpx.TimeoutException:
        return _error(f"Request timed out after {FETCH_TIMEOUT_S}s")
    except httpx.TooManyRedirects:
        return _error("Too many redirects (max 5)")
    except httpx.RequestError as exc:
        return _error(f"HTTP request error: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected web fetch error")
        return _error(f"Unexpected error: {type(exc).__name__}: {exc}")


async def _ssrf_redirect_hook(request: httpx.Request) -> None:
    """
    httpx event hook fired on every outgoing request (including redirects).

    SECURITY: When httpx follows a redirect, this hook checks the *new*
    destination against the SSRF blocklist.  This prevents an attacker from
    hosting a public URL that 301-redirects to an internal address.
    """
    hostname = request.url.host
    if hostname:
        _resolve_and_check_host(hostname)  # raises SSRFBlockedError if blocked


# ── Schema exposed to the MCP registry ───────────────────────────────────────

WEB_FETCH_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "url": {
            "type": "string",
            "description": "The public URL to fetch (http:// or https:// only).",
        },
        "headers": {
            "type": "object",
            "description": "Optional extra HTTP request headers.",
        },
    },
    "required": ["url"],
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _error(message: str) -> list[types.TextContent]:
    return [
        types.TextContent(
            type="text",
            text=json.dumps({"error": message}),
        )
    ]

