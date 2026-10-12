"""Bounded deterministic checkers. Anything outside a declared scope abstains.

A checker never reads prose meaning. It compares a student's field against a
supported key form: exact choice, true/false, numeric within tolerance, or a
normalized expression template. Unknown checker types are not a pass.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

_SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_MINUS_VARIANTS = ("−", "–", "—", "‐")
_NUMBER_RE = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")
# One simple fraction ("1/2", "-3 / 4") is one value, not two numbers.
_FRACTION_RE = re.compile(r"^([-+]?\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)(?=\s|$|[a-z%])", re.IGNORECASE)


@dataclass(frozen=True)
class FieldResult:
    field_id: str
    label: str
    passed: bool
    scored: bool
    note: str = ""


@dataclass
class Grade:
    outcome: str  # correct | partial | incorrect | uncertain
    grader: str  # deterministic | abstained
    scope: str
    fields: list[FieldResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome,
            "grader": self.grader,
            "scope": self.scope,
            "fields": [
                {
                    "field_id": f.field_id,
                    "label": f.label,
                    "passed": f.passed,
                    "scored": f.scored,
                    "note": f.note,
                }
                for f in self.fields
            ],
        }


def _norm_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    for variant in _MINUS_VARIANTS:
        text = text.replace(variant, "-")
    return " ".join(text.casefold().split())


def normalize_expression(value: str) -> str:
    # Translate superscripts before NFKC, which would otherwise flatten ³ to 3.
    text = (value or "")
    for ch in "⁰¹²³⁴⁵⁶⁷⁸⁹":
        if ch in text:
            text = text.replace(ch, "^" + ch.translate(_SUPERSCRIPTS))
    text = unicodedata.normalize("NFKC", text)
    for variant in _MINUS_VARIANTS:
        text = text.replace(variant, "-")
    text = text.casefold()
    text = text.replace("**", "^")
    # Interval notation as courses print it: ∞/inf/infinity and ∪/U are one spelling.
    text = text.replace("∞", "inf").replace("infinity", "inf").replace("∪", "u")
    text = re.sub(r"\s+", "", text)
    # Implicit-multiplication signs vanish only next to a symbol or bracket;
    # between two digits they stay, so "2*3" is never read as "23".
    text = re.sub(r"(?<=[a-z)\]])[*·×]|[*·×](?=[a-z(\[])", "", text)
    text = text.replace("·", "*").replace("×", "*")
    text = text.replace("{", "(").replace("}", ")").replace("[", "(").replace("]", ")")
    # (x) -> x for single-letter arguments; sin(x) -> sinx, sin^3(x) -> sin^3x
    text = re.sub(r"\(([a-z])\)", r"\1", text)
    # y'= / y = / dy/dx = prefixes are not part of the answer
    text = re.sub(r"^(y'|y′|dy/dx|y|f'\(x\)|f'x)=", "", text)
    text = text.replace("′", "'")
    # Superscript digits already translated; handle ^ followed by digits then function arg forms:
    # sin^3x and (sinx)^3 are both accepted by listing both in the key.
    return text


def _norm_choice(value: str) -> str:
    text = _norm_text(value)
    text = text.replace("(", "").replace(")", "").replace(".", "").strip()
    text = re.sub(r"^(the|answer:|answer)\s+", "", text)
    return text.replace(" ", "")


def _norm_bool(value: str) -> str | None:
    text = _norm_text(value)
    head = text.split(".")[0].split(",")[0].strip() if text else ""
    if head in ("true", "t", "yes", "correct"):
        return "true"
    if head in ("false", "f", "no", "incorrect"):
        return "false"
    if text.startswith("true"):
        return "true"
    if text.startswith("false"):
        return "false"
    return None


def _check_numeric(spec: dict[str, Any], value: str) -> tuple[bool, str]:
    text = unicodedata.normalize("NFKC", value or "")
    for variant in _MINUS_VARIANTS:
        text = text.replace(variant, "-")
    # Strict grammar: exactly one number, optionally with the declared unit and
    # a leading "x =" / "≈". Two numbers ("not 2; it is 99") is not a pass.
    stripped = re.sub(r"^\s*[a-z]\s*[=≈~]\s*", "", text.strip(), flags=re.IGNORECASE)
    fraction = _FRACTION_RE.match(stripped)
    if fraction and float(fraction.group(2)) != 0:
        quotient = float(fraction.group(1)) / float(fraction.group(2))
        stripped = f"{quotient!r}{stripped[fraction.end():]}"
    matches = _NUMBER_RE.findall(stripped)
    if not matches:
        return False, "no number found"
    if len(matches) > 1:
        return False, "state one value, not several numbers"
    try:
        target = float(spec["value"])
    except (KeyError, TypeError, ValueError):
        return False, "checker key invalid"
    tol_pct = spec.get("tolerance_pct")
    tol_abs = spec.get("tolerance_abs")
    unit = str(spec.get("unit") or "")
    if unit and spec.get("require_unit") and unit.casefold() not in text.casefold():
        return False, f"unit {unit} missing"
    for raw in matches:
        try:
            candidate = float(raw)
        except ValueError:
            continue
        if tol_pct is not None and target != 0:
            if abs(candidate - target) / abs(target) <= float(tol_pct) / 100.0:
                return True, ""
        elif tol_abs is not None:
            if abs(candidate - target) <= float(tol_abs):
                return True, ""
        elif candidate == target:
            return True, ""
    return False, "outside tolerance"


def check_field(spec: dict[str, Any], value: str) -> tuple[bool, bool, str]:
    """Return (scored, passed, note). ``scored`` is False for unsupported scopes."""
    kind = str(spec.get("type") or "none")
    if kind == "none":
        return False, False, "not scored deterministically"
    if kind == "choice":
        accept = {_norm_choice(str(a)) for a in spec.get("accept") or []}
        return True, _norm_choice(value) in accept, ""
    if kind == "true_false":
        expected = _norm_bool(str(spec.get("accept") or ""))
        got = _norm_bool(value)
        if expected is None:
            return False, False, "checker key invalid"
        if got is None:
            return True, False, "answer did not state true or false"
        return True, got == expected, ""
    if kind == "numeric":
        passed, note = _check_numeric(spec, value)
        return True, passed, note
    if kind == "expression":
        accept = {normalize_expression(str(a)) for a in spec.get("accept") or []}
        return True, normalize_expression(value) in accept, ""
    return False, False, f"unsupported checker {kind!r}"


def grade(
    fields: list[dict[str, Any]],
    response_fields: dict[str, str],
    response_text: str,
) -> Grade:
    """Grade only the declared scorable fields; abstain when there are none."""
    results: list[FieldResult] = []
    scorable = [f for f in fields if str((f.get("checker") or {}).get("type", "none")) != "none"]
    for spec in fields:
        fid = str(spec.get("id") or "")
        label = str(spec.get("label") or fid)
        checker = spec.get("checker") or {}
        value = response_fields.get(fid, "")
        if not value and len(scorable) == 1 and spec is scorable[0]:
            value = response_text
        scored, passed, note = check_field(checker, value)
        results.append(FieldResult(fid, label, passed, scored, note))
    scored_results = [r for r in results if r.scored]
    scope = "; ".join(r.label for r in scored_results)
    if not scored_results:
        return Grade("uncertain", "abstained", "", results)
    passed_count = sum(1 for r in scored_results if r.passed)
    if passed_count == len(scored_results):
        outcome = "correct"
    elif passed_count == 0:
        outcome = "incorrect"
    else:
        outcome = "partial"
    return Grade(outcome, "deterministic", scope, results)
