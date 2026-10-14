// Unit checks for the Chrome extension's pure libraries (app/extension-chrome/lib).
import assert from "node:assert/strict";
import test from "node:test";
import { canvasGet, isAllowedBase, isAllowedPath, isBuiltInHost, originPattern } from "../../app/extension-chrome/lib/canvas-read.js";
import { formatDue, kairosItemLink, workFromUrl } from "../../app/extension-chrome/lib/format.js";

test("any school's https Canvas origin is a valid base, nothing else is", () => {
  assert.equal(isAllowedBase("https://canvas.colorado.edu/"), true);
  assert.equal(isAllowedBase("https://canvas.myschool.edu/"), true);
  assert.equal(isAllowedBase("http://canvas.myschool.edu/"), false);
  assert.equal(isAllowedBase("https://127.0.0.1/"), false);
  assert.equal(isAllowedBase("https://localhost/"), false);
  assert.equal(isAllowedBase("https://canvas.myschool.edu:8443/"), false);
  assert.equal(isAllowedBase("https://canvas.myschool.edu/courses"), false);
  assert.equal(isAllowedBase("https://user@canvas.myschool.edu/"), false);
  assert.equal(isBuiltInHost("https://school.instructure.com/"), true);
  assert.equal(isBuiltInHost("https://canvas.myschool.edu/"), false);
  assert.equal(originPattern("https://canvas.myschool.edu/"), "https://canvas.myschool.edu/*");
});

test("only the read endpoints are allowed, including quiz and discussion lookups", () => {
  assert.equal(isAllowedPath("/api/v1/courses/1/quizzes/2"), true);
  assert.equal(isAllowedPath("/api/v1/courses/1/discussion_topics/2"), true);
  assert.equal(isAllowedPath("/api/v1/courses/1/discussion_topics/2/entries"), false);
  assert.equal(isAllowedPath("/api/v1/courses/1/assignments/2/submissions"), false);
  assert.equal(isAllowedPath("/api/v1/courses/1/../users"), false);
});

test("canvasGet only ever sends GET", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    return { status: 200, text: async () => "{}" };
  };
  await canvasGet("https://canvas.myschool.edu/", "/api/v1/courses/1/quizzes/2", { fetchImpl });
  assert.deepEqual(calls, ["GET"]);
  await assert.rejects(() => canvasGet("https://canvas.myschool.edu/", "/api/v1/courses/1/quizzes/2/submissions", { fetchImpl }));
});

test("Canvas pages map to the graded work they are about", () => {
  assert.deepEqual(workFromUrl("https://c.example.edu/courses/12/assignments/34"), { courseId: "12", kind: "assignment", id: "34" });
  assert.deepEqual(workFromUrl("https://c.example.edu/courses/12/quizzes/9/take"), { courseId: "12", kind: "quiz", id: "9" });
  assert.deepEqual(workFromUrl("https://c.example.edu/courses/12/discussion_topics/5"), { courseId: "12", kind: "discussion", id: "5" });
  assert.equal(workFromUrl("https://c.example.edu/courses/12/pages/intro"), null);
});

test("links into the app and dates follow the app's own formats", () => {
  assert.equal(kairosItemLink("12", "34"), "kairos://item/12/item-a34");
  assert.equal(kairosItemLink("12", "../x"), "kairos://today");
  const due = formatDue("2026-10-09T17:59:00Z");
  assert.match(due, / at /);
  assert.doesNotMatch(due, /\(|\//, "no IANA zone name (MASTER §02)");
});
