"""Shared bootstrap + write gate for Kairos MCP actuators.

Every actuator (gcal / gmail / apple-cal) should import from here instead of
re-implementing ``sys.path`` inserts, ``PRODUCT_USER_ID`` → user_root, and the
permissions check + blocked ledger row.

Bucket-A connector writes that can be gated must go through
``gate_connector_write`` (ConfirmationGuard preview → fingerprint → token),
not a forgeable ``confirmed: bool`` tool argument.

The token proves the content was previewed and not changed; it cannot prove a
human approved it, because the preview (and so the token) goes back to the
same model that asked. For the always-gated categories (email send, calendar
writes) a valid token therefore only reaches ``needs_human``: the tool must
then ask the student directly with ``ask_human`` (an MCP elicitation the
client renders and the model cannot answer) and call the gate again with
``human_approved=True``. A client that cannot show that prompt gets nothing
executed (finding F15).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

REPO = Path(__file__).resolve().parents[2]


def ensure_import_paths() -> None:
    """Make ``canvas_mcp`` and ``common`` importable from a repo checkout."""
    src = str(REPO / "src")
    mcp = str(REPO / "mcp-servers")
    if src not in sys.path:
        sys.path.insert(0, src)
    if mcp not in sys.path:
        sys.path.insert(0, mcp)


ensure_import_paths()

from canvas_mcp.core.connector_guards import get_connector_guard  # noqa: E402
from canvas_mcp.core.ledger import append_ledger  # noqa: E402
from canvas_mcp.core.permissions import (  # noqa: E402
    ALWAYS_GATED,
    allow_write,
    load_permissions,
    resolve_posture,
)
from canvas_mcp.core.user_root import resolve_user_root  # noqa: E402

GateKind = Literal["blocked", "preview", "needs_human", "proceed"]

HUMAN_DECLINED = (
    "❌ Not done: the student did not approve this in the approval prompt "
    "(or this MCP client cannot show one). Nothing was written. Ask the student "
    "to do it themselves, or preview again in a client that supports approval prompts."
)


@dataclass(frozen=True)
class GateResult:
    """Outcome of ``gate_connector_write``.

    ``confirmation_token`` is set on ``proceed`` only when a gated token was
    reserved; callers must ``release_connector_confirmation`` if the write
    never starts.
    """

    kind: GateKind
    message: str = ""
    confirmation_token: str | None = None
    connector_id: str | None = None


def user_root() -> Path:
    """Resolve the actuator user root (``PRODUCT_USER_ID`` or ``dev``)."""
    return resolve_user_root(os.environ.get("PRODUCT_USER_ID", "dev"), create=True)


def check_write(
    root: Path,
    category: str,
    *,
    confirmed: bool,
    actor: str,
    tool: str,
    target: str,
    why: str,
    log_block: bool = True,
) -> tuple[bool, str]:
    """Return ``(ok, reason)``. On block, optionally append a ledger veto/pause.

    Prefer ``gate_connector_write`` for Bucket-A MCP write tools so gated
    categories require a fingerprint-bound token instead of a boolean.
    """
    state = load_permissions(root)
    ok, reason = allow_write(state, category, confirmed=confirmed)
    if not ok and log_block:
        append_ledger(
            root,
            actor=actor,
            tool=tool,
            target=target,
            why=why,
            outcome="paused" if "STOP" in reason else "veto",
            category=category,
        )
    return ok, reason


def release_connector_confirmation(
    connector_id: str,
    token: str | None,
) -> None:
    """Undo a reserved gated confirmation when the write never started."""
    if not token:
        return
    get_connector_guard(connector_id).release(token)


def gate_connector_write(
    root: Path,
    category: str,
    *,
    connector_id: str,
    tool: str,
    fingerprint_parts: Sequence[str],
    preview_lines: Sequence[str],
    confirmation_token: str | None,
    actor: str,
    target: str,
    why: str,
    log_block: bool = True,
    human_approved: bool = False,
) -> GateResult:
    """Permissions + ConfirmationGuard gate for Bucket-A connector writes.

    - ``automatic`` → proceed without a token
    - ``gated`` + no token → issue preview (no side effect)
    - ``gated`` + token → check → matrix confirm → reserve → proceed
    - always-gated category + valid token, not ``human_approved`` →
      ``needs_human`` (nothing reserved; ask with ``ask_human`` and call again)
    - ``never`` → blocked (ledger when ``log_block``)

    ``human_approved`` must only ever be set from ``ask_human``'s answer,
    never from a tool argument.
    """
    state = load_permissions(root)
    posture = resolve_posture(state, category)

    if posture == "never":
        ok, reason = check_write(
            root,
            category,
            confirmed=False,
            actor=actor,
            tool=tool,
            target=target,
            why=why,
            log_block=log_block,
        )
        # "never" must block even if the matrix ever disagreed; no assert
        # (asserts vanish under python -O).
        return GateResult(kind="blocked", message=f"❌ Blocked: {reason or 'category is set to never'}")

    if posture == "automatic":
        ok, reason = check_write(
            root,
            category,
            confirmed=False,
            actor=actor,
            tool=tool,
            target=target,
            why=why,
            log_block=log_block,
        )
        if not ok:
            return GateResult(kind="blocked", message=f"❌ Blocked: {reason}")
        return GateResult(kind="proceed")

    # gated
    parts = [str(p) for p in fingerprint_parts]
    guard = get_connector_guard(connector_id)
    fingerprint = guard.fingerprint(*parts)

    token = (confirmation_token or "").strip() or None
    if not token:
        issued = guard.issue(fingerprint)
        lines = [
            "📋 Write preview — NOTHING has been written yet.",
            "",
            f"Connector: {connector_id}",
            f"Tool: {tool}",
            f"Category: {category}",
            "",
            *preview_lines,
            "",
            "➡️  Always show this preview in chat. To proceed, call again with "
            f"confirmation_token='{issued}' and identical arguments.",
            *(
                [
                    "The student will then be asked to approve it directly; "
                    "their answer, not this token, is what allows it."
                ]
                if category in ALWAYS_GATED
                else []
            ),
        ]
        return GateResult(kind="preview", message="\n".join(lines))

    token_error = guard.check(token, fingerprint)
    if token_error:
        return GateResult(kind="blocked", message=token_error)

    ok, reason = check_write(
        root,
        category,
        confirmed=True,
        actor=actor,
        tool=tool,
        target=target,
        why=why,
        log_block=log_block,
    )
    if not ok:
        return GateResult(kind="blocked", message=f"❌ Blocked: {reason}")

    if category in ALWAYS_GATED and not human_approved:
        return GateResult(
            kind="needs_human",
            message="\n".join(["Approve this?", "", *preview_lines]),
            connector_id=connector_id,
        )

    if not guard.reserve(token):
        return GateResult(
            kind="blocked",
            message=(
                "❌ That confirmation was already used. Nothing was written. "
                "Run the preview again."
            ),
        )

    return GateResult(
        kind="proceed",
        confirmation_token=token,
        connector_id=connector_id,
    )


async def ask_human(ctx: object, message: str) -> bool:
    """Ask the student directly (MCP elicitation) whether to do exactly this.

    The client renders the prompt and returns the student's answer to this
    server; the model never sees or supplies it. Returns False — fail closed —
    when there is no context, the client cannot elicit, or the student declines.
    """
    if ctx is None or not hasattr(ctx, "elicit"):
        return False
    from pydantic import BaseModel, Field

    class Approval(BaseModel):
        approve: bool = Field(description="Yes, do exactly this")

    try:
        result = await ctx.elicit(message=message, schema=Approval)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 - unsupported client / transport error: not approved
        return False
    data = getattr(result, "data", None)
    return getattr(result, "action", "") == "accept" and bool(getattr(data, "approve", False))


async def gate_with_human(ctx: object, root: Path, category: str, **kwargs: object) -> GateResult:
    """``gate_connector_write`` plus the student's direct approval when needed.

    The only place ``human_approved=True`` is ever passed.
    """
    gate = gate_connector_write(root, category, **kwargs)  # type: ignore[arg-type]
    if gate.kind != "needs_human":
        return gate
    if not await ask_human(ctx, gate.message):
        return GateResult(kind="blocked", message=HUMAN_DECLINED)
    return gate_connector_write(root, category, **kwargs, human_approved=True)  # type: ignore[arg-type]
