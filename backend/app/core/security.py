"""
Security middleware for ArkManiaGest.

Provides:
  - Per-IP in-memory rate limiting with temporary IP blocking
  - HTTP security headers (CSP, HSTS, X-Frame-Options, …)
  - Optional IP allowlist
  - Request body size limiter

X-Forwarded-For trust model
----------------------------
``X-Forwarded-For`` is a client-controlled header and must never be trusted
unconditionally.  :func:`_extract_client_ip` only honours it when the direct
TCP connection comes from a known reverse-proxy address listed in
:data:`_TRUSTED_PROXY_IPS`.  Add your nginx / load-balancer IP(s) there.
"""
import time
from collections import defaultdict
from typing import Optional, Set

from fastapi import Request, Response, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# IP addresses that are allowed to set X-Forwarded-For / X-Real-IP.
# Only loopback and private ranges are trusted by default; extend this set
# to include your nginx or load-balancer IP when running behind a reverse proxy.
_TRUSTED_PROXY_IPS: frozenset[str] = frozenset({
    "127.0.0.1",
    "::1",
    # Example: add "10.0.0.1" or your specific proxy IP here
})


# =============================================
#  Rate-limit store (in-memory, per IP)
# =============================================

class RateLimitStore:
    """
    In-memory request counter used by :class:`RateLimitMiddleware`.

    Tracks the timestamps of recent requests per client IP and maintains a
    separate blocklist for IPs that have exceeded the limit on sensitive
    endpoints.
    """

    def __init__(self):
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._blocked:  dict[str, float]       = {}  # ip -> unblock timestamp

    def is_blocked(self, ip: str) -> bool:
        """Return True if *ip* is currently in the blocklist."""
        if ip in self._blocked:
            if time.time() < self._blocked[ip]:
                return True
            # Block has expired — remove it
            del self._blocked[ip]
        return False

    def block(self, ip: str, duration: int = 300) -> None:
        """
        Add *ip* to the blocklist for *duration* seconds.

        Args:
            ip:       Client IP address.
            duration: Block duration in seconds (default: 5 minutes).
        """
        self._blocked[ip] = time.time() + duration

    def record_request(self, ip: str, window: int = 60) -> int:
        """
        Record a request from *ip* and return the request count in *window*.

        Timestamps older than *window* seconds are pruned before counting.

        Args:
            ip:     Client IP address.
            window: Sliding window size in seconds (default: 60).

        Returns:
            Number of requests from *ip* within the current window.
        """
        now = time.time()
        cutoff = now - window
        self._requests[ip] = [t for t in self._requests[ip] if t > cutoff]
        self._requests[ip].append(now)
        return len(self._requests[ip])

    # Keep backward-compatible alias
    add_request = record_request

    def cleanup(self) -> None:
        """Remove stale entries to prevent unbounded memory growth."""
        now = time.time()
        expired_ips = [
            ip for ip, reqs in self._requests.items()
            if not reqs or reqs[-1] < now - 120
        ]
        for ip in expired_ips:
            del self._requests[ip]


_rate_store = RateLimitStore()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Sliding-window rate limiter applied per client IP.

    Two separate limits apply:
      - ``general_limit``: requests per minute for all paths (default: 120)
      - ``auth_limit``:   requests per minute for login / setup paths (default: 10)

    IPs that exceed the auth limit are temporarily blocked for
    ``block_duration`` seconds.
    """

    # Endpoints that the UI polls frequently (status pings, update progress
    # drawer) -- exempt from the per-IP counter so an active admin session
    # can't lock itself out by reloading the page a few times.
    POLLING_EXEMPT_PATHS = (
        "/api/v1/settings/status",
        "/api/v1/system-update/status",
        # Image proxy: per-request bandwidth is bounded (PNG-only,
        # disk-cached, returns 304/cache-headers), and a single
        # blueprint-list paint can fan out 50+ requests at once which
        # would otherwise eat a chunk of the per-IP budget for no
        # security benefit.
        "/api/v1/market/thumb/",
        "/health",
    )

    def __init__(
        self,
        app,
        general_limit:  int = 300,
        auth_limit:     int = 10,
        window:         int = 60,
        block_duration: int = 300,
    ):
        super().__init__(app)
        self.general_limit  = general_limit
        self.auth_limit     = auth_limit
        self.window         = window
        self.block_duration = block_duration

    async def dispatch(self, request: Request, call_next):
        ip = _extract_client_ip(request)

        # Reject blocked IPs immediately
        if _rate_store.is_blocked(ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again in a few minutes."},
                headers={"Retry-After": "300"},
            )

        path    = request.url.path

        # Polling endpoints are excluded from rate limiting entirely.  They
        # carry no state-change risk and the UI hits them on a tight loop
        # by design.
        if any(path.startswith(p) for p in self.POLLING_EXEMPT_PATHS):
            return await call_next(request)

        # Apply a stricter limit to authentication endpoints
        is_auth = any(x in path for x in ["/auth/login", "/settings/setup"])
        limit   = self.auth_limit if is_auth else self.general_limit

        count = _rate_store.record_request(ip, self.window)

        if count > limit:
            if is_auth:
                # Block the IP after too many failed auth attempts
                _rate_store.block(ip, self.block_duration)
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded."},
                headers={"Retry-After": str(self.window)},
            )

        response = await call_next(request)

        # Expose rate-limit info through response headers
        response.headers["X-RateLimit-Limit"]     = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))

        return response


# =============================================
#  Security headers
# =============================================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add a standard set of security headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"]         = "DENY"
        response.headers["X-XSS-Protection"]        = "1; mode=block"
        response.headers["Referrer-Policy"]          = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"]       = "camera=(), microphone=(), geolocation=()"

        # HSTS — only meaningful over HTTPS
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        # Restrictive CSP for a pure JSON API (no HTML served)
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )

        # Prevent caching of API responses that may contain sensitive data
        if "/api/" in request.url.path:
            response.headers["Cache-Control"] = (
                "no-store, no-cache, must-revalidate, private"
            )
            response.headers["Pragma"] = "no-cache"

        return response


# =============================================
#  IP allowlist (optional)
# =============================================

class IPWhitelistMiddleware(BaseHTTPMiddleware):
    """
    Reject requests from IPs not in the configured allowlist.

    Only active when ``ALLOWED_IPS`` is set in the environment.

    Args:
        allowed_ips: Set of IP address strings that are permitted.
    """

    def __init__(self, app, allowed_ips: Optional[Set[str]] = None):
        super().__init__(app)
        self.allowed_ips = allowed_ips

    async def dispatch(self, request: Request, call_next):
        if self.allowed_ips is None:
            return await call_next(request)

        ip = _extract_client_ip(request)
        if ip not in self.allowed_ips:
            return JSONResponse(
                status_code=403,
                content={"detail": "Access denied."},
            )

        return await call_next(request)


# =============================================
#  Request size limiter
# =============================================

class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Reject requests whose ``Content-Length`` exceeds ``max_size`` bytes.

    A handful of upload endpoints (Beacon blueprint imports, JSON
    blueprint dumps, etc.) legitimately need larger request bodies and
    enforce their own per-route cap.  Those paths are listed in
    :attr:`LARGE_UPLOAD_PATHS` and bypass the global limit so the
    global default can stay tight.

    Args:
        max_size: Maximum allowed request body size in bytes (default: 10 MB).
    """

    # Endpoints that handle file uploads bigger than the global cap.
    # The endpoints themselves enforce a tighter, route-specific limit
    # (see e.g. _BEACON_MAX_UPLOAD_BYTES in routes/blueprints.py) so a
    # malicious client can't push 4 GB of garbage at us.
    LARGE_UPLOAD_PATHS: tuple[str, ...] = (
        "/api/v1/blueprints/import-beacondata",
        "/api/v1/blueprints/import",
    )

    def __init__(self, app, max_size: int = 10 * 1024 * 1024):
        super().__init__(app)
        self.max_size = max_size

    async def dispatch(self, request: Request, call_next):
        # Skip the size check entirely for whitelisted upload endpoints --
        # they enforce their own per-route cap before the body is read.
        if request.url.path in self.LARGE_UPLOAD_PATHS:
            return await call_next(request)

        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.max_size:
            return JSONResponse(
                status_code=413,
                content={
                    "detail": (
                        f"Request too large. "
                        f"Max: {self.max_size // 1024 // 1024}MB"
                    )
                },
            )
        return await call_next(request)


# =============================================
#  Helpers
# =============================================

def _extract_client_ip(request: Request) -> str:
    """
    Return the real client IP address.

    ``X-Forwarded-For`` and ``X-Real-IP`` are only honoured when the direct
    TCP peer is listed in :data:`_TRUSTED_PROXY_IPS`.  This prevents a
    malicious client from spoofing the header to bypass rate limiting or
    the IP allowlist.

    When running behind nginx on the same host, add the nginx IP to
    ``_TRUSTED_PROXY_IPS`` (usually ``127.0.0.1`` for local reverse proxies).

    Args:
        request: The incoming Starlette/FastAPI request.

    Returns:
        IP address string, or ``"unknown"`` if it cannot be determined.
    """
    direct_ip = request.client.host if request.client else "unknown"

    # Only trust forwarded-for headers from known proxy IPs
    if direct_ip in _TRUSTED_PROXY_IPS:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()

    return direct_ip


# Backward-compatible alias
_get_client_ip = _extract_client_ip
