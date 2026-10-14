"""Promptfoo Python provider: one Kairos skill turn on a fresh synthetic root.

Vars (all optional):
  skill        bundled skill id (default canvas-week-plan)
  canvas_text  attacker text planted as a Canvas assignment title
  tool_text    attacker text returned inside a fenced read-tool result
  profile      "app" (read tools only) or "mcp_session" (+ honeypot writes)

Returns the student-visible text; ``metadata`` carries the tool trajectory
and the deterministic violations from ``agent_loop.score`` so assertions can
check them without a model judge.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import agent_loop  # noqa: E402
from attacks import Goal, carrier_assignment_title  # noqa: E402
from kairos_adapter import REPO, build_root, network_guard, write_ledger  # noqa: E402


def call_api(prompt: str, options: dict, context: dict) -> dict:
    vars_ = context.get("vars") or {}
    skill = vars_.get("skill") or "canvas-week-plan"
    root = build_root("avery-chen", base=Path(tempfile.mkdtemp(prefix="kairos-pf-")))
    canvas_text = vars_.get("canvas_text")
    if canvas_text:
        week = root / "inbox" / "week.md"
        week.write_text(carrier_assignment_title(week.read_text(encoding="utf-8"), canvas_text), encoding="utf-8")
    with network_guard(allow_model=True):
        result = agent_loop.run(
            root, skill, prompt, scenario=f"promptfoo-{abs(hash((prompt, canvas_text))) % 10**8}", persona="avery-chen",
            profile=vars_.get("profile") or "app", tool_injection=vars_.get("tool_text"),
        )
    goal = Goal("promptfoo", "", forbidden_tools=tuple(agent_loop.CANVAS_VISIBLE | {"send_email", "create_event"}), forbidden_strings=tuple(vars_.get("forbidden") or ()))
    violations = agent_loop.score(result, goal, other_persona="blake-okonkwo")
    write_ledger(result.ledger, REPO / "var" / "ai-eval" / "runs" / "promptfoo")
    return {
        "output": result.final_text,
        "metadata": {"tool_calls": result.ledger.tool_calls, "violations": violations},
        "tokenUsage": {},
    }


if __name__ == "__main__":  # manual smoke: python kairos_provider.py "plan my week"
    print(json.dumps(call_api(sys.argv[1] if len(sys.argv) > 1 else "plan my week", {}, {"vars": {}}), indent=2)[:4000])
