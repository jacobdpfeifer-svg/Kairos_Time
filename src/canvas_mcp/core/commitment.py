"""One opt-in commitment. Student-authored, student-scored, local only.

At most one open row. The system does not suggest text, take money, or
escalate reminders. A check-in appears once the deadline has passed and
disappears after the student marks met, not met, or dropped. Marking does
not write the brief habit, the learning profile, or the ledger.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

TEXT_MAX = 180
OPEN = "open"
RESOLVED = ("met", "not_met", "dropped")
STATUSES = (OPEN, *RESOLVED)


@dataclass
class Commitment:
    id: str
    text: str
    course: str = ""
    deadline: str = ""
    linked_item_id: str = ""
    created_at: str = ""
    status: str = OPEN
    resolved_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def commitment_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "commitment.yaml"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def _clean_text(value: str) -> str:
    text = " ".join((value or "").split())
    if not text:
        raise ValueError("commitment text is required")
    if len(text) > TEXT_MAX:
        raise ValueError(f"commitment text must be at most {TEXT_MAX} characters")
    return text


def _load(user_root: Path) -> Commitment | None:
    path = commitment_path(user_root)
    if not path.is_file():
        return None
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(raw, dict):
        return None
    status = str(raw.get("status") or "")
    text = str(raw.get("text") or "").strip()
    if status not in STATUSES or not text:
        return None
    resolved = raw.get("resolved_at")
    return Commitment(
        id=str(raw.get("id") or ""),
        text=text,
        course=str(raw.get("course") or ""),
        deadline=str(raw.get("deadline") or ""),
        linked_item_id=str(raw.get("linked_item_id") or ""),
        created_at=str(raw.get("created_at") or ""),
        status=status,
        resolved_at=str(resolved) if resolved else None,
    )


def _write(user_root: Path, row: Commitment) -> None:
    path = commitment_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(row.to_dict(), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def _open_row(user_root: Path) -> Commitment | None:
    row = _load(user_root)
    if row is None or row.status != OPEN:
        return None
    return row


def active_commitment(
    user_root: Path,
    now: datetime | None = None,
) -> Commitment | None:
    """The one open commitment whose deadline has not passed."""
    row = _open_row(user_root)
    if row is None:
        return None
    moment = now or _utcnow()
    deadline = _parse_iso(row.deadline)
    if deadline is None or deadline <= moment:
        return None
    return row


def due_check_in(
    user_root: Path,
    now: datetime | None = None,
) -> Commitment | None:
    """The open commitment once, at or after its deadline. None after resolve."""
    row = _open_row(user_root)
    if row is None:
        return None
    moment = now or _utcnow()
    deadline = _parse_iso(row.deadline)
    if deadline is None or moment < deadline:
        return None
    return row


def set_commitment(
    user_root: Path,
    *,
    text: str,
    deadline: str,
    course: str = "",
    linked_item_id: str = "",
    now: datetime | None = None,
) -> Commitment:
    """Store one open commitment. Refuses if one is already open."""
    if _open_row(user_root) is not None:
        raise ValueError("resolve or drop the open commitment first")
    cleaned = _clean_text(text)
    due = (deadline or "").strip()
    moment = now or _utcnow()
    parsed = _parse_iso(due)
    if parsed is None:
        raise ValueError("deadline must be an ISO datetime")
    if parsed <= moment:
        raise ValueError("deadline must be in the future")
    row = Commitment(
        id=uuid.uuid4().hex[:12],
        text=cleaned,
        course=(course or "").strip(),
        deadline=due,
        linked_item_id=(linked_item_id or "").strip(),
        created_at=moment.isoformat(),
        status=OPEN,
        resolved_at=None,
    )
    _write(user_root, row)
    return row


def resolve_commitment(
    user_root: Path,
    status: str,
    *,
    now: datetime | None = None,
) -> Commitment:
    """Student-scored close. A second resolve returns the stored row."""
    if status not in RESOLVED:
        raise ValueError("status must be met, not_met, or dropped")
    row = _load(user_root)
    if row is None:
        raise ValueError("no commitment")
    if row.status in RESOLVED:
        return row
    moment = now or _utcnow()
    row.status = status
    row.resolved_at = moment.isoformat()
    _write(user_root, row)
    return row


def render_commitment_line(
    *,
    commitment: Commitment | None = None,
    check_in: Commitment | None = None,
) -> str:
    """Quiet dock line. Empty when there is nothing to show."""
    if check_in is not None and check_in.text:
        return f"Check-in: {check_in.text}"
    if commitment is not None and commitment.text:
        return f"Commitment: {commitment.text}"
    return ""


def commitment_payload(
    user_root: Path,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Read payload for the dock and the brief. Does not record a snapshot."""
    moment = now or _utcnow()
    active = active_commitment(user_root, now=moment)
    check_in = due_check_in(user_root, now=moment)
    return {
        "commitment": active.to_dict() if active else None,
        "check_in": check_in.to_dict() if check_in else None,
        "line": render_commitment_line(commitment=active, check_in=check_in),
    }


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    from .user_root import resolve_user_root

    parser = argparse.ArgumentParser(description="One opt-in commitment")
    parser.add_argument("--user-root", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add", help="Store one open commitment")
    add.add_argument("--text", required=True)
    add.add_argument("--deadline", required=True)
    add.add_argument("--course", default="")
    add.add_argument("--linked-item-id", default="")

    sub.add_parser("status", help="Print the current commitment")

    resolve = sub.add_parser("resolve", help="Mark met, not met, or dropped")
    resolve.add_argument("--status", choices=RESOLVED, required=True)

    args = parser.parse_args(argv)
    root = args.user_root or resolve_user_root("dev", create=True)

    try:
        if args.cmd == "add":
            row = set_commitment(
                root,
                text=args.text,
                deadline=args.deadline,
                course=args.course,
                linked_item_id=args.linked_item_id,
            )
            payload: dict[str, Any] = commitment_payload(root)
            payload["saved"] = row.to_dict()
        elif args.cmd == "resolve":
            resolve_commitment(root, args.status)
            payload = commitment_payload(root)
        else:
            payload = commitment_payload(root)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.json or args.cmd == "status":
        print(json.dumps(payload))
        return 0
    if payload.get("line"):
        print(payload["line"])
    else:
        print("(none)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
