"""Per-user data directory resolution (local-first).

macOS:  ~/Library/Application Support/{Kairos}/{user_id}/
Windows: %APPDATA%\\{Kairos}\\{user_id}\\
Linux:  ~/.local/share/{Kairos}/{user_id}/

``DEV_USER_ROOT`` overrides the entire user root (useful for local development
and tests without writing under the OS app-support path).
"""

from __future__ import annotations

import os
import platform
from pathlib import Path

from .tenants import PRODUCT_NAME

# Subdirectories created under every user root.
USER_SUBDIRS = (
    "inbox",
    "inbox/courses",
    "inbox/captures",
    "inbox/learn",
    "calibration",
    "skills/active",
    "skills/provisional",
    "semantic",
    "auth",
    "sensors",
)


def default_app_support_root(product: str = PRODUCT_NAME) -> Path:
    """OS-standard application support directory for the product."""
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / product
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / product
        return Path.home() / "AppData" / "Roaming" / product
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / product
    return Path.home() / ".local" / "share" / product


def resolve_user_root(
    user_id: str,
    *,
    product: str = PRODUCT_NAME,
    create: bool = False,
) -> Path:
    """Resolve the per-user data directory.

    Honors ``DEV_USER_ROOT`` when set (absolute path). Otherwise
    ``{app_support}/{user_id}/``.
    """
    override = os.environ.get("DEV_USER_ROOT", "").strip()
    if override:
        root = Path(override).expanduser().resolve()
    else:
        if not user_id or "/" in user_id or "\\" in user_id or user_id in (".", ".."):
            raise ValueError(f"Invalid user_id: {user_id!r}")
        root = default_app_support_root(product) / user_id

    if create:
        ensure_user_root(root)
    return root


def ensure_user_root(root: Path) -> Path:
    """Create the standard subdirectory tree under ``root``.

    The root and ``auth/`` are owner-only (0700): they hold Canvas SSO
    cookies, OAuth refresh tokens, grades and private notes, and the directory
    mode is what keeps every file inside away from other local accounts.
    """
    root.mkdir(parents=True, exist_ok=True)
    for rel in USER_SUBDIRS:
        (root / rel).mkdir(parents=True, exist_ok=True)
    for private in (root, root / "auth"):
        try:
            os.chmod(private, 0o700)  # nosemgrep: python.lang.security.audit.insecure-file-permissions.insecure-file-permissions - 0700 directory, owner-only
        except OSError:
            pass
    # Touch empty ledger if missing (append-only file).
    ledger = root / "ledger.jsonl"
    if not ledger.exists():
        ledger.touch()
    return root


def user_path(user_id: str, *parts: str, create_root: bool = False) -> Path:
    """Convenience: ``resolve_user_root(user_id) / parts``."""
    root = resolve_user_root(user_id, create=create_root)
    candidate = root.joinpath(*parts)
    # Callers use this helper for user-owned data.  Reject absolute paths and
    # traversal rather than allowing Path.joinpath() to silently discard the
    # trusted root or escape it through ``..``.
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("user path must remain inside the user root") from exc
    return candidate
