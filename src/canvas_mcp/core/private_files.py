"""Owner-only file writes for secrets and personal records (stdlib only).

``Path.write_text`` followed by ``chmod`` leaves a window where the file holds
its contents under the process umask (usually world-readable 0644), and a
fixed ``.tmp`` sibling can be pre-planted as a symlink. ``write_private_text``
creates a fresh temp file as 0600 with ``O_EXCL``/``O_NOFOLLOW`` and renames it
into place, so the secret is never readable by another local account.

Mirrored in ``study/model.py`` because the desktop app imports the study
package as a top-level module that cannot reach this one.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600


def ensure_private_dir(path: Path) -> Path:
    """Create ``path`` (and parents) and make the leaf owner-only."""
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, PRIVATE_DIR_MODE)  # nosemgrep: python.lang.security.audit.insecure-file-permissions.insecure-file-permissions - 0700 directory, owner-only
    except OSError:
        pass  # Windows / foreign filesystems: best effort
    return path


def write_private_text(path: Path, text: str) -> None:
    """Atomically replace ``path`` with ``text``, readable by the owner only."""
    ensure_private_dir(path.parent)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(tmp, flags, PRIVATE_FILE_MODE)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def append_private_line(path: Path, line: str) -> None:
    """Append one line to ``path``, creating it owner-only when missing."""
    ensure_private_dir(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, PRIVATE_FILE_MODE)
    with os.fdopen(fd, "a", encoding="utf-8") as fh:
        fh.write(line if line.endswith("\n") else line + "\n")
