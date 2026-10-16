"""Pinned pricing, bounds and environment configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# USD per million tokens; accessed 2026-09-18 (revised spec §7.3). A dispatch
# is refused when its model is absent here or the version does not match the
# caller's pinned version — stale rates never price a reservation.
PRICING_VERSION = "2026-09-18"
PRICING: dict[str, dict[str, float]] = {
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},
    "claude-sonnet-5": {"input": 2.00, "output": 10.00},
    "gemini-3.5-flash-lite": {"input": 0.30, "output": 2.50},
}
PROVIDER_OF = {
    "claude-haiku-4-5": "anthropic",
    "claude-sonnet-5": "anthropic",
    "gemini-3.5-flash-lite": "gemini",
}

MAX_INPUT_TOKENS = 8000
MAX_OUTPUT_TOKENS = 2400  # visible + reasoning; reasoning disabled for Claude baseline
MAX_DISPATCHES_PER_SESSION = 6
PER_TESTER_CONCURRENCY = 1
GLOBAL_CONCURRENCY = 3
REQUEST_TIMEOUT_SECONDS = 30
MAX_BODY_BYTES = 128 * 1024
CLIENT_SOCKET_TIMEOUT_SECONDS = 5
# A reservation still "reserved" after this long belongs to a dispatch that
# crashed or a process that restarted mid-call; it is reaped to "unknown"
# (keeping the conservative charge) so it stops holding concurrency slots (F11).
STALE_RESERVATION_SECONDS = REQUEST_TIMEOUT_SECONDS * 2
MIN_ADMIN_TOKEN_CHARS = 32
MAX_TESTER_ALLOWANCE_CENTS = 1_000_000  # sanity bound; the global envelope is the real cap


@dataclass(frozen=True)
class Config:
    db_path: str = field(default_factory=lambda: os.environ.get("RELAY_DB", "relay.sqlite3"))
    admin_token: str = field(default_factory=lambda: os.environ.get("RELAY_ADMIN_TOKEN", ""))
    anthropic_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))
    gemini_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    gemini_bounded: bool = field(default_factory=lambda: os.environ.get("RELAY_GEMINI_BOUNDED") == "1")
    default_model: str = field(default_factory=lambda: os.environ.get("RELAY_MODEL", "claude-haiku-4-5"))
    # The owner's envelope is $50 *inclusive* of hosting/fees (clarification
    # recorded 2026-09-18): fixed charges are carved out before inference.
    envelope_cents: int = field(default_factory=lambda: int(os.environ.get("RELAY_ENVELOPE_CENTS", "5000")))
    fixed_fees_cents: int = field(default_factory=lambda: int(os.environ.get("RELAY_FIXED_FEES_CENTS", "1000")))
    default_tester_allowance_cents: int = field(default_factory=lambda: int(os.environ.get("RELAY_TESTER_ALLOWANCE_CENTS", "400")))
    host: str = field(default_factory=lambda: os.environ.get("RELAY_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("RELAY_PORT", "8787")))

    @property
    def admin_enabled(self) -> bool:
        """Admin endpoints exist only behind a long token: there is no rate limit here."""
        return len(self.admin_token) >= MIN_ADMIN_TOKEN_CHARS


def inference_allowance_cents(config: Config) -> int:
    return max(0, config.envelope_cents - config.fixed_fees_cents)


def max_cost_cents(model: str, input_tokens: int, output_tokens: int) -> int:
    """Ceiling of the reservation for a dispatch at the pinned rates."""
    rates = PRICING[model]
    usd = (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1e6
    cents = int(usd * 100)
    return cents + (1 if usd * 100 > cents else 0)


def actual_cost_cents(model: str, usage: dict[str, int]) -> int:
    rates = PRICING[model]
    billable_out = int(usage.get("output", 0)) + int(usage.get("reasoning", 0))
    usd = (int(usage.get("input", 0)) * rates["input"] + billable_out * rates["output"]) / 1e6
    cents = int(usd * 100)
    return cents + (1 if usd * 100 > cents else 0)
