"""Student context library: anything the student hands Kairos, kept locally.

Files land in ``{user_root}/inbox/library/``:

- ``incoming/``  staging; the desktop app writes raw uploads here, ``ingest`` drains it
- ``files/``     the original bytes, named ``<id><ext>``
- ``text/``      extracted plain text, ``<id>.txt`` (what Ask and the agent read)
- ``index.json`` one entry per file: kind, course, category, text status
- ``INDEX.md``   the same catalog as Markdown, for the brain's truth path

Sorting is local and deterministic: the course comes from matching the
student's synced Canvas courses (``inbox/study-sources``) against the file name
and text; the category from a few keyword rules. Both are guesses the student
can correct (``source: "student"`` then wins over every later re-sort).

Standard library only: the packaged app runs this package with no third-party
dependencies (see ``runtime.rs`` ``study_command``). PDF text extraction is a
best-effort reader for plain FlateDecode text streams; anything it cannot read
is still stored and marked ``text_status: "none"`` rather than guessed at.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import zipfile
import zlib
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from . import canvas
from .model import StudyError, iso

SCHEMA = 1
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_TEXT_CHARS = 400_000
SUMMARY_CHARS = 280
CHUNK_CHARS = 1500

CATEGORIES = ("syllabus", "notes", "slides", "assignment", "study_guide", "reading", "screenshot", "image", "other")

TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".tex", ".rtf", ".html", ".htm", ".xml",
    ".py", ".java", ".c", ".h", ".cpp", ".js", ".ts", ".r", ".m", ".sql",
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".heic", ".webp", ".bmp", ".tif", ".tiff"}
KIND_BY_EXT = {
    ".pdf": "pdf",
    ".docx": "document",
    ".doc": "document",
    ".odt": "document",
    ".pptx": "slides",
    ".key": "slides",
    ".xlsx": "spreadsheet",
    ".csv": "spreadsheet",
    ".tsv": "spreadsheet",
}

STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "from", "have", "has",
    "was", "were", "will", "what", "when", "where", "which", "who", "how", "why", "can", "could", "should",
    "would", "about", "into", "than", "then", "them", "they", "their", "there", "these", "those", "its",
    "our", "out", "all", "any", "each", "also", "just", "more", "most", "some", "such", "only", "over",
    "very", "does", "did", "doing", "being", "been", "here", "help", "need", "want", "please", "explain",
    "introduction", "intro", "course", "class", "university", "section",
}


# ---------- paths ----------


def library_dir(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "library"


def incoming_dir(user_root: Path) -> Path:
    return library_dir(user_root) / "incoming"


def _index_path(user_root: Path) -> Path:
    return library_dir(user_root) / "index.json"


def _text_path(user_root: Path, entry_id: str) -> Path:
    return library_dir(user_root) / "text" / f"{entry_id}.txt"


def _file_path(user_root: Path, entry: dict[str, Any]) -> Path:
    return library_dir(user_root) / "files" / f"{entry['id']}{entry.get('ext') or ''}"


def _atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(data, encoding="utf-8")
    os.replace(tmp, path)


def load_index(user_root: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(_index_path(user_root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    entries = raw.get("entries") if isinstance(raw, dict) else None
    return [e for e in entries or [] if isinstance(e, dict) and e.get("id")]


def _save_index(user_root: Path, entries: list[dict[str, Any]]) -> None:
    entries = sorted(entries, key=lambda e: str(e.get("added_at") or ""), reverse=True)
    _atomic_write(_index_path(user_root), json.dumps({"schema": SCHEMA, "entries": entries}, indent=1))
    _atomic_write(library_dir(user_root) / "INDEX.md", _render_markdown(entries))


# ---------- text extraction ----------


def _decode(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


def _strip_markup(text: str) -> str:
    text = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return unescape(text)


def _strip_rtf(text: str) -> str:
    text = re.sub(r"\\par[d]?\b", "\n", text)
    text = re.sub(r"\\'[0-9a-f]{2}", "", text)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
    return re.sub(r"[{}]", "", text)


def _xml_text(data: bytes, para_tag: str, text_tag: str) -> str:
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError:
        return ""
    lines: list[str] = []
    for para in root.iter():
        if para.tag.endswith("}" + para_tag):
            line = "".join(node.text or "" for node in para.iter() if node.tag.endswith("}" + text_tag))
            if line.strip():
                lines.append(line)
    return "\n".join(lines)


def _docx_text(data: bytes) -> str:
    with zipfile.ZipFile(_bytes_io(data)) as archive:
        return _xml_text(archive.read("word/document.xml"), "p", "t")


def _pptx_text(data: bytes) -> str:
    with zipfile.ZipFile(_bytes_io(data)) as archive:
        slides = [n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        slides.sort(key=lambda n: int(re.findall(r"\d+", n)[-1]))
        parts = []
        for number, name in enumerate(slides, start=1):
            body = _xml_text(archive.read(name), "p", "t")
            if body.strip():
                parts.append(f"Slide {number}\n{body}")
        return "\n\n".join(parts)


def _xlsx_text(data: bytes) -> str:
    with zipfile.ZipFile(_bytes_io(data)) as archive:
        if "xl/sharedStrings.xml" not in archive.namelist():
            return ""
        return _xml_text(archive.read("xl/sharedStrings.xml"), "si", "t")


def _odt_text(data: bytes) -> str:
    with zipfile.ZipFile(_bytes_io(data)) as archive:
        try:
            root = ElementTree.fromstring(archive.read("content.xml"))
        except (KeyError, ElementTree.ParseError):
            return ""
        return "\n".join("".join(node.itertext()) for node in root.iter() if node.tag.endswith("}p") or node.tag.endswith("}h"))


def _bytes_io(data: bytes) -> Any:
    from io import BytesIO

    return BytesIO(data)


_PDF_STRING = re.compile(rb"\((?:\\.|[^\\)])*\)")


def _pdf_unescape(raw: bytes) -> str:
    out = bytearray()
    i = 0
    body = raw[1:-1]
    while i < len(body):
        c = body[i]
        if c == 0x5C and i + 1 < len(body):  # backslash
            n = body[i + 1]
            mapping = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12, ord("("): 40, ord(")"): 41, 0x5C: 0x5C}
            if n in mapping:
                out.append(mapping[n])
                i += 2
                continue
            octal = re.match(rb"[0-7]{1,3}", body[i + 1 : i + 4])
            if octal:
                out.append(int(octal.group(0), 8) & 0xFF)
                i += 1 + len(octal.group(0))
                continue
            i += 2
            continue
        out.append(c)
        i += 1
    return out.decode("latin-1")


def _pdf_text(data: bytes) -> str:
    """Text-showing operators from FlateDecode/plain content streams. Fonts
    with custom encodings come out as noise; ``_looks_like_text`` rejects that."""
    lines: list[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.DOTALL):
        stream = match.group(1)
        header = data[max(0, match.start() - 400) : match.start()]
        if b"/FlateDecode" in header:
            try:
                stream = zlib.decompress(stream)
            except zlib.error:
                continue
        elif b"/Filter" in header:
            continue
        if b"Tj" not in stream and b"TJ" not in stream:
            continue
        current: list[str] = []
        for token in re.finditer(rb"\[(.*?)\]\s*TJ|(\((?:\\.|[^\\)])*\))\s*(?:Tj|'|\")|(T\*|Td|TD|ET)", stream, re.DOTALL):
            if token.group(1) is not None:
                current.append("".join(_pdf_unescape(s) for s in _PDF_STRING.findall(token.group(1))))
            elif token.group(2) is not None:
                current.append(_pdf_unescape(token.group(2)))
            elif current:
                lines.append("".join(current))
                current = []
        if current:
            lines.append("".join(current))
    return "\n".join(line for line in lines if line.strip())


def _looks_like_text(text: str) -> bool:
    sample = text[:4000]
    if len(sample.strip()) < 20:
        return False
    letters = sum(1 for ch in sample if ch.isalpha() or ch.isspace())
    return letters / max(1, len(sample)) > 0.7


def extract_text(name: str, data: bytes) -> tuple[str, str]:
    """(text, status) where status is ``full``, ``partial`` or ``none``."""
    ext = Path(name).suffix.lower()
    try:
        if ext in {".html", ".htm", ".xml"}:
            return _strip_markup(_decode(data)), "full"
        if ext == ".rtf":
            return _strip_rtf(_decode(data)), "full"
        if ext in TEXT_EXTS:
            return _decode(data), "full"
        if ext == ".docx":
            return _docx_text(data), "full"
        if ext == ".pptx":
            return _pptx_text(data), "full"
        if ext == ".xlsx":
            return _xlsx_text(data), "partial"
        if ext == ".odt":
            return _odt_text(data), "full"
        if ext == ".pdf":
            text = _pdf_text(data)
            return (text, "partial") if _looks_like_text(text) else ("", "none")
    except (zipfile.BadZipFile, KeyError, OSError, ValueError):
        return "", "none"
    return "", "none"


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_TEXT_CHARS]


# ---------- sorting ----------


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z][a-z0-9']{2,}", text.lower()) if w not in STOPWORDS]


def _courses(user_root: Path) -> list[dict[str, str]]:
    rows = []
    for record in canvas.list_course_records(user_root):
        course = record.get("course") or {}
        if course.get("id") is None:
            continue
        rows.append(
            {
                "id": str(course.get("id")),
                "label": str(course.get("label") or course.get("code") or course.get("name") or ""),
                "code": str(course.get("code") or ""),
                "name": str(course.get("name") or ""),
            }
        )
    return rows


def _code_pattern(code: str) -> re.Pattern[str] | None:
    m = re.match(r"\s*([A-Za-z]{2,5})[\s_-]*(\d{3,4}[A-Za-z]?)", code)
    if not m:
        return None
    return re.compile(rf"\b{re.escape(m.group(1))}[\s_-]*{re.escape(m.group(2))}\b", re.IGNORECASE)


def guess_course(courses: list[dict[str, str]], name: str, text: str) -> dict[str, str] | None:
    head = text[:20000]
    scores: list[tuple[int, dict[str, str]]] = []
    for course in courses:
        score = 0
        pattern = _code_pattern(course["code"]) or _code_pattern(course["label"])
        if pattern:
            score += 6 * len(pattern.findall(name)) + 3 * min(4, len(pattern.findall(head)))
        name_words = {w for w in _words(course["name"]) if len(w) >= 4}
        if name_words:
            file_words = set(_words(name))
            text_words = set(_words(head))
            score += 2 * len(name_words & file_words) + len(name_words & text_words)
            if len(name_words) > 1 and name_words <= text_words:
                score += 2
        if score:
            scores.append((score, course))
    if not scores:
        return None
    scores.sort(key=lambda s: s[0], reverse=True)
    best, course = scores[0]
    runner_up = scores[1][0] if len(scores) > 1 else 0
    if best < 3 or best - runner_up < 2:
        return None
    return course


_CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("syllabus", re.compile(r"\bsyllabus\b|\bcourse (schedule|policies)\b|\boffice hours\b.*\bgrading\b", re.I | re.S)),
    ("study_guide", re.compile(r"\bstudy guide\b|\b(exam|midterm|final|quiz) (review|prep)\b|\breview sheet\b|\bpractice (exam|test|problems)\b", re.I)),
    ("assignment", re.compile(r"\bhomework\b|\bhw ?\d+\b|\bproblem set\b|\bpset\b|\bassignment\b|\blab ?\d+\b|\bproject (brief|description)\b", re.I)),
    ("slides", re.compile(r"\bslides?\b|\blecture ?\d+\b", re.I)),
    ("notes", re.compile(r"\bnotes?\b|\bmy notes\b|\bclass notes\b", re.I)),
    ("reading", re.compile(r"\bchapter ?\d+\b|\breading\b|\barticle\b|\babstract\b|\btextbook\b", re.I)),
]


def guess_category(name: str, kind: str, text: str) -> str:
    stem = Path(name).stem.replace("_", " ").replace("-", " ")
    if kind == "image":
        return "screenshot" if re.search(r"screen ?shot|screen ?capture|^img_|^cleanshot", stem, re.I) else "image"
    for category, pattern in _CATEGORY_RULES:
        if pattern.search(stem):
            return category
    if kind == "slides":
        return "slides"
    head = text[:3000]
    for category, pattern in _CATEGORY_RULES:
        if pattern.search(head):
            return category
    return "other"


def _kind(ext: str) -> str:
    if ext in IMAGE_EXTS:
        return "image"
    if ext in KIND_BY_EXT:
        return KIND_BY_EXT[ext]
    if ext in TEXT_EXTS:
        return "text"
    return "other"


def _safe_name(name: str) -> str:
    base = Path(str(name or "file")).name.strip().replace("\x00", "")
    base = re.sub(r"[\r\n\t/\\]", " ", base)
    return base[:180] or "file"


def _summary(text: str) -> str:
    flat = re.sub(r"\s+", " ", text).strip()
    return flat[:SUMMARY_CHARS] + ("…" if len(flat) > SUMMARY_CHARS else "")


# ---------- operations ----------


def add_bytes(user_root: Path, name: str, data: bytes, now: datetime) -> dict[str, Any]:
    """Store one file. Returns ``{"status": "added"|"duplicate", "entry": ...}``."""
    if len(data) == 0:
        raise StudyError("validation", f"{_safe_name(name)} is empty")
    if len(data) > MAX_FILE_BYTES:
        raise StudyError("validation", f"{_safe_name(name)} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB")
    name = _safe_name(name)
    digest = hashlib.sha256(data).hexdigest()
    entries = load_index(user_root)
    existing = next((e for e in entries if e.get("sha256") == digest), None)
    if existing is not None:
        return {"status": "duplicate", "entry": existing}
    ext = Path(name).suffix.lower()[:12]
    kind = _kind(ext)
    text, status = extract_text(name, data)
    text = _clean(text)
    if not text:
        status = "none"
    course = guess_course(_courses(user_root), name, text)
    entry = {
        "id": digest[:16],
        "name": name,
        "ext": ext,
        "kind": kind,
        "bytes": len(data),
        "sha256": digest,
        "added_at": iso(now),
        "course_id": course["id"] if course else None,
        "course_label": course["label"] if course else None,
        "course_source": "matched" if course else "none",
        "category": guess_category(name, kind, text),
        "category_source": "matched",
        "text_status": status,
        "chars": len(text),
        "summary": _summary(text),
    }
    target = _file_path(user_root, entry)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    if text:
        _atomic_write(_text_path(user_root, digest[:16]), text)
    entries.append(entry)
    _save_index(user_root, entries)
    return {"status": "added", "entry": entry}


def ingest_incoming(user_root: Path, now: datetime) -> dict[str, Any]:
    """Drain ``incoming/``. Staged names are ``<anything>--<original name>``."""
    directory = incoming_dir(user_root)
    added: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    if directory.is_dir():
        for path in sorted(directory.iterdir()):
            if not path.is_file() or path.name.startswith("."):
                continue
            original = path.name.split("--", 1)[1] if "--" in path.name else path.name
            try:
                result = add_bytes(user_root, original, path.read_bytes(), now)
            except StudyError as exc:
                errors.append({"name": original, "message": exc.message})
            except OSError as exc:
                errors.append({"name": original, "message": f"could not read the file: {exc.strerror or exc}"})
            else:
                (added if result["status"] == "added" else duplicates).append(result["entry"])
            try:
                path.unlink()
            except OSError:
                pass
    return {"ok": True, "added": added, "duplicates": duplicates, "errors": errors, "library": list_view(user_root)}


def list_view(user_root: Path) -> dict[str, Any]:
    entries = load_index(user_root)
    courses = _courses(user_root)
    return {
        "entries": entries,
        "courses": [{"id": c["id"], "label": c["label"]} for c in courses],
        "categories": list(CATEGORIES),
        "total_bytes": sum(int(e.get("bytes") or 0) for e in entries),
    }


def update_entry(user_root: Path, entry_id: str, params: dict[str, Any]) -> dict[str, Any]:
    entries = load_index(user_root)
    entry = next((e for e in entries if e["id"] == entry_id), None)
    if entry is None:
        raise StudyError("not_found", "that file is not in your library")
    if "course_id" in params:
        course_id = params.get("course_id")
        if course_id in (None, ""):
            entry.update(course_id=None, course_label=None, course_source="student")
        else:
            course = next((c for c in _courses(user_root) if c["id"] == str(course_id)), None)
            if course is None:
                raise StudyError("validation", "that course is not in your synced Canvas courses")
            entry.update(course_id=course["id"], course_label=course["label"], course_source="student")
    if "category" in params:
        category = str(params.get("category") or "")
        if category not in CATEGORIES:
            raise StudyError("validation", f"category must be one of {', '.join(CATEGORIES)}")
        entry.update(category=category, category_source="student")
    _save_index(user_root, entries)
    return {"ok": True, "entry": entry}


def remove_entry(user_root: Path, entry_id: str) -> dict[str, Any]:
    entries = load_index(user_root)
    entry = next((e for e in entries if e["id"] == entry_id), None)
    if entry is None:
        raise StudyError("not_found", "that file is not in your library")
    for path in (_file_path(user_root, entry), _text_path(user_root, entry_id)):
        try:
            path.unlink()
        except OSError:
            pass
    _save_index(user_root, [e for e in entries if e["id"] != entry_id])
    return {"ok": True, "removed": entry_id}


def resort(user_root: Path) -> dict[str, Any]:
    """Re-guess courses after a Canvas sync; student corrections are kept."""
    entries = load_index(user_root)
    courses = _courses(user_root)
    for entry in entries:
        if entry.get("course_source") == "student":
            continue
        text = read_text(user_root, entry["id"])
        course = guess_course(courses, entry["name"], text)
        entry.update(
            course_id=course["id"] if course else None,
            course_label=course["label"] if course else None,
            course_source="matched" if course else "none",
        )
    _save_index(user_root, entries)
    return {"ok": True, "library": list_view(user_root)}


def read_text(user_root: Path, entry_id: str) -> str:
    try:
        return _text_path(user_root, entry_id).read_text(encoding="utf-8")
    except OSError:
        return ""


# ---------- retrieval ----------


def _chunks(text: str) -> list[str]:
    paragraphs = re.split(r"\n\s*\n", text)
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) + 2 > CHUNK_CHARS and current:
            chunks.append(current)
            current = ""
        while len(para) > CHUNK_CHARS:
            chunks.append(para[:CHUNK_CHARS])
            para = para[CHUNK_CHARS:]
        current = f"{current}\n\n{para}" if current else para
    if current.strip():
        chunks.append(current)
    return chunks


def search(user_root: Path, query: str, *, course_id: str | None = None, limit: int = 2) -> list[dict[str, Any]]:
    """Best-matching passages for ``query``. Files filed under another course
    are skipped when ``course_id`` is known; unsorted files stay eligible."""
    terms = set(_words(query))
    if not terms:
        return []
    hits: list[tuple[float, dict[str, Any]]] = []
    for entry in load_index(user_root):
        if entry.get("text_status") == "none":
            continue
        if course_id and entry.get("course_id") and str(entry["course_id"]) != str(course_id):
            continue
        text = read_text(user_root, entry["id"])
        if not text:
            continue
        name_terms = set(_words(entry.get("name") or ""))
        for chunk in _chunks(text):
            words = _words(chunk)
            if not words:
                continue
            present = terms & set(words)
            if not present:
                continue
            score = len(present) * 2 + sum(min(3, words.count(t)) for t in present) * 0.5
            score += len(terms & name_terms)
            if course_id and entry.get("course_id") == str(course_id):
                score += 1
            hits.append((score, {"entry": entry, "text": chunk.strip()}))
    hits.sort(key=lambda h: h[0], reverse=True)
    picked: list[dict[str, Any]] = []
    seen: set[str] = set()
    floor = 4 if len(terms) > 1 else 2.5
    for score, hit in hits:
        if score < floor or hit["entry"]["id"] in seen:
            continue
        seen.add(hit["entry"]["id"])
        picked.append(hit)
        if len(picked) >= limit:
            break
    return picked


# ---------- markdown catalog ----------

CATEGORY_LABELS = {
    "syllabus": "Syllabus",
    "notes": "Notes",
    "slides": "Slides",
    "assignment": "Assignment",
    "study_guide": "Study guide",
    "reading": "Reading",
    "screenshot": "Screenshot",
    "image": "Image",
    "other": "Other",
}


def _render_markdown(entries: list[dict[str, Any]]) -> str:
    lines = [
        "# Student library",
        "",
        "Files the student added in Kairos. Extracted text is in `text/<id>.txt`; originals in `files/`.",
        "Course and category are local guesses unless marked (student). Read the text file before relying on an entry.",
        "",
    ]
    groups: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        groups.setdefault(str(entry.get("course_label") or "Not sorted to a course"), []).append(entry)
    for label in sorted(groups, key=lambda g: (g == "Not sorted to a course", g.lower())):
        lines.append(f"## {label}")
        lines.append("")
        for entry in groups[label]:
            category = CATEGORY_LABELS.get(str(entry.get("category")), "Other")
            if entry.get("category_source") == "student":
                category += " (student)"
            text_note = {"full": f"{entry.get('chars', 0)} chars", "partial": f"{entry.get('chars', 0)} chars, partial"}.get(
                str(entry.get("text_status")), "no text extracted"
            )
            lines.append(f"- **{entry['name']}** — {category}, added {str(entry.get('added_at') or '')[:10]}, {text_note}. `text/{entry['id']}.txt`")
            if entry.get("summary"):
                lines.append(f"  - {entry['summary']}")
        lines.append("")
    return "\n".join(lines)
