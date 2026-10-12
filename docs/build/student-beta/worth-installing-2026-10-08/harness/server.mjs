// Walkthrough harness: answers the webview's invoke() calls the way the native
// app does, against a synthetic user root. Real: study core (Python), school.mjs,
// Rust file readers (examples/harness), learn_loop/commitment/habit CLIs.
// Stubbed: Canvas SSO/session and the network sync (copies fixture courses).
//   ROOT=<synthetic user root> SSO=ok|fail SYNC=ok|fail|empty node server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO = process.env.REPO;
const ROOT = process.env.ROOT;
const PORT = Number(process.env.PORT || 1431);
const RUST = process.env.HARNESS_BIN || path.join(process.env.HOME, ".cache/kairos-build-wi/app/src-tauri/target/debug/examples/harness");
const PY = path.join(REPO, ".venv/bin/python");
const NODE = process.execPath;
const FIX = path.join(REPO, "tests/fixtures/study/ui-round1");
let mode = { sso: process.env.SSO || "ok", sync: process.env.SYNC || "ok", ssoDone: false };
const log = [];
const clients = new Set();

function emit(event, payload) {
  for (const res of clients) res.write(`data: ${JSON.stringify({ event, payload })}\n\n`);
}
const env = () => ({ ...process.env, DEV_USER_ROOT: ROOT, PRODUCT_USER_ID: "harness", AUTH_DIR: path.join(ROOT, "auth/browser"), KAIROS_TEMPLATES_DIR: path.join(REPO, "templates/study-packets"), PYTHONDONTWRITEBYTECODE: "1" });

function rust(cmd, args) {
  const r = spawnSync(RUST, [cmd, ROOT, JSON.stringify(args || {})], { encoding: "utf8", env: env() });
  const o = JSON.parse(r.stdout.trim() || '{"ok":false,"error":"no output"}');
  if (!o.ok) throw new Error(o.error);
  return o.value;
}
function pyModule(mod, args) {
  const r = spawnSync(PY, ["-s", "-m", mod, ...args], { cwd: path.join(REPO, "src"), encoding: "utf8", env: { ...env(), PYTHONPATH: path.join(REPO, "src") } });
  if (r.status !== 0) throw new Error(r.stderr.trim() || `${mod} exited ${r.status}`);
  return JSON.parse(r.stdout.trim());
}
function study(request) {
  const r = spawnSync(PY, ["-s", "-m", "study", "--user-root", ROOT, "--json", "run"], { cwd: path.join(REPO, "src/canvas_mcp/core"), input: JSON.stringify(request), encoding: "utf8", env: { ...env(), PYTHONPATH: "" } });
  const line = r.stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!line) throw new Error(`study core produced no reply (exit ${r.status})`);
  return JSON.parse(line);
}
function school(args) {
  const r = spawnSync(NODE, [path.join(REPO, "browser/scripts/school.mjs"), ...args], { cwd: path.join(REPO, "browser"), encoding: "utf8", env: env() });
  const line = r.stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
  const o = JSON.parse(line);
  if (o.ok === false) throw new Error(o.error);
  return o;
}
async function syncSources() {
  const dir = path.join(ROOT, "inbox/study-sources");
  fs.mkdirSync(dir, { recursive: true });
  const prog = (p) => {
    fs.writeFileSync(path.join(dir, "progress.json"), JSON.stringify(p));
    emit("study-sync-progress", p);
  };
  if (mode.sync === "fail") {
    prog({ phase: "failed", courses: [], error: "Not logged in. Run: cd browser && npm run open-canvas — complete SSO/MFA, then retry." });
    await new Promise((r) => setTimeout(r, 400));
    return { ok: false, error: "study source sync exited with exit status: 1" };
  }
  const files = mode.sync === "empty" ? [] : fs.readdirSync(FIX).filter((f) => /^\d+\.json$/.test(f));
  const courses = [];
  for (const f of files) {
    await new Promise((r) => setTimeout(r, 350));
    fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const items = c.items || [];
    courses.push({ id: c.course.id, label: c.course.label, color: c.course.color, assignments: items.filter((i) => i.kind === "assignment").length, quizzes: items.filter((i) => i.kind === "quiz").length, exam_count: (c.exams || []).length, ok: true });
    prog({ phase: "courses", courses: [...courses], error: null });
  }
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ ok: true, session: "ok", partial: false, finished_at: new Date().toISOString(), courses: courses.map((c) => c.id), errors: [] }));
  prog({ phase: "done", courses, error: null });
  return { ok: true, error: null };
}

const handlers = {
  set_dock_mode: () => null, show_dock: () => null, hide_dock: () => null,
  runtime_info: () => ({ mode: "dev", core_dir: REPO, python: PY, node: NODE, profile_id: "harness", user_root: ROOT, diagnostics: [] }),
  list_profiles: () => ({ current: "harness", profiles: ["harness"], root: path.dirname(ROOT) }),
  set_profile: (a) => ({ ok: true, profile_id: a.profileId, restart_required: true }),
  search_schools: (a) => school(["search", a.term]).schools,
  choose_school: (a) => {
    const args = ["choose", "--host", a.host, "--name", a.name];
    if (a.accountId != null) args.push("--account-id", String(a.accountId));
    if (a.manual) args.push("--source", "manual");
    const p = school(args).profile;
    fs.writeFileSync(path.join(ROOT, "school_slug"), p.slug);
    return p;
  },
  read_school_profile: () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "school/profile.json"), "utf8")); } catch { return null; } },
  save_onboarding: (a) => { fs.writeFileSync(path.join(ROOT, "school_slug"), a.schoolSlug); return null; },
  check_canvas_session: () => mode.ssoDone,
  open_canvas_sso: async () => {
    await new Promise((r) => setTimeout(r, 600));
    if (mode.sso === "fail") throw new Error("open-canvas exited with exit status: 1");
    mode.ssoDone = true;
    return null;
  },
  sync_study_sources: async () => { const r = await syncSources(); if (mode.sync === "fail") mode.sync = "ok"; return r; },
  read_due_reviews: () => pyModule("canvas_mcp.core.learn_loop", ["--json", "due"]),
  sync_canvas: () => ({ ok: false, error: "canvas sync exited with exit status: 1" }),
  bootstrap_canvas_sync: () => { log.push("bootstrap_canvas_sync fired"); return null; },
  study: (a) => study(a.request),
  read_brief_streak: () => pyModule("canvas_mcp.core.habit", ["--json", "show"]),
  read_learn_progress: () => pyModule("canvas_mcp.core.learn_loop", ["--json", "progress"]),
  read_commitment: () => pyModule("canvas_mcp.core.commitment", ["--json", "status"]),
  read_check_intention: () => pyModule("canvas_mcp.core.learning_profile", ["--json", "show"]).if_then || "",
  read_evaluation_compare: () => ({ ok: false, reason: "compare unavailable" }),
  read_top3: () => [],
  open_external_url: (a) => { log.push(`open_external_url ${a.url}`); return null; },
};
for (const c of ["read_semester", "read_sync_progress", "read_sync_health", "read_freshness", "read_work_surface", "read_course_colors", "read_course_map", "read_grade_truth", "add_calendar_event", "dismiss_calendar_suggestion"]) {
  handlers[c] = (a) => rust(c, a);
}
handlers.read_calendar_surface = () => {
  const v = rust("read_calendar_surface", {});
  try { v.commitment = pyModule("canvas_mcp.core.commitment", ["--json", "status"]); } catch { v.commitment = { commitment: null, check_in: null, line: "" }; }
  return v;
};

http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  if (req.url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.url === "/log") return res.end(JSON.stringify(log));
  if (req.url?.startsWith("/mode")) {
    const q = new URL(req.url, "http://x").searchParams;
    for (const [k, v] of q) mode[k] = v === "true" ? true : v === "false" ? false : v;
    return res.end(JSON.stringify(mode));
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const { cmd, args } = JSON.parse(body);
  log.push(cmd);
  try {
    const h = handlers[cmd];
    if (!h) throw new Error(`harness: unimplemented command ${cmd}`);
    const value = await h(args || {});
    res.end(JSON.stringify({ ok: true, value: value === undefined ? null : value }));
  } catch (e) {
    log.push(`ERR ${cmd}: ${e.message}`);
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`harness on ${PORT} root=${ROOT}`));
