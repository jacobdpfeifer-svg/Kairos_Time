"""Configuration management for Canvas MCP server."""

import os
import re
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

from .logging import log_error, log_info, log_warning

# Load environment variables from .env file
load_dotenv()

_INVALID_INT_ENV_VARS: dict[str, str] = {}
_INVALID_FLOAT_ENV_VARS: dict[str, str] = {}

# Canonical names of the student write tools an operator may enable via
# STUDENT_WRITE_TOOLS. Declared here rather than in the tools package so config
# stays free of imports from it. Quiz-taking is deliberately absent: it is an
# academic-integrity decision gated behind its own separate flag, not something
# an operator can switch on by naming it in this allowlist.
STUDENT_WRITE_TOOL_NAMES = frozenset({
    "submit_assignment",
    "comment_on_my_submission",
    "mark_module_item_done",
})

# Obvious .env placeholders (e.g. "your_canvas_api_token_here", E2E "your…") —
# not real Canvas PATs. Unit tests use values like "test-token" which must pass.
_PLACEHOLDER_TOKEN_RE = re.compile(
    r"^(your([_-].*)?|changeme([_-].*)?|replace([_-]?me)?([_-].*)?|"
    r"placeholder([_-].*)?|xxx+|insert([_-].*)?|dummy([_-].*)?|example([_-].*)?)$",
    re.IGNORECASE,
)


def is_placeholder_canvas_token(token: str) -> bool:
    """True when ``token`` is missing or an obvious .env template placeholder."""
    t = (token or "").strip()
    if not t:
        return True
    if _PLACEHOLDER_TOKEN_RE.match(t):
        return True
    # Prefix forms like "your…" / "your_canvas_api_token_here" (len ~26 in E2E).
    lower = t.lower()
    if lower.startswith("your") and len(t) <= 64:
        return True
    return False


def _normalize_canvas_url(raw: str) -> str:
    """Normalize ``CANVAS_API_URL`` to the canonical ``…/api/v1`` form.

    Canvas REST endpoints live under ``/api/v1``. Users frequently enter just
    the base host (e.g. ``https://canvas.school.edu``); requests without the
    suffix make Canvas issue a 302 redirect to SSO login, which surfaces as a
    misleading ``HTTP error: 302`` that looks like a bad token. Canonicalize
    the path to exactly ``/api/v1`` (dropping any extra segments copied from a
    browser, plus stray query strings / fragments) so all of these resolve to
    the same URL:

    - ``https://canvas.school.edu``             → ``https://canvas.school.edu/api/v1``
    - ``https://canvas.school.edu/``            → ``https://canvas.school.edu/api/v1``
    - ``https://canvas.school.edu/api/v1``      → unchanged
    - ``https://canvas.school.edu/api/v1/``     → ``https://canvas.school.edu/api/v1``
    - ``https://canvas.school.edu/api/v1/foo``  → ``https://canvas.school.edu/api/v1``
    - ``https://canvas.school.edu/api/v1?x=1``  → ``https://canvas.school.edu/api/v1``

    An explicit ``/api/v<N>`` version segment is preserved (only trailing
    sub-paths after it are dropped), so a deliberately-set ``/api/v2`` is never
    silently downgraded to ``/api/v1``.

    A scheme-less input (e.g. ``canvas.school.edu``) is returned unchanged so
    ``validate_config()`` can flag the missing ``https://`` rather than this
    silently producing a relative-path URL.
    """
    url = raw.strip()
    if not url:
        return ""

    parsed = urlparse(url)
    # Without a scheme, urlparse puts the host in ``path`` and leaves
    # ``netloc`` empty — we can't reliably rebuild it, so leave it for the
    # validator to warn about.
    if not parsed.scheme or not parsed.netloc:
        return url

    # Preserve an existing ``/api/v<N>`` version segment (truncating any extra
    # path after it), matching only at a segment boundary so a real version
    # like ``/api/v2`` is kept rather than rewritten. When the path carries no
    # version segment, append the canonical ``/api/v1``.
    version = re.search(r"/api/v\d+(?=/|$)", parsed.path)
    path = parsed.path[: version.end()] if version else "/api/v1"
    return urlunparse(parsed._replace(path=path, params="", query="", fragment=""))


def _is_loopback(hostname: str | None) -> bool:
    """True for addresses that never leave the machine.

    The only place cleartext HTTP is defensible is a local development Canvas,
    where there is no network path to sniff.
    """
    if not hostname:
        return False
    host = hostname.strip().strip("[]").lower()
    if host in {"localhost", "::1"}:
        return True
    try:
        import ipaddress

        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() == "true"


def validate_canvas_url_scheme() -> bool:
    """Reject a cleartext Canvas origin. Returns False when startup must abort.

    Every Canvas request carries the token in an Authorization header, so an
    http:// origin puts a credential for student records on the wire for anyone
    on the path. A warning is not proportionate to that.

    Called from startup (stdio). validate_config() covers missing URL/token;
    this function only owns the cleartext scheme case.
    """
    from urllib.parse import urlparse

    config = get_config()
    parsed = urlparse(config.canvas_api_url)
    if not parsed.scheme or parsed.scheme == "https" or not parsed.netloc:
        # Missing scheme / missing host are reported separately by
        # validate_config(); this function only owns the cleartext case.
        return True
    if parsed.scheme != "http":
        return True

    if _is_loopback(parsed.hostname) and _bool_env("CANVAS_ALLOW_INSECURE_HTTP", False):
        log_warning(
            "CANVAS_API_URL uses cleartext http:// to a loopback address; "
            "allowed because CANVAS_ALLOW_INSECURE_HTTP is set. Never use "
            "this against a real Canvas instance.",
            current_url=config.canvas_api_url,
        )
        return True

    log_error(
        "CANVAS_API_URL must use 'https://'. The Canvas API token is sent "
        "on every request, so a cleartext URL exposes it on the network. "
        "For local development against a loopback address only, set "
        "CANVAS_ALLOW_INSECURE_HTTP=true.",
    )
    return False


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError:
        _INVALID_INT_ENV_VARS[name] = value
        return default


def _float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    try:
        parsed = float(value)
    except ValueError:
        _INVALID_FLOAT_ENV_VARS[name] = value
        return default
    if parsed <= 0:
        _INVALID_FLOAT_ENV_VARS[name] = value
        return default
    return parsed


class Config:
    """Configuration class for Canvas MCP server."""

    def __init__(self) -> None:
        # Required configuration
        self.canvas_api_token = os.getenv("CANVAS_API_TOKEN", "")
        # Keep the configured (pre-normalization) value so validate_config()
        # can report the normalization delta from the same read that produced
        # canvas_api_url. Whitespace-trimmed, matching the normalizer's input.
        self.canvas_api_url_configured = os.getenv("CANVAS_API_URL", "").strip()
        self.canvas_api_url = _normalize_canvas_url(self.canvas_api_url_configured)

        # Optional configuration with defaults
        self.mcp_server_name = os.getenv("MCP_SERVER_NAME", "kairos-canvas-mcp")
        self.debug = _bool_env("DEBUG", False)
        self.api_timeout = _int_env("API_TIMEOUT", 30)
        self.cache_ttl = _int_env("CACHE_TTL", 300)
        self.max_concurrent_requests = _int_env("MAX_CONCURRENT_REQUESTS", 10)
        self.read_file_max_size_mb = _float_env("READ_FILE_MAX_SIZE_MB", 100.0)

        # Development configuration
        self.log_level = os.getenv("LOG_LEVEL", "INFO").upper()
        self.log_api_requests = _bool_env("LOG_API_REQUESTS", False)

        # Privacy and security configuration
        # Local-first single-machine beta: anonymization off by default.
        # Revisit if multi-user machines share a daemon.
        self.enable_data_anonymization = _bool_env("ENABLE_DATA_ANONYMIZATION", False)
        self.anonymization_debug = _bool_env("ANONYMIZATION_DEBUG", False)
        self.log_redact_pii = _bool_env("LOG_REDACT_PII", True)

        # Audit logging configuration
        self.log_access_events = _bool_env("LOG_ACCESS_EVENTS", False)
        self.log_execution_events = _bool_env("LOG_EXECUTION_EVENTS", False)
        self.audit_log_dir = os.getenv("AUDIT_LOG_DIR", "")

        # Optional metadata
        self.institution_name = os.getenv("INSTITUTION_NAME", "")
        self.timezone = os.getenv("TIMEZONE", "UTC")

        # This fork is student-only; CANVAS_ROLE is coerced in validate_config().
        self.canvas_role = os.getenv("CANVAS_ROLE", "student").lower()

        # --- Student write tools (#170) ---
        # Campus-wide operator ceiling. Empty (the default) means NO student write
        # tool is registered, so an unlisted tool never enters the MCP tool list at
        # all. Accepts comma- and/or space-separated tool names.
        self.student_write_tools = frozenset(
            name.strip()
            for name in os.getenv("STUDENT_WRITE_TOOLS", "").replace(",", " ").split()
            if name.strip()
        )


# Global configuration instance
_config: Config | None = None


def get_config() -> Config:
    """Get the global configuration instance."""
    global _config
    if _config is None:
        _config = Config()
    return _config


def reset_config() -> None:
    """Discard the cached configuration singleton.

    The next ``get_config()`` call rebuilds it from the current environment.
    Used by tests that patch environment variables so they don't read stale
    config captured at first access.

    Also clears the invalid-env-var caches, which are populated during
    ``Config.__init__`` and read by ``validate_config()``; otherwise a stale
    entry from a prior parse would produce a warning inconsistent with the
    rebuilt configuration's environment.

    Scope: this resets the config singleton only. Derived state built from
    config elsewhere is **not** reset here — notably the stdio HTTP client in
    ``core.client``, which captures the ``Authorization`` token at creation and
    is reused until its event loop closes. A caller rotating ``CANVAS_API_TOKEN``
    at runtime must also ``await cleanup_http_client()`` so the next request
    rebuilds the client with the new credentials. (Tests mock the request layer,
    and HTTP-transport mode uses per-request clients, so neither is affected.)
    """
    global _config
    _config = None
    _INVALID_INT_ENV_VARS.clear()
    _INVALID_FLOAT_ENV_VARS.clear()


def validate_config() -> bool:
    """Validate that required configuration is present."""
    config = get_config()
    unimplemented_env_vars = {
        "TOKEN_STORAGE_BACKEND": "credential storage backend selection is not enforced yet",  # nosec B105 - diagnostic text, not a secret
        "TOKEN_ENVELOPE_KEY_SOURCE": "credential envelope encryption is not enforced yet",  # nosec B105 - diagnostic text, not a secret
        "MCP_CLIENT_AUTH_MODE": "MCP client authentication is not implemented for stdio transport",
        "MCP_CLIENT_API_KEY_REQUIRED": "MCP client authentication is not implemented for stdio transport",
        "MCP_CLIENT_CERT_AUTHORITY": "MCP client authentication is not implemented for stdio transport",
        "LOG_ROTATION_DAYS": "log rotation is not enforced yet",
        "LOG_RETENTION_DAYS": "log retention is not enforced yet",
        "LOG_DESTINATION": "log destinations are not configurable yet",
        "SIEM_FORWARDING_ENABLED": "SIEM forwarding is not implemented yet",
        "MCP_BIND_HOST": "MCP uses stdio transport and does not bind network sockets",
        "MCP_BIND_PORT": "MCP uses stdio transport and does not bind network sockets",
        "FIREWALL_HINT": "firewall hints are documentation-only",
    }

    if not config.canvas_api_token or is_placeholder_canvas_token(config.canvas_api_token):
        log_error("CANVAS_API_TOKEN environment variable is required")
        if config.canvas_api_token and is_placeholder_canvas_token(config.canvas_api_token):
            log_error(
                "CANVAS_API_TOKEN looks like a placeholder (e.g. your_…); "
                "create a real Canvas PAT or remove the var so --test fails as unset"
            )
        else:
            log_error("Please set CANVAS_API_TOKEN in your .env file")
        return False

    if not config.canvas_api_url:
        log_error("CANVAS_API_URL environment variable is required")
        log_error("Please set CANVAS_API_URL in your .env file")
        return False

    # Diagnose a CANVAS_API_URL that can't reach Canvas. The triple-slash case
    # (e.g. 'https:///host') is the subtle one: it has a scheme but an empty
    # netloc, so the normalizer leaves it untouched. Report the specific defect
    # rather than a one-size-fits-all message.
    parsed_url = urlparse(config.canvas_api_url)
    if parsed_url.scheme not in ("http", "https"):
        log_warning(
            "CANVAS_API_URL should start with 'https://'",
            current_url=config.canvas_api_url,
        )
    elif not parsed_url.netloc:
        log_warning(
            "CANVAS_API_URL is missing a hostname",
            current_url=config.canvas_api_url,
        )
    elif not validate_canvas_url_scheme():
        return False

    if (
        config.canvas_api_url_configured
        and config.canvas_api_url_configured != config.canvas_api_url
    ):
        log_info(
            "CANVAS_API_URL normalized to canonical form",
            configured=config.canvas_api_url_configured,
            effective=config.canvas_api_url,
        )

    # This fork is student-only; coerce any other profile.
    if config.canvas_role != "student":
        log_warning(
            f"CANVAS_ROLE={config.canvas_role} ignored; this fork is student-only"
        )
        config.canvas_role = "student"

    unknown_write_tools = config.student_write_tools - STUDENT_WRITE_TOOL_NAMES
    if unknown_write_tools:
        log_warning(
            "STUDENT_WRITE_TOOLS names unknown tools; they will be ignored: "
            f"{', '.join(sorted(unknown_write_tools))}"
        )

    for env_name, env_value in _INVALID_INT_ENV_VARS.items():
        log_warning(
            f"{env_name} expects an integer; using default value "
            f"(got '{env_value}')"
        )

    for env_name, env_value in _INVALID_FLOAT_ENV_VARS.items():
        log_warning(
            f"{env_name} expects a positive number; using default value "
            f"(got '{env_value}')"
        )

    for env_name, note in unimplemented_env_vars.items():
        if os.getenv(env_name):
            log_warning(f"{env_name} is set but {note}.")

    return True
