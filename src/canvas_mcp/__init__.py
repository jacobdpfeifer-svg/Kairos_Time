"""
Canvas MCP Server — Kairos local-first student platform.

Student-only stdio MCP server.
"""

__version__ = "1.11.0"
__author__ = "Kairos; upstream canvas-mcp (Vishal Sachdev)"
__email__ = ""
__description__ = "Local-first student Canvas MCP (Kairos)"

from typing import Any

__all__ = ["main", "__version__"]


def __getattr__(name: str) -> Any:
    # Lazy: the desktop app runs canvas_mcp.core.* as short subprocesses, and
    # importing the MCP server (fastmcp + mcp) here added ~0.8 s to each one.
    if name == "main":
        from .server import main

        return main
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
