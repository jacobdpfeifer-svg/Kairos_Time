"""Request handling: validate → reserve → dispatch once → settle → answer."""

from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict
from typing import Any

from .config import (
    MAX_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
    MAX_TESTER_ALLOWANCE_CENTS,
    PRICING,
    PRICING_VERSION,
    PROVIDER_OF,
    Config,
    actual_cost_cents,
    inference_allowance_cents,
    max_cost_cents,
)
from .log import log
from .providers import (
    AnthropicProvider,
    GeminiProvider,
    Provider,
    build_user_content,
    validate_brief_proposal,
    validate_proposal,
)
from .store import RelayError, Store, Tester

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
PURPOSES = ("generate", "feedback", "hint", "repair", "brief")
# Fields a client may send. Anything else (model, endpoint, headers, tools,
# temperature…) is rejected outright rather than ignored.
ALLOWED_FIELDS = {"request_id", "session_budget_id", "purpose", "source_passages", "stem", "rubric", "submitted_answer", "schema_version", "pricing_version"}
LIMITS = {"stem": 4000, "rubric": 4000, "submitted_answer": 8000, "passage": 6000, "passages": 6}
SYSTEM_OVERHEAD_TOKENS = 300
CHARS_PER_TOKEN_BOUND = 3  # conservative: real tokenizers average ~4 chars/token


def estimate_input_tokens(request: dict[str, Any]) -> int:
    chars = len(build_user_content(request))
    return SYSTEM_OVERHEAD_TOKENS + (chars + CHARS_PER_TOKEN_BOUND - 1) // CHARS_PER_TOKEN_BOUND


class RelayService:
    def __init__(self, config: Config, store: Store, providers: dict[str, Provider] | None = None) -> None:
        self.config = config
        self.store = store
        self.providers: dict[str, Provider] = providers or {}
        if "anthropic" not in self.providers and config.anthropic_key:
            self.providers["anthropic"] = AnthropicProvider(config.anthropic_key)
        if "gemini" not in self.providers and config.gemini_key:
            self.providers["gemini"] = GeminiProvider(config.gemini_key)
        self._results: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._results_lock = threading.Lock()

    # --- auth ------------------------------------------------------------------

    def redeem(self, code: str) -> dict[str, Any]:
        tester_id, token = self.store.redeem_invite(str(code or ""))
        log("invite_redeemed", tester_id=tester_id)
        return {"ok": True, "session_token": token, "tester_id": tester_id, "pricing_version": PRICING_VERSION}

    def authenticate(self, token: str) -> Tester:
        return self.store.authenticate(token)

    # --- study ------------------------------------------------------------------

    def study(self, tester: Tester, body: dict[str, Any]) -> dict[str, Any]:
        request = self._validate(body)
        model = self.config.default_model
        if model not in PRICING:
            raise RelayError("config", "no priced model configured", 503)
        if request["pricing_version"] != PRICING_VERSION:
            raise RelayError("stale_pricing", f"client pins pricing {request['pricing_version']}; relay is at {PRICING_VERSION}", 409)
        provider_name = PROVIDER_OF[model]
        if provider_name == "gemini" and not self.config.gemini_bounded:
            raise RelayError("provider_ineligible", "Gemini total-output enforcement is unverified; not eligible for bounded dispatch", 503)
        provider = self.providers.get(provider_name)
        if provider is None:
            raise RelayError("config", "provider is not configured", 503)

        input_bound = estimate_input_tokens(request)
        if input_bound > MAX_INPUT_TOKENS:
            raise RelayError("too_large", f"request exceeds the {MAX_INPUT_TOKENS}-token input bound", 413)
        max_cents = max_cost_cents(model, input_bound, MAX_OUTPUT_TOKENS)

        reservation = self.store.reserve(
            request_id=request["request_id"], tester=tester, session_budget_id=request["session_budget_id"], model=model, max_cents=max_cents
        )
        if reservation["duplicate"]:
            return self._replay(reservation)

        started = time.time()
        try:
            result = provider.dispatch(model=model, user_content=build_user_content(request), max_output_tokens=MAX_OUTPUT_TOKENS)
        except BaseException:
            # Never leave the row "reserved": that holds the tester's (and a
            # global) concurrency slot forever (F11). Billing is unknown, so
            # the conservative reservation stays charged.
            self.store.settle(request["request_id"], usage=None, settled_cents=None, status="unknown")
            log("dispatch_crashed", request_id=request["request_id"], tester_id=tester.tester_id, model=model)
            raise
        latency_ms = int((time.time() - started) * 1000)

        if result.status == "billing_unknown":
            self.store.settle(request["request_id"], usage=None, settled_cents=None, status="unknown")
            log("dispatch_unknown", request_id=request["request_id"], tester_id=tester.tester_id, model=model, code=result.error_code, latency_ms=latency_ms)
            return self._remember(request["request_id"], {"ok": True, "request_id": request["request_id"], "status": "billing_unknown", "model_id": model, "endpoint": provider_name, "usage": None, "finish_reason": "", "assessment_proposal": None, "support_rows": [], "error": result.error_code})
        if result.status == "failed":
            self.store.settle(request["request_id"], usage=None, settled_cents=0, status="failed")
            log("dispatch_failed", request_id=request["request_id"], tester_id=tester.tester_id, model=model, code=result.error_code, http_status=result.http_status)
            return self._remember(request["request_id"], {"ok": True, "request_id": request["request_id"], "status": "failed", "model_id": model, "endpoint": provider_name, "usage": None, "finish_reason": "", "assessment_proposal": None, "support_rows": [], "error": result.error_code})

        usage = result.usage or {}
        settled = actual_cost_cents(model, usage) if result.usage else None
        self.store.settle(request["request_id"], usage=usage if result.usage else None, settled_cents=settled, status="completed")
        log(
            "dispatch_settled",
            request_id=request["request_id"],
            tester_id=tester.tester_id,
            model=model,
            status=result.status,
            input_tokens=usage.get("input"),
            output_tokens=usage.get("output"),
            reasoning_tokens=usage.get("reasoning"),
            settled_cents=settled,
            latency_ms=latency_ms,
        )
        # Revoked while the request was in flight: it is billed, but no content leaves.
        try:
            self.store.authenticate_id(tester.tester_id)
        except RelayError:
            raise RelayError("revoked", "access was revoked during the request", 403) from None

        proposal, problem = (None, "")
        brief = None
        status = result.status
        if status == "complete" and request.get("purpose") == "brief":
            brief, problem = validate_brief_proposal(result.text)
            if brief is None:
                status = "malformed"
            elif brief["status"] == "abstained":
                status = "abstained"
        elif status == "complete":
            proposal, problem = validate_proposal(result.text)
            if proposal is None:
                status = "malformed"
            elif proposal["status"] == "abstained":
                status = "abstained"
        response = {
            "ok": True,
            "request_id": request["request_id"],
            "status": status,
            "model_id": model,
            "endpoint": provider_name,
            "usage": usage,
            "finish_reason": result.finish_reason,
            "assessment_proposal": proposal,
            "support_rows": (proposal or {}).get("support_rows", []),
            "brief_proposal": brief,
            "error": problem,
        }
        return self._remember(request["request_id"], response)

    def _replay(self, row: dict[str, Any]) -> dict[str, Any]:
        """Same request id again: never a second provider call."""
        status = row["status"]
        if status == "reserved":
            raise RelayError("in_flight", "this request is still being processed", 409)
        with self._results_lock:
            cached = self._results.get(row["request_id"])
        if cached is not None:
            return {**cached, "replayed": True}
        return {
            "ok": True,
            "request_id": row["request_id"],
            "status": "billing_unknown" if status == "unknown" else "result_unavailable",
            "model_id": row["model"],
            "endpoint": PROVIDER_OF.get(row["model"], ""),
            "usage": None,
            "finish_reason": "",
            "assessment_proposal": None,
            "support_rows": [],
            "error": "result unavailable; saved locally if received",
            "replayed": True,
        }

    def _remember(self, request_id: str, response: dict[str, Any]) -> dict[str, Any]:
        with self._results_lock:
            self._results[request_id] = response
            while len(self._results) > 256:
                self._results.popitem(last=False)
        return response

    def status(self, tester: Tester, request_id: str) -> dict[str, Any]:
        row = self.store.request_status(request_id)
        if row is None or row["tester_id"] != tester.tester_id:
            raise RelayError("not_found", "unknown request", 404)
        return {"ok": True, "request_id": request_id, "status": row["status"], "reserved_cents": row["reserved_cents"], "settled_cents": row["settled_cents"]}

    def usage(self, tester: Tester) -> dict[str, Any]:
        summary = self.store.usage_summary(tester.tester_id)
        return {"ok": True, "tester_id": tester.tester_id, "allowance_cents": tester.allowance_cents, **summary}

    # --- admin ------------------------------------------------------------------

    def admin_invite(self, label: str, allowance_cents: Any) -> dict[str, Any]:
        if allowance_cents is None:
            allowance = self.config.default_tester_allowance_cents
        elif isinstance(allowance_cents, int) and not isinstance(allowance_cents, bool) and 0 < allowance_cents <= MAX_TESTER_ALLOWANCE_CENTS:
            allowance = allowance_cents
        else:
            raise RelayError("validation", f"allowance_cents must be an integer from 1 to {MAX_TESTER_ALLOWANCE_CENTS}")
        tester_id, code = self.store.create_invite(label, allowance)
        log("invite_created", tester_id=tester_id)
        return {"ok": True, "tester_id": tester_id, "invite_code": code}

    def admin_revoke(self, tester_id: str) -> dict[str, Any]:
        self.store.revoke(tester_id)
        log("tester_revoked", tester_id=tester_id)
        return {"ok": True, "tester_id": tester_id}

    def admin_budget(self) -> dict[str, Any]:
        return {"ok": True, "envelope_cents": self.config.envelope_cents, "fixed_fees_cents": self.config.fixed_fees_cents, "inference_allowance_cents": inference_allowance_cents(self.config), **self.store.usage_summary()}

    # --- validation ---------------------------------------------------------------

    def _validate(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise RelayError("validation", "body must be a JSON object")
        extra = set(body) - ALLOWED_FIELDS
        if extra:
            raise RelayError("validation", f"fields not accepted: {sorted(extra)}")
        rid = body.get("request_id")
        sid = body.get("session_budget_id")
        if not isinstance(rid, str) or not _ID_RE.match(rid) or not isinstance(sid, str) or not _ID_RE.match(sid):
            raise RelayError("validation", "request_id and session_budget_id must be short ids")
        if body.get("purpose") not in PURPOSES:
            raise RelayError("validation", f"purpose must be one of {PURPOSES}")
        if body.get("schema_version") != 1:
            raise RelayError("validation", "schema_version must be 1")
        passages = body.get("source_passages") or []
        if not isinstance(passages, list) or len(passages) > LIMITS["passages"]:
            raise RelayError("validation", "source_passages must be a list of at most 6")
        clean: list[dict[str, str]] = []
        for p in passages:
            if not isinstance(p, dict) or not isinstance(p.get("text"), str) or len(p["text"]) > LIMITS["passage"]:
                raise RelayError("validation", "each passage needs text of at most 6000 characters")
            clean.append({"locator": str(p.get("locator", ""))[:200], "text": p["text"]})
        out: dict[str, Any] = {
            "request_id": rid,
            "session_budget_id": sid,
            "purpose": body["purpose"],
            "source_passages": clean,
            "schema_version": 1,
            "pricing_version": str(body.get("pricing_version") or ""),
        }
        for key in ("stem", "rubric", "submitted_answer"):
            value = body.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or len(value) > LIMITS[key]:
                raise RelayError("validation", f"{key} must be a string of at most {LIMITS[key]} characters")
            out[key] = value
        return out
