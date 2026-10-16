"""SQLite accounting store. Rows hold identifiers, status and counts — never content."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Any

from .config import (
    GLOBAL_CONCURRENCY,
    MAX_DISPATCHES_PER_SESSION,
    PER_TESTER_CONCURRENCY,
    PRICING_VERSION,
    STALE_RESERVATION_SECONDS,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS testers (
  tester_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  invite_hash TEXT UNIQUE,
  session_hash TEXT UNIQUE,
  allowance_cents INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY,
  tester_id TEXT NOT NULL,
  session_budget_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL,
  status TEXT NOT NULL,            -- reserved | completed | unknown | failed
  model TEXT NOT NULL,
  pricing_version TEXT NOT NULL,
  reserved_cents INTEGER NOT NULL,
  settled_cents INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_tester ON requests(tester_id, status);
CREATE INDEX IF NOT EXISTS requests_tester_session ON requests(tester_id, session_budget_id);
"""


class RelayError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Tester:
    tester_id: str
    label: str
    allowance_cents: int
    revoked: bool


class Store:
    def __init__(self, path: str, *, global_allowance_cents: int) -> None:
        self.path = path
        self.global_allowance_cents = global_allowance_cents
        self._lock = threading.Lock()
        with self._conn() as conn:
            conn.executescript(SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")
        conn.row_factory = sqlite3.Row
        return conn

    # --- testers -------------------------------------------------------------

    def create_invite(self, label: str, allowance_cents: int) -> tuple[str, str]:
        tester_id = "t_" + secrets.token_hex(6)
        code = secrets.token_urlsafe(18)
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO testers(tester_id,label,invite_hash,allowance_cents,created_at) VALUES(?,?,?,?,?)",
                (tester_id, label[:64], _hash(code), int(allowance_cents), time.time()),
            )
        return tester_id, code

    def redeem_invite(self, code: str) -> tuple[str, str]:
        """Exchange a one-time invite for a session token (the invite is consumed)."""
        token = secrets.token_urlsafe(32)
        with self._conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT tester_id, revoked FROM testers WHERE invite_hash=?", (_hash(code),)).fetchone()
            if row is None or row["revoked"]:
                conn.execute("ROLLBACK")
                raise RelayError("invalid_invite", "invite code is unknown, used, or revoked", 401)
            conn.execute("UPDATE testers SET invite_hash=NULL, session_hash=? WHERE tester_id=?", (_hash(token), row["tester_id"]))
            conn.execute("COMMIT")
        return row["tester_id"], token

    def authenticate(self, token: str) -> Tester:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM testers WHERE session_hash=?", (_hash(token),)).fetchone()
        if row is None:
            raise RelayError("unauthorized", "unknown session", 401)
        if row["revoked"]:
            raise RelayError("revoked", "access has been revoked", 403)
        return Tester(row["tester_id"], row["label"], int(row["allowance_cents"]), False)

    def authenticate_id(self, tester_id: str) -> Tester:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM testers WHERE tester_id=?", (tester_id,)).fetchone()
        if row is None or row["revoked"]:
            raise RelayError("revoked", "access has been revoked", 403)
        return Tester(row["tester_id"], row["label"], int(row["allowance_cents"]), False)

    def revoke(self, tester_id: str) -> None:
        with self._conn() as conn:
            # Keep the session hash so a revoked client hears "revoked", not "unknown session".
            conn.execute("UPDATE testers SET revoked=1, invite_hash=NULL WHERE tester_id=?", (tester_id,))

    # --- budget ---------------------------------------------------------------

    def budget(self, conn: sqlite3.Connection, tester_id: str | None = None) -> dict[str, int]:
        # Fixed SQL text; the optional tester filter is a bound parameter
        # (``? IS NULL`` selects every tester), never string-built.
        row = conn.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN status='completed' THEN settled_cents ELSE 0 END),0) AS settled,
                 COALESCE(SUM(CASE WHEN status IN ('reserved','unknown') THEN reserved_cents ELSE 0 END),0) AS outstanding,
                 COALESCE(SUM(CASE WHEN status='reserved' THEN 1 ELSE 0 END),0) AS inflight
               FROM requests WHERE (? IS NULL OR tester_id=?)""",
            (tester_id, tester_id),
        ).fetchone()
        return {"settled": int(row["settled"]), "outstanding": int(row["outstanding"]), "inflight": int(row["inflight"])}

    def reserve(self, *, request_id: str, tester: Tester, session_budget_id: str, model: str, max_cents: int) -> dict[str, Any]:
        """Atomically admit one dispatch. Returns the existing row for a repeated request_id."""
        with self._lock, self._conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                existing = conn.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
                if existing is not None:
                    if existing["tester_id"] != tester.tester_id:
                        raise RelayError("conflict", "request id belongs to another tester", 409)
                    return {"duplicate": True, **dict(existing)}
                # Reap reservations whose dispatch can no longer be running.
                conn.execute(
                    "UPDATE requests SET status='unknown', updated_at=? WHERE status='reserved' AND created_at<?",
                    (time.time(), time.time() - STALE_RESERVATION_SECONDS),
                )
                revoked = conn.execute("SELECT revoked FROM testers WHERE tester_id=?", (tester.tester_id,)).fetchone()
                if revoked is None or revoked["revoked"]:
                    raise RelayError("revoked", "access has been revoked", 403)
                per = self.budget(conn, tester.tester_id)
                glob = self.budget(conn)
                if per["inflight"] >= PER_TESTER_CONCURRENCY:
                    raise RelayError("busy", "one request at a time; wait for the current one", 429)
                if glob["inflight"] >= GLOBAL_CONCURRENCY:
                    raise RelayError("busy", "the service is at capacity; try again shortly", 429)
                # Session caps are per tester: a shared or guessed session id
                # must not let one tester burn another's dispatches (F12).
                session_count = conn.execute(
                    "SELECT COUNT(*) AS n FROM requests WHERE tester_id=? AND session_budget_id=? AND status<>'failed'",
                    (tester.tester_id, session_budget_id),
                ).fetchone()["n"]
                if int(session_count) >= MAX_DISPATCHES_PER_SESSION:
                    raise RelayError("session_limit", "this session has used its AI dispatches", 429)
                if per["settled"] + per["outstanding"] + max_cents > tester.allowance_cents:
                    raise RelayError("quota", "AI help has reached its allowance", 402)
                if glob["settled"] + glob["outstanding"] + max_cents > self.global_allowance_cents:
                    raise RelayError("quota", "AI help has reached its allowance", 402)
                dispatch_id = "d_" + secrets.token_hex(8)
                now = time.time()
                conn.execute(
                    """INSERT INTO requests(request_id,tester_id,session_budget_id,dispatch_id,status,model,pricing_version,reserved_cents,created_at,updated_at)
                       VALUES(?,?,?,?,'reserved',?,?,?,?,?)""",
                    (request_id, tester.tester_id, session_budget_id, dispatch_id, model, PRICING_VERSION, max_cents, now, now),
                )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            return {"duplicate": False, "request_id": request_id, "dispatch_id": dispatch_id, "status": "reserved", "reserved_cents": max_cents}

    def settle(self, request_id: str, *, usage: dict[str, int] | None, settled_cents: int | None, status: str) -> None:
        """Record the authoritative outcome. Missing usage → keep the reservation as `unknown`."""
        if status not in ("completed", "unknown", "failed"):
            raise ValueError(f"unknown settle status {status!r}")
        with self._lock, self._conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT status, reserved_cents FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if row is None or row["status"] != "reserved":
                conn.execute("ROLLBACK")
                return  # already settled: idempotent
            settled = None
            if status == "completed":
                settled = min(int(row["reserved_cents"]), int(settled_cents or 0)) if settled_cents is not None else None
                if settled is None:
                    status = "unknown"
            elif status == "failed":
                settled = 0  # definite 4xx: nothing was billed; the reservation is released
            conn.execute(
                """UPDATE requests SET status=?, settled_cents=?, input_tokens=?, output_tokens=?, reasoning_tokens=?, updated_at=? WHERE request_id=?""",
                (
                    status,
                    settled,
                    (usage or {}).get("input"),
                    (usage or {}).get("output"),
                    (usage or {}).get("reasoning"),
                    time.time(),
                    request_id,
                ),
            )
            conn.execute("COMMIT")

    def request_status(self, request_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
        return dict(row) if row else None

    def usage_summary(self, tester_id: str | None = None) -> dict[str, Any]:
        with self._conn() as conn:
            b = self.budget(conn, tester_id)
            counts = conn.execute(
                "SELECT status, COUNT(*) AS n FROM requests WHERE (? IS NULL OR tester_id=?) GROUP BY status",
                (tester_id, tester_id),
            ).fetchall()
        return {**b, "by_status": {r["status"]: int(r["n"]) for r in counts}, "pricing_version": PRICING_VERSION}
