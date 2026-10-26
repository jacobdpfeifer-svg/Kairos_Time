#!/usr/bin/env python3
"""
Canvas MCP Server — Kairos student platform.

Student-only tools over stdio. School from schools/{slug}.yaml.
"""

import argparse
import asyncio
import sys

from fastmcp import FastMCP

from .core.config import get_config, validate_config
from .core.logging import log_error, log_info, log_warning
from .core.tool_results import install_tool_result_contract
from .resources import register_resources_and_prompts
from .tools import (
    register_course_tools,
    register_discovery_tools,
    register_self_identity_tools,
    register_shared_assignment_tools,
    register_shared_content_tools,
    register_shared_discussion_tools,
    register_shared_file_tools,
    register_shared_messaging_tools,
    register_shared_module_tools,
    register_student_tools,
    register_student_write_tools,
)


def create_server() -> FastMCP:
    """Create and configure the Canvas MCP server."""
    config = get_config()
    return FastMCP(name=config.mcp_server_name)


def register_all_tools(mcp: FastMCP, role: str = "student") -> None:
    """Register student + shared Canvas tools only."""
    if role != "student":
        log_warning(f"Ignoring role '{role}'; this fork is student-only")
    log_info("Registering Canvas MCP tools (role: student)...")
    install_tool_result_contract(mcp)

    register_course_tools(mcp)
    register_shared_content_tools(mcp)
    register_shared_assignment_tools(mcp)
    register_shared_discussion_tools(mcp)
    register_shared_module_tools(mcp)
    register_shared_file_tools(mcp)
    register_shared_messaging_tools(mcp)
    register_discovery_tools(mcp)
    register_self_identity_tools(mcp)
    register_student_tools(mcp)
    register_student_write_tools(mcp)
    register_resources_and_prompts(mcp)

    log_info("Student Canvas MCP tools registered successfully!")


async def _validate_token() -> tuple[bool, str]:
    """Validate the Canvas API token by calling /users/self."""
    from .core.client import make_canvas_request

    try:
        response = await make_canvas_request("get", "/users/self")
        if isinstance(response, dict) and "error" in response:
            return (False, f"Token validation failed: {response['error']}")
        user_name = response.get("name", "Unknown") if isinstance(response, dict) else "Unknown"
        return (True, f"Authenticated as: {user_name}")
    except Exception as e:
        return (False, f"Token validation error: {type(e).__name__}: {e}")


def test_connection() -> bool:
    """Test the Canvas API connection."""
    log_info("Testing Canvas API connection...")
    try:
        ok, message = asyncio.run(_validate_token())
        if ok:
            log_info(f"✓ {message}")
            return True
        log_error(message)
        return False
    except Exception as e:
        log_error("Connection test failed", exc=e)
        return False
    finally:
        from .core import client as _client_module
        if hasattr(_client_module, "_http_client_manager"):
            _client_module._http_client_manager.reset()
        else:
            _client_module.http_client = None
            if hasattr(_client_module, "_http_client_loop_ref"):
                _client_module._http_client_loop_ref = None
            _client_module._request_semaphore = None
            if hasattr(_client_module, "_semaphore_loop_ref"):
                _client_module._semaphore_loop_ref = None


def main() -> None:
    """Main entry point for the Canvas MCP server (stdio only)."""
    parser = argparse.ArgumentParser(
        description="Kairos Canvas MCP Server (student-only, stdio)"
    )
    parser.add_argument("--test", action="store_true", help="Test Canvas API connection and exit")
    parser.add_argument("--config", action="store_true", help="Show current configuration and exit")
    args = parser.parse_args()

    config = get_config()
    config.canvas_role = "student"

    if not validate_config():
        log_error("Please check your .env file configuration")
        log_error("Use the env.template file as a reference")
        sys.exit(1)

    if args.config:
        print("Canvas MCP Server Configuration:", file=sys.stderr)
        print(f"  Server Name: {config.mcp_server_name}", file=sys.stderr)
        print("  Transport: stdio", file=sys.stderr)
        print("  Tool Profile: student", file=sys.stderr)
        print(f"  Canvas API URL: {config.canvas_api_url}", file=sys.stderr)
        if config.institution_name:
            print(f"  Institution: {config.institution_name}", file=sys.stderr)
        sys.exit(0)

    if args.test:
        sys.exit(0 if test_connection() else 1)

    from .core.audit import init_audit_logging
    init_audit_logging()

    log_info(f"Starting Canvas MCP server with API URL: {config.canvas_api_url}")
    try:
        ok, message = asyncio.run(_validate_token())
        if ok:
            log_info(f"✓ {message}")
        else:
            log_warning(
                f"Token validation failed: {message}. "
                "Check your CANVAS_API_TOKEN. Server will start anyway."
            )
    except Exception:
        log_warning(
            "Could not validate token on startup. Server will start anyway."
        )
    finally:
        from .core import client as _client_module
        if hasattr(_client_module, "_http_client_manager"):
            _client_module._http_client_manager.reset()
        else:
            _client_module.http_client = None
            if hasattr(_client_module, "_http_client_loop_ref"):
                _client_module._http_client_loop_ref = None
            _client_module._request_semaphore = None
            if hasattr(_client_module, "_semaphore_loop_ref"):
                _client_module._semaphore_loop_ref = None

    mcp = create_server()
    register_all_tools(mcp, role="student")

    try:
        mcp.run()
    except KeyboardInterrupt:
        log_info("\nShutting down server...")
    except Exception as e:
        log_error("Server error", exc=e)
        sys.exit(1)
    finally:
        from .core.client import cleanup_http_client
        try:
            asyncio.run(cleanup_http_client())
        except RuntimeError:
            pass
        log_info("Server stopped")


if __name__ == "__main__":
    main()
