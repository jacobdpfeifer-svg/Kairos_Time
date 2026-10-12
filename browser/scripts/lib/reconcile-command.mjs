import fs from "node:fs";
import path from "node:path";

/**
 * How the canonical sync runs `learn_loop reconcile`.
 *
 * The desktop app hands every child its Python as KAIROS_PYTHON (runtime.rs
 * apply_env), so an installed copy uses the bundled interpreter against the
 * bundled core/src. scripts/py-mirror-run.sh (uv + rsync) is a developer-only
 * fallback for terminal syncs in an iCloud checkout; it is never bundled.
 */
export function reconcileCommand({ coreRoot, env = process.env }) {
  const src = path.join(coreRoot, "src");
  const python = (env.KAIROS_PYTHON || "").trim();
  if (python && fs.existsSync(python)) {
    return {
      command: python,
      args: ["-s", "-m", "canvas_mcp.core.learn_loop", "reconcile"],
      options: { cwd: src, encoding: "utf8", env: { ...env, PYTHONPATH: src, PYTHONNOUSERSITE: "1" } },
    };
  }
  const mirror = path.join(coreRoot, "scripts", "py-mirror-run.sh");
  if (fs.existsSync(mirror)) {
    return {
      command: mirror,
      args: ["-m", "canvas_mcp.core.learn_loop", "reconcile"],
      options: { cwd: coreRoot, encoding: "utf8", env },
    };
  }
  return null;
}
