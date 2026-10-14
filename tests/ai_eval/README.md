# ai_eval — beta-readiness harness

Black-box student journeys and attacks against isolated synthetic roots
(`avery-chen`, `blake-okonkwo`). Deterministic invariants decide safety;
model-graded scores only add to them. Findings: `docs/audits/ai-eval-2026-10-12/REPORT.md`.

```text
persona + scenario → isolated root (kairos_adapter.build_root, canaries planted)
  → Kairos entry point (prompt assembly · study core · native host · relay · actuator gate)
  → student-visible output + tool trajectory + root diff + network attempts
  → deterministic invariants  (+ Sonnet 4.6 judge for usefulness only)
```

| Layer | Files | Needs |
|---|---|---|
| Deterministic attacks + invariants | `test_*.py` (not `test_model_redteam.py`) | nothing; network blocked except loopback |
| AgentDojo-style red team | `attacks.py`, `agent_loop.py`, `test_model_redteam.py` | `ANTHROPIC_API_KEY` (Claude Sonnet 4.6) |
| Promptfoo (fixed corpus + generated red team) | `promptfoo/` | key; Promptfoo in `~/.cache/kairos-promptfoo` |
| DeepEval multi-turn journeys | `deepeval/test_journeys.py` | key; `var/ai-eval/venv` |
| Locust relay load | `load/` | `var/ai-eval/venv`; stub provider only |

No local models: target, attacker and judge are `claude-sonnet-4-6`
(override with `KAIROS_EVAL_MODEL` / `KAIROS_JUDGE_MODEL`). Nothing is sent to
Promptfoo Cloud or Confident AI (`sharing: false`, `--no-share`).

## Run

```bash
# one-time
uv venv --python 3.12 var/ai-eval/venv
uv pip install --python var/ai-eval/venv/bin/python -e . locust deepeval pytest pytest-asyncio
(mkdir -p ~/.cache/kairos-promptfoo && cd ~/.cache/kairos-promptfoo && npm init -y && npm i promptfoo)

# free layers (~5 min; the corruption fuzz is most of it)
.venv/bin/python tests/ai_eval/run_wave.py --baseline --load

# paid layers (Sonnet 4.6)
export ANTHROPIC_API_KEY=...
.venv/bin/python tests/ai_eval/run_wave.py --model
(cd tests/ai_eval/promptfoo && PROMPTFOO_DISABLE_TELEMETRY=1 npx --prefix ~/.cache/kairos-promptfoo promptfoo redteam run -c redteam.yaml --no-share)
```

Results: `var/ai-eval/waves/<stamp>/{summary.md,summary.json,results.sqlite}`,
per-run ledgers in `var/ai-eval/runs/`, and every wave appended to
`var/ai-eval/history.sqlite`.

## Conventions

- A reproduced weakness is pinned with `finding("F<n>", why)` (strict xfail).
  Fixing it turns the test into XPASS, which fails the run until the marker is
  removed, so a fix is never silent and a regression is never silent either.
- Every model-run hit gets minimized into `promptfoo/promptfooconfig.yaml`
  (or a deterministic test here) before it is called fixed.
- Never point any of this at real Canvas, a real profile, or a relay holding a
  vendor key. `build_root` refuses the OS app-support root; the Locust file
  refuses non-loopback hosts.
