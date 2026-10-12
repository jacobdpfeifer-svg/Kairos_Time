import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileCommand } from "../scripts/lib/reconcile-command.mjs";

function installedCore() {
  // Shape of Contents/Resources/core: no scripts/ directory, so no uv/rsync helper.
  const core = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-core-"));
  fs.mkdirSync(path.join(core, "src"));
  const python = path.join(core, "python3");
  fs.writeFileSync(python, "");
  return { core, python };
}

test("an installed core runs reconcile with the app's Python, not a developer script", () => {
  const { core, python } = installedCore();
  const plan = reconcileCommand({ coreRoot: core, env: { KAIROS_PYTHON: python, PATH: "/usr/bin" } });
  assert.equal(plan.command, python);
  assert.deepEqual(plan.args, ["-s", "-m", "canvas_mcp.core.learn_loop", "reconcile"]);
  assert.equal(plan.options.cwd, path.join(core, "src"));
  assert.equal(plan.options.env.PYTHONPATH, path.join(core, "src"));
  assert.ok(!JSON.stringify(plan).includes("py-mirror-run"));
});

test("an installed core without a Python reports no plan instead of spawning a missing script", () => {
  const { core } = installedCore();
  assert.equal(reconcileCommand({ coreRoot: core, env: {} }), null);
});

test("a developer checkout without KAIROS_PYTHON keeps the iCloud-safe mirror helper", () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const plan = reconcileCommand({ coreRoot: repo, env: {} });
  assert.match(plan.command, /scripts\/py-mirror-run\.sh$/);
});
