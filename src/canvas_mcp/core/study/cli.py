"""``python -m canvas_mcp.core.study --json <cmd>`` — one JSON object per call.

Exit 0 with ``{"ok": true, ...}``; exit 1 with ``{"ok": false, "error": {code, message}}``.
The optional ``serve`` command runs a loopback-only HTTP bridge for the Vite
dev server (DECISIONS D-07). It is not part of the packaged app.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import types
from datetime import datetime
from pathlib import Path
from typing import Any

from .model import StudyError, write_private_text
from .service import StudyService


def _root(args: argparse.Namespace) -> Path:
    if args.user_root:
        root = Path(args.user_root)
        root.mkdir(parents=True, exist_ok=True)
        return root
    # Only the developer CLI resolves identity itself; the app always passes
    # --user-root so the isolated `study` package needs no canvas_mcp imports.
    from ..user_root import resolve_user_root

    return resolve_user_root(os.environ.get("PRODUCT_USER_ID", "dev"), create=True)


def _now(args: argparse.Namespace) -> datetime | None:
    raw = getattr(args, "now", None)
    if not raw:
        return None
    from .model import parse_instant

    return parse_instant(raw, "--now")


def run_command(service: StudyService, cmd: str, params: dict[str, Any]) -> dict[str, Any]:
    if cmd == "status":
        return service.status()
    if cmd == "packets":
        return service.packets_view()
    if cmd == "import":
        if params.get("packet") is not None:
            return service.import_packet(params["packet"])
        return service.import_path(str(params.get("path") or ""))
    if cmd == "withdraw":
        return service.withdraw_packet(str(params["packet_id"]), str(params.get("reason") or ""))
    if cmd == "exam":
        return service.set_exam(dict(params.get("exam") or {}))
    if cmd == "offer":
        return service.offer(
            course=params.get("course") or None,
            minutes=int(params.get("minutes") or 5),
            mode=params.get("mode") or None,
            cram=bool(params.get("cram")),
            item_id=params.get("item_id") or None,
            new_session=bool(params.get("new_session")),
        )
    if cmd == "start":
        return service.start(str(params["item_id"]), str(params.get("mode") or "review"), minutes=int(params.get("minutes") or 5))
    if cmd == "draft":
        expected = params.get("expected_revision")
        return service.draft(
            str(params["attempt_id"]),
            str(params.get("text") or ""),
            expected_revision=int(expected) if expected is not None else None,
        )
    if cmd == "submit":
        return service.submit(
            str(params["attempt_id"]),
            str(params.get("text") or ""),
            dict(params.get("fields") or {}),
            self_outcome=params.get("self_outcome") or None,
        )
    if cmd == "hint":
        return service.hint(str(params["attempt_id"]))
    if cmd == "reveal":
        return service.reveal(str(params["attempt_id"]))
    if cmd == "skip":
        return service.skip(str(params["attempt_id"]))
    if cmd == "report-help":
        return service.report_help(str(params["attempt_id"]), str(params.get("note") or ""))
    if cmd == "disagree":
        return service.disagree(str(params["attempt_id"]), str(params.get("note") or ""))
    if cmd == "invalidate":
        return service.invalidate_assessment(str(params["attempt_id"]), str(params.get("note") or ""))
    if cmd == "plan":
        return service.plan(str(params["item_id"]), str(params["at"]), str(params.get("reason") or "student_choice"))
    if cmd == "source":
        return service.read_source(str(params["packet_id"]), str(params["source_id"]), attempt_id=params.get("attempt_id") or None)
    if cmd == "history":
        return service.history(str(params["item_id"]), limit=int(params.get("limit") or 20), offset=int(params.get("offset") or 0))
    if cmd == "session":
        return {"ok": True, "session": service.session(new=bool(params.get("new")))}
    if cmd == "templates":
        return {"ok": True, "templates": list_templates()}
    if cmd == "canvas-sources":
        return service.canvas_sources()
    if cmd == "canvas-import":
        ids = params.get("source_ids")
        return service.canvas_import(str(params["course_id"]), [str(i) for i in ids] if ids else None)
    if cmd == "ai-status":
        return service.ai_status()
    if cmd == "ai-connect":
        return service.ai_connect(str(params.get("url") or ""), str(params.get("invite_code") or ""))
    if cmd == "ai-disconnect":
        return service.ai_disconnect()
    if cmd == "ai-feedback":
        return service.ai_feedback(str(params["attempt_id"]), purpose=str(params.get("purpose") or "feedback"), regenerate=bool(params.get("regenerate")))
    if cmd == "ask-create":
        return service.ask_create(params)
    if cmd == "ask-get":
        return service.ask_get(str(params.get("input_id") or ""))
    if cmd == "ask-current":
        return service.ask_current()
    if cmd == "ask-correct":
        return service.ask_correct(str(params.get("input_id") or ""), params)
    if cmd == "ask-mode":
        return service.ask_mode(str(params.get("input_id") or ""), str(params.get("session_goal") or ""))
    if cmd == "ask-rank":
        return service.ask_rank(params)
    if cmd == "ask-pending":
        return service.ask_pending()
    if cmd.startswith("connectors-") or cmd.startswith("outlook-") or cmd.startswith("gcal-") or cmd == "context":
        return _connector_command(service, cmd, params)
    if cmd == "create-item":
        return service.create_item(str(params["packet_id"]), dict(params.get("spec") or {}))
    if cmd == "import-template":
        template = next((t for t in list_templates() if t["packet_id"] == params.get("packet_id")), None)
        if template is None:
            raise StudyError("not_found", f"no bundled packet {params.get('packet_id')!r}")
        return service.import_path(template["path"])
    if cmd.startswith("library-"):
        return _library_command(service, cmd, params)
    if cmd.startswith("email-draft-") or cmd == "email-send":
        return _email_command(service, cmd, params)
    if cmd == "brief-enrich":
        from .brief_enrich import enrich

        return enrich(
            service.user_root,
            str(params.get("course_id") or ""),
            str(params.get("assignment_id") or ""),
            session_budget_id=str(service.session().get("id") or "session"),
            attempt=int(params.get("attempt") or 1),
        )
    if cmd == "audit-import":
        from .audit_copy import write_audit

        return {"ok": True, **write_audit(service.user_root, params, today=service.now.date())}
    if cmd == "profile-fields":
        from .audit_copy import update_profile_fields

        return {"ok": True, **update_profile_fields(service.user_root, params)}
    raise StudyError("validation", f"unknown command {cmd!r}")


def _library_command(service: StudyService, cmd: str, params: dict[str, Any]) -> dict[str, Any]:
    from . import library

    root = service.user_root
    if cmd == "library-list":
        return {"ok": True, "library": library.list_view(root)}
    if cmd == "library-ingest":
        return library.ingest_incoming(root, service.now)
    if cmd == "library-add":
        # Small files from the dev bridge; the desktop app stages bytes in incoming/.
        import base64
        import binascii

        try:
            data = base64.b64decode(str(params.get("data_base64") or ""), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise StudyError("validation", "data_base64 is not valid base64") from exc
        result = library.add_bytes(root, str(params.get("name") or "file"), data, service.now)
        return {"ok": True, **result, "library": library.list_view(root)}
    if cmd == "library-update":
        return library.update_entry(root, str(params.get("id") or ""), params)
    if cmd == "library-remove":
        return library.remove_entry(root, str(params.get("id") or ""))
    if cmd == "library-resort":
        return library.resort(root)
    raise StudyError("validation", f"unknown command {cmd!r}")


def _email_command(service: StudyService, cmd: str, params: dict[str, Any]) -> dict[str, Any]:
    """Local drafts only. ``email-send`` refuses until a provider bridge exists."""
    from . import email_drafts as e

    root = service.user_root
    draft_id = str(params.get("draft_id") or "")
    if cmd == "email-draft-create":
        return e.create(root, params)
    if cmd == "email-draft-update":
        return e.update(root, draft_id, params)
    if cmd == "email-draft-review":
        return e.review(root, draft_id)
    if cmd == "email-draft-list":
        return e.list_drafts(root)
    if cmd == "email-draft-get":
        return e.get(root, draft_id)
    if cmd == "email-draft-discard":
        return e.discard(root, draft_id)
    if cmd == "email-send":
        return e.send(root, draft_id, str(params.get("confirmation_token") or ""))
    raise StudyError("validation", f"unknown command {cmd!r}")


def _connectors_module() -> Any:
    """``core/connectors.py`` from either import shape.

    The desktop app runs this package as top-level ``study`` (cwd = ``core/``) so
    the primary journey never imports ``canvas_mcp/__init__``. ``from .. import``
    fails there, so the connector chain (stdlib-only, relative imports inside
    ``core/``) is loaded under a bare package alias for ``core/`` instead."""
    if __package__ and "." in __package__:
        from .. import connectors

        return connectors
    alias = "_kairos_core"
    if alias not in sys.modules:
        package = types.ModuleType(alias)
        package.__path__ = [str(Path(__file__).resolve().parents[1])]
        sys.modules[alias] = package
    return importlib.import_module(f"{alias}.connectors")


def _connector_command(service: StudyService, cmd: str, params: dict[str, Any]) -> dict[str, Any]:
    """Connector commands live outside the study event log; the Google/Microsoft
    modules keep their own per-profile records (core/connectors.py)."""
    c = _connectors_module()

    root = service.user_root
    try:
        if cmd == "connectors-status":
            return {"ok": True, "connectors": c.status(root)}
        if cmd == "outlook-begin":
            return dict(c.outlook_begin(root))
        if cmd == "outlook-poll":
            return dict(c.outlook_poll(root))
        if cmd == "outlook-read":
            return dict(c.outlook_read(root))
        if cmd == "outlook-disconnect":
            return {"ok": True, "connector": c.outlook_disconnect(root)}
        if cmd == "gcal-connect":
            return {"ok": True, "connector": c.gcal_connect(root)}
        if cmd == "gcal-read":
            return dict(c.gcal_read(root))
        if cmd == "gcal-disconnect":
            return {"ok": True, "connector": c.gcal_disconnect(root)}
        if cmd == "gcal-preview-event":
            return dict(c.gcal_preview_event(root, summary=str(params.get("summary") or ""), start_iso=str(params.get("start") or ""), end_iso=str(params.get("end") or ""), why=str(params.get("why") or "")))
        if cmd == "gcal-confirm-event":
            return dict(c.gcal_confirm_event(root, summary=str(params.get("summary") or ""), start_iso=str(params.get("start") or ""), end_iso=str(params.get("end") or ""), why=str(params.get("why") or ""), confirmation_token=str(params.get("confirmation_token") or "")))
        if cmd == "context":
            return dict(c.relevant_context(root, course_terms=[str(t) for t in (params.get("terms") or [])], days=int(params.get("days") or 7)))
    except c.ConnectorError as exc:
        raise StudyError(exc.code, exc.message) from exc
    raise StudyError("validation", f"unknown command {cmd!r}")


def templates_dir() -> Path:
    """Bundled synthetic packets. ``KAIROS_TEMPLATES_DIR`` points at the installed copy."""
    override = os.environ.get("KAIROS_TEMPLATES_DIR", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[4] / "templates" / "study-packets"


def list_templates() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    directory = templates_dir()
    if not directory.is_dir():
        return rows
    for path in sorted(directory.glob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        rows.append(
            {
                "packet_id": str(raw.get("packet_id") or path.stem),
                "title": str(raw.get("title") or path.stem),
                "course": str(raw.get("course") or ""),
                "provenance": str(raw.get("provenance") or "synthetic"),
                "items": len(raw.get("items") or []),
                "path": str(path),
            }
        )
    return rows


MAX_REQUEST_BYTES = 256 * 1024
DEV_ORIGINS = ("http://localhost:1420", "http://127.0.0.1:1420")


def _serve(root: Path, port: int, zone: str | None) -> int:
    """Loopback dev bridge: POST /study {"cmd": ..., "params": {...}}.

    Guarded even though it is dev-only: a per-process token in
    ``X-Study-Token`` (printed at start, also written to ``{root}/study/bridge-token``),
    an Origin allowlist, and a request-size cap, so a stray page cannot mutate
    the profile with a text/plain simple request (audit A finding).
    """
    import secrets
    from http.server import BaseHTTPRequestHandler, HTTPServer

    token = os.environ.get("KAIROS_BRIDGE_TOKEN") or secrets.token_urlsafe(24)
    write_private_text(root / "study" / "bridge-token", token)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict[str, Any]) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            origin = self.headers.get("Origin") or ""
            if origin in DEV_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "content-type, x-study-token")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:  # noqa: N802 - http.server API
            self._send(204, {})

        def do_POST(self) -> None:  # noqa: N802 - http.server API
            if self.path != "/study":
                self._send(404, {"ok": False, "error": {"code": "not_found", "message": "unknown path"}})
                return
            origin = self.headers.get("Origin")
            if origin is not None and origin not in DEV_ORIGINS:
                self._send(403, {"ok": False, "error": {"code": "forbidden", "message": "origin not allowed"}})
                return
            if not secrets.compare_digest(self.headers.get("X-Study-Token") or "", token):
                self._send(401, {"ok": False, "error": {"code": "unauthorized", "message": "missing or wrong X-Study-Token"}})
                return
            if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
                self._send(415, {"ok": False, "error": {"code": "validation", "message": "content-type must be application/json"}})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0:
                self._send(400, {"ok": False, "error": {"code": "validation", "message": "bad content-length"}})
                return
            if length > MAX_REQUEST_BYTES:
                self._send(413, {"ok": False, "error": {"code": "validation", "message": "request too large"}})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                service = StudyService(root, zone=zone, now=_bridge_now(body))
                result = run_command(service, str(body.get("cmd")), dict(body.get("params") or {}))
                self._send(200, result)
            except StudyError as exc:
                self._send(200, {"ok": False, "error": {"code": exc.code, "message": exc.message}})
            except Exception as exc:  # noqa: BLE001 - dev bridge reports, never crashes
                self._send(200, {"ok": False, "error": {"code": "internal", "message": type(exc).__name__}})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - http.server API
            return  # no request logging: bodies carry study content

    server = HTTPServer(("127.0.0.1", port), Handler)
    print(json.dumps({"ok": True, "serving": f"http://127.0.0.1:{port}/study", "user_root": str(root), "token": token}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def _bridge_now(body: dict[str, Any]) -> datetime | None:
    """A request-supplied clock is honored only in an explicit test harness
    (``KAIROS_ALLOW_TEST_CLOCK=1``); production IPC cannot move time."""
    raw = body.get("now")
    if not raw or os.environ.get("KAIROS_ALLOW_TEST_CLOCK") != "1":
        return None
    from .model import parse_instant

    return parse_instant(raw, "now")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Study sessions (source-backed practice)")
    parser.add_argument("--user-root", default=None)
    parser.add_argument("--json", action="store_true", help="always on; kept for parity with other CLIs")
    parser.add_argument("--now", default=None, help="ISO instant override (tests/fixtures only)")
    parser.add_argument("--zone", default=None, help="IANA zone override")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status")
    sub.add_parser("packets")
    p = sub.add_parser("import")
    p.add_argument("--path", required=True)
    p = sub.add_parser("withdraw")
    p.add_argument("--packet", required=True)
    p.add_argument("--reason", default="")
    p = sub.add_parser("exam")
    p.add_argument("--exam-json", required=True, help='{"id":..,"course":..,"value":"date_only","date":"2026-09-28","zone":"America/Denver"}')
    p = sub.add_parser("offer")
    p.add_argument("--course", default=None)
    p.add_argument("--minutes", type=int, default=5)
    p.add_argument("--mode", default=None)
    p.add_argument("--cram", action="store_true")
    p.add_argument("--item", default=None)
    p.add_argument("--new-session", action="store_true")
    p = sub.add_parser("start")
    p.add_argument("--item", required=True)
    p.add_argument("--mode", default="review")
    p.add_argument("--minutes", type=int, default=5)
    p = sub.add_parser("draft")
    p.add_argument("--attempt", required=True)
    p.add_argument("--text", required=True)
    p = sub.add_parser("submit")
    p.add_argument("--attempt", required=True)
    p.add_argument("--text", default="")
    p.add_argument("--fields", default=None, help="JSON object of field_id -> value")
    p.add_argument("--self-outcome", default=None)
    for name in ("hint", "reveal", "skip"):
        p = sub.add_parser(name)
        p.add_argument("--attempt", required=True)
    for name in ("report-help", "disagree", "invalidate"):
        p = sub.add_parser(name)
        p.add_argument("--attempt", required=True)
        p.add_argument("--note", default="")
    p = sub.add_parser("plan")
    p.add_argument("--item", required=True)
    p.add_argument("--at", required=True)
    p.add_argument("--reason", default="student_choice")
    p = sub.add_parser("source")
    p.add_argument("--packet", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--attempt", default=None)
    p = sub.add_parser("history")
    p.add_argument("--item", required=True)
    p = sub.add_parser("session")
    p.add_argument("--new", action="store_true")
    p = sub.add_parser("serve")
    p.add_argument("--port", type=int, default=1421)
    sub.add_parser("run", help='read {"cmd":..,"params":{..},"now"?:..} from stdin (IPC path)')
    sub.add_parser("templates")
    p = sub.add_parser("import-template")
    p.add_argument("--packet", required=True)

    args = parser.parse_args(argv)
    root = _root(args)
    if args.cmd == "serve":
        return _serve(root, args.port, args.zone)
    if args.cmd == "run":
        # The IPC bridge always answers one JSON envelope: a traceback would
        # reach the app as "no reply" and could carry study content (F3).
        try:
            body = json.loads(sys.stdin.read() or "{}")
        except ValueError as exc:
            _fail("validation", f"request is not JSON: {exc}")
            return 1
        try:
            if not isinstance(body, dict):
                raise StudyError("validation", "request must be a JSON object")
            run_params = body.get("params") or {}
            if not isinstance(run_params, dict):
                raise StudyError("validation", "params must be an object")
            service = StudyService(root, now=_bridge_now(body) or _now(args), zone=args.zone)
            result = run_command(service, str(body.get("cmd")), run_params)
        except StudyError as exc:
            _fail(exc.code, exc.message)
            return 1
        except KeyError as exc:
            _fail("validation", f"missing required parameter {exc.args[0]!r}" if exc.args else "missing required parameter")
            return 1
        except (TypeError, ValueError, OverflowError) as exc:
            _fail("validation", f"invalid parameter: {type(exc).__name__}")
            return 1
        except Exception as exc:  # noqa: BLE001 - envelope, never a traceback
            _fail("internal", f"study core error: {type(exc).__name__}")
            return 1
        print(json.dumps(result))
        return 0

    params: dict[str, Any] = {}
    if args.cmd == "import":
        params = {"path": args.path}
    elif args.cmd == "withdraw":
        params = {"packet_id": args.packet, "reason": args.reason}
    elif args.cmd == "exam":
        try:
            params = {"exam": json.loads(args.exam_json)}
        except ValueError as exc:
            _fail("validation", f"--exam-json is not JSON: {exc}")
            return 1
    elif args.cmd == "offer":
        params = {"course": args.course, "minutes": args.minutes, "mode": args.mode, "cram": args.cram, "item_id": args.item, "new_session": args.new_session}
    elif args.cmd == "start":
        params = {"item_id": args.item, "mode": args.mode, "minutes": args.minutes}
    elif args.cmd == "draft":
        params = {"attempt_id": args.attempt, "text": args.text}
    elif args.cmd == "submit":
        fields: dict[str, Any] = {}
        if args.fields:
            try:
                fields = json.loads(args.fields)
            except ValueError as exc:
                _fail("validation", f"--fields is not JSON: {exc}")
                return 1
        params = {"attempt_id": args.attempt, "text": args.text, "fields": fields, "self_outcome": args.self_outcome}
    elif args.cmd in ("hint", "reveal", "skip"):
        params = {"attempt_id": args.attempt}
    elif args.cmd in ("report-help", "disagree", "invalidate"):
        params = {"attempt_id": args.attempt, "note": args.note}
    elif args.cmd == "plan":
        params = {"item_id": args.item, "at": args.at, "reason": args.reason}
    elif args.cmd == "source":
        params = {"packet_id": args.packet, "source_id": args.source, "attempt_id": args.attempt}
    elif args.cmd == "history":
        params = {"item_id": args.item}
    elif args.cmd == "session":
        params = {"new": args.new}
    elif args.cmd == "import-template":
        params = {"packet_id": args.packet}

    try:
        service = StudyService(root, now=_now(args), zone=args.zone)
        result = run_command(service, args.cmd, params)
    except StudyError as exc:
        _fail(exc.code, exc.message)
        return 1
    print(json.dumps(result))
    return 0


def _fail(code: str, message: str) -> None:
    print(json.dumps({"ok": False, "error": {"code": code, "message": message}}))
    print(message, file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
