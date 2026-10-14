"""Core utilities for Canvas MCP server.

Re-exports load on first use: the desktop app runs local-file cores
(`canvas_mcp.core.week_plan`, `.study`, `.commitment`, ...) as short
subprocesses, and importing the HTTP client here slowed every one of them.
"""

from importlib import import_module
from typing import Any

_EXPORTS = {
    'make_canvas_request': '.client',
    'fetch_all_paginated_results': '.client',
    'cleanup_http_client': '.client',
    'get_course_id': '.cache',
    'get_course_code': '.cache',
    'refresh_course_cache': '.cache',
    'validate_params': '.validation',
    'validate_parameter': '.validation',
    'format_error': '.validation',
    'is_error_response': '.validation',
    'format_date': '.dates',
    'parse_date': '.dates',
    'truncate_text': '.dates',
    'get_config': '.config',
    'reset_config': '.config',
    'validate_config': '.config',
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    module = _EXPORTS.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    # The module is selected exclusively from the constant _EXPORTS whitelist;
    # no user-controlled import path reaches this call.
    value = getattr(import_module(module, __name__), name)  # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import
    globals()[name] = value
    return value
