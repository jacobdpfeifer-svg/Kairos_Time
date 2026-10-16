/**
 * Regression tests for the 2026-10-14 security pass (Node side).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { escCell } from "../scripts/lib/canvas-session.mjs";
import { resolveProductUserId } from "../scripts/lib/user-root.mjs";
import { voicePaths } from "../scripts/lib/voice/config.mjs";
import { createToolHandlers } from "../scripts/lib/voice/tools.mjs";

function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

describe("escCell keeps one table row on one line for every reader (F1)", () => {
  for (const sep of ["\n", "\r", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]) {
    it(`replaces ${JSON.stringify(sep)}`, () => {
      const cell = escCell(`Midterm 1${sep}Room change`);
      assert.equal(cell, "Midterm 1 Room change");
      // Python str.splitlines() is the strictest reader of week.md.
      assert.equal(cell.split(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).length, 1);
    });
  }
  it("still escapes pipes", () => {
    assert.equal(escCell("a | b"), "a / b");
  });
});

describe("voice tool dispatch only reaches its own tools", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    it(`refuses ${name}`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-proto-"));
      const tools = createToolHandlers({ paths: voicePaths(dir), courseCodes: [] });
      const out = await tools.handle(name, {});
      assert.equal(out.ok, false);
      assert.match(out.error, /unknown tool/);
    });
  }
});

describe("PRODUCT_USER_ID cannot name a directory outside the app-support root", () => {
  for (const bad of ["..", ".", "../other", "a/b", "a\\b", "x".repeat(65)]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      withEnv("PRODUCT_USER_ID", bad, () => assert.throws(() => resolveProductUserId(), /Invalid PRODUCT_USER_ID/));
    });
  }
  it("accepts a normal id and defaults to dev", () => {
    withEnv("PRODUCT_USER_ID", "student-1", () => assert.equal(resolveProductUserId(), "student-1"));
    withEnv("PRODUCT_USER_ID", undefined, () => assert.equal(resolveProductUserId(), "dev"));
  });
});
