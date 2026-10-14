"""Student context library: store anything, sort it, hand it to Ask."""

from __future__ import annotations

import io
import json
import shutil
import zipfile
import zlib
from datetime import datetime
from pathlib import Path

import pytest

from canvas_mcp.core.study import library
from canvas_mcp.core.study.ask import relay_payload, select_context
from canvas_mcp.core.study.model import StudyError
from canvas_mcp.core.study.service import StudyService

Z = "America/Denver"
NOW = datetime.fromisoformat("2026-09-20T10:00:00-06:00")
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "study" / "canvas_course_4242.json"


def seed_courses(root: Path) -> None:
    directory = root / "inbox" / "study-sources"
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURE, directory / "4242.json")
    history = {
        "schema": 1,
        "course": {"id": "5151", "name": "World History", "code": "HIST 1010", "label": "HIST 1010 — World History"},
        "fetched_at": "2026-09-18T15:00:00Z",
        "sources": [],
        "exams": [],
    }
    (directory / "5151.json").write_text(json.dumps(history), encoding="utf-8")


def docx(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        body = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in text.split("\n"))
        z.writestr(
            "word/document.xml",
            f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>',
        )
    return buf.getvalue()


def pptx(slides: list[str]) -> bytes:
    buf = io.BytesIO()
    ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    with zipfile.ZipFile(buf, "w") as z:
        for i, text in enumerate(slides, start=1):
            z.writestr(f"ppt/slides/slide{i}.xml", f"<p:sld {ns} xmlns:p='p'><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sld>")
    return buf.getvalue()


def pdf(text: str) -> bytes:
    content = zlib.compress(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1"))
    return (
        b"%PDF-1.4\n1 0 obj\n<< /Length " + str(len(content)).encode() + b" /Filter /FlateDecode >>\nstream\n"
        + content
        + b"\nendstream\nendobj\n%%EOF"
    )


def test_text_note_is_stored_extracted_and_sorted_to_its_course(tmp_path: Path) -> None:
    seed_courses(tmp_path)
    note = b"MATH 1300 lecture notes\n\nThe chain rule: differentiate the outer function, keep the inner, multiply by the inner derivative."
    result = library.add_bytes(tmp_path, "week3 notes.txt", note, NOW)
    entry = result["entry"]
    assert result["status"] == "added"
    assert entry["course_id"] == "4242" and entry["course_source"] == "matched"
    assert entry["category"] == "notes"
    assert entry["text_status"] == "full"
    assert (tmp_path / "inbox" / "library" / "files" / f"{entry['id']}.txt").read_bytes() == note
    assert "chain rule" in library.read_text(tmp_path, entry["id"])
    catalog = (tmp_path / "inbox" / "library" / "INDEX.md").read_text(encoding="utf-8")
    assert "## MATH 1300" in catalog and "week3 notes.txt" in catalog


def test_office_formats_and_pdf_are_read_with_stdlib(tmp_path: Path) -> None:
    seed_courses(tmp_path)
    d = library.add_bytes(tmp_path, "HIST 1010 syllabus.docx", docx("World History syllabus\nGrading: two essays"), NOW)["entry"]
    assert d["category"] == "syllabus" and d["course_id"] == "5151"
    assert "two essays" in library.read_text(tmp_path, d["id"])
    s = library.add_bytes(tmp_path, "lecture 4.pptx", pptx(["Related rates", "Implicit differentiation"]), NOW)["entry"]
    assert s["kind"] == "slides" and s["category"] == "slides"
    assert "Slide 2\nImplicit differentiation" in library.read_text(tmp_path, s["id"])
    p = library.add_bytes(tmp_path, "reading.pdf", pdf("Product rule worked examples for the midterm review"), NOW)["entry"]
    assert p["text_status"] == "partial"
    assert "Product rule worked examples" in library.read_text(tmp_path, p["id"])


def test_unreadable_files_are_kept_and_marked_honestly(tmp_path: Path) -> None:
    image = library.add_bytes(tmp_path, "Screenshot 2026-09-20.png", b"\x89PNG\r\n\x1a\nnot really", NOW)["entry"]
    assert image["kind"] == "image" and image["category"] == "screenshot"
    assert image["text_status"] == "none" and image["chars"] == 0
    scanned = library.add_bytes(tmp_path, "scan.pdf", b"%PDF-1.4\n%binary only\n%%EOF", NOW)["entry"]
    assert scanned["text_status"] == "none"
    assert len(library.load_index(tmp_path)) == 2


def test_duplicates_and_limits(tmp_path: Path) -> None:
    first = library.add_bytes(tmp_path, "a.txt", b"same bytes here", NOW)
    again = library.add_bytes(tmp_path, "renamed.txt", b"same bytes here", NOW)
    assert again["status"] == "duplicate" and again["entry"]["id"] == first["entry"]["id"]
    with pytest.raises(StudyError):
        library.add_bytes(tmp_path, "empty.txt", b"", NOW)


def test_student_corrections_survive_a_resort(tmp_path: Path) -> None:
    seed_courses(tmp_path)
    entry = library.add_bytes(tmp_path, "MATH 1300 hw2.md", b"Problem set on limits", NOW)["entry"]
    assert entry["course_id"] == "4242" and entry["category"] == "assignment"
    library.update_entry(tmp_path, entry["id"], {"course_id": "5151", "category": "notes"})
    library.resort(tmp_path)
    after = library.load_index(tmp_path)[0]
    assert after["course_id"] == "5151" and after["course_source"] == "student"
    assert after["category"] == "notes" and after["category_source"] == "student"
    with pytest.raises(StudyError):
        library.update_entry(tmp_path, entry["id"], {"course_id": "9999"})
    library.remove_entry(tmp_path, entry["id"])
    assert library.load_index(tmp_path) == []
    assert not any((tmp_path / "inbox" / "library" / "files").iterdir())


def test_ingest_drains_the_staging_folder(tmp_path: Path) -> None:
    incoming = library.incoming_dir(tmp_path)
    incoming.mkdir(parents=True)
    (incoming / "1700000000-1--notes.md").write_bytes(b"Derivative notes for the exam")
    (incoming / "1700000000-2--empty.txt").write_bytes(b"")
    result = library.ingest_incoming(tmp_path, NOW)
    assert [e["name"] for e in result["added"]] == ["notes.md"]
    assert result["errors"] and result["errors"][0]["name"] == "empty.txt"
    assert list(incoming.iterdir()) == []


def test_ask_uses_the_students_file_and_sends_it_to_the_relay(tmp_path: Path) -> None:
    seed_courses(tmp_path)
    library.add_bytes(
        tmp_path,
        "MATH 1300 related rates notes.txt",
        b"Related rates recipe: draw the picture, name the changing quantities, differentiate the equation with respect to time, then substitute.",
        NOW,
    )
    s = StudyService(tmp_path, now=NOW, zone=Z)
    created = s.ask_create({"content": "MATH 1300: how do I set up related rates problems?", "session_goal": "walkthrough"})
    items = created["context"]["items"]
    files = [i for i in items if i["truth_kind"] == "student_file"]
    assert files and files[0]["locator"].startswith("Your file: MATH 1300 related rates notes")
    assert files[0]["local_reference"].startswith("inbox/library/text/")
    record = json.loads((tmp_path / "study" / "asks" / f"{created['input_id']}.json").read_text(encoding="utf-8"))
    payload = relay_payload(record, select_context(s, record), record["plan"])
    assert payload is not None
    assert any("Related rates recipe" in p["text"] for p in payload["source_passages"])
    assert len(payload["source_passages"]) <= 6


def test_a_file_alone_replaces_the_general_knowledge_fallback(tmp_path: Path) -> None:
    library.add_bytes(tmp_path, "photosynthesis.md", b"Photosynthesis: light reactions make ATP and NADPH; the Calvin cycle fixes carbon.", NOW)
    s = StudyService(tmp_path, now=NOW, zone=Z)
    created = s.ask_create({"content": "Explain the Calvin cycle and photosynthesis", "session_goal": "walkthrough"})
    kinds = [i["truth_kind"] for i in created["context"]["items"]]
    assert "student_file" in kinds and "general" not in kinds


def test_unrelated_questions_pull_no_files(tmp_path: Path) -> None:
    library.add_bytes(tmp_path, "photosynthesis.md", b"Photosynthesis: light reactions make ATP and NADPH.", NOW)
    assert library.search(tmp_path, "When is the French Revolution essay due?") == []


def test_ask_says_when_ai_help_is_not_connected(tmp_path: Path) -> None:
    s = StudyService(tmp_path, now=NOW, zone=Z)
    created = s.ask_create({"content": "Walk me through the chain rule", "session_goal": "walkthrough"})
    assert created["response"]["relay"] == "not_connected"
