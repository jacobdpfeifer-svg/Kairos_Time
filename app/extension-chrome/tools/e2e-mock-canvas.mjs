/**
 * End-to-end check of the whole freshness chain with no real Canvas account:
 *
 *   mock https://canvas.colorado.edu (self-signed, host-resolver mapped)
 *     → this extension (background poll, dashboard stage, side panel)
 *     → the real native host (system python3) → {user_root}
 *     → the real freshness tick → dashboard.json → back into the extension.
 *
 *   node app/extension-chrome/tools/e2e-mock-canvas.mjs [--out DIR]
 *
 * Needs Playwright's Chromium (browser/node_modules) and openssl. Writes
 * screenshots and report.json into the output directory.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "..");
const REPO = path.resolve(EXT, "..", "..");
const BROWSER = path.join(REPO, "browser");
const require = createRequire(path.join(BROWSER, "package.json"));
const { chromium } = require("playwright");
const { fixtureGeneration } = await import(path.join(BROWSER, "scripts/lib/canvas-reliability-fixtures.mjs"));
const { commitRawGeneration } = await import(path.join(BROWSER, "scripts/lib/canvas-store.mjs"));
const { promoteProjections } = await import(path.join(BROWSER, "scripts/lib/canvas-project.mjs"));
const { afterCanonicalSync } = await import(path.join(BROWSER, "scripts/lib/freshness-run.mjs"));

const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), "pn-e2e-"));
const PORT = 8443;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
fs.mkdirSync(OUT, { recursive: true });
const report = { out: OUT, checks: {} };
const check = (name, ok, detail) => {
  report.checks[name] = { ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) };
};

// ---------------------------------------------------------------- seed brain
// The reliability fixtures are frozen around 2026-09-21; move every timestamp
// so the fixture term sits around today and the run never date-rots.
const FIXTURE_NOW = Date.parse("2026-09-21T18:00:00.000Z");
function shiftDates(value, offset) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return new Date(Date.parse(value) + offset).toISOString();
  }
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, offset));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, offset)]));
  return value;
}
const userRoot = path.join(OUT, "user-root");
fs.rmSync(userRoot, { recursive: true, force: true });
const next = shiftDates(fixtureGeneration({ sync_id: "sync-e2e-1" }), NOW - FIXTURE_NOW);
next.manifest.finished_at = iso(NOW);
const hw2 = next.courses[0].assignments.find((a) => a.id === 102);
hw2.due_at = iso(NOW + 2 * DAY);
hw2.all_dates = [{ base: true, due_at: hw2.due_at }];
const previous = structuredClone(next);
previous.courses[0].assignments.find((a) => a.id === 102).due_at = iso(NOW + 4 * DAY);
const committed = commitRawGeneration(userRoot, next, { sync_id: "sync-e2e-1" });
check("seed_commit", committed.ok, committed.errors);
promoteProjections(userRoot, next, { now: NOW });
const seeded = await afterCanonicalSync({ userRoot, previous, generation: next, now: NOW });
check("seed_after_sync", seeded.errors.length === 0 && seeded.events >= 1 && seeded.skip_costs >= 1, seeded);

// ---------------------------------------------------------------- mock Canvas
const key = path.join(OUT, "key.pem");
const cert = path.join(OUT, "cert.pem");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2",
  "-subj", "/CN=canvas.colorado.edu", "-addext", "subjectAltName=DNS:canvas.colorado.edu",
], { stdio: "ignore" });

const courseId = String(next.courses[0].course.id);
const summary = [
  { type: "Announcement", count: 3, unread_count: 2 },
  { type: "Message", notification_category: "Due Date", count: 1, unread_count: 0 },
  { type: "Submission", count: 1, unread_count: 1 },
];
const stream = [
  {
    type: "Announcement", id: 9001, announcement_id: 501, course_id: Number(courseId),
    title: "Homework 2 update", created_at: iso(NOW - 3 * 60 * 60 * 1000),
    html_url: `https://canvas.colorado.edu/courses/${courseId}/discussion_topics/501`,
    message: "<p>Hi all!</p><p>Homework 2 is now due Thursday at 11:59 pm.</p><p>Friday's lab is cancelled.</p><p>The midterm covers chapters 1-4.</p>",
  },
  {
    type: "Message", id: 9002, notification_category: "Due Date", course_id: Number(courseId),
    title: "Assignment Due Date Changed: Homework 2, MATH 1300", created_at: iso(NOW - 2 * 60 * 60 * 1000),
    message: "Homework 2 has a new due date.",
  },
  {
    type: "Submission", id: 9003, assignment_id: 101, course_id: Number(courseId), workflow_state: "graded",
    score: 9, grade: "9", graded_at: iso(NOW - 60 * 60 * 1000), assignment: { id: 101, name: "Homework 1", points_possible: 10 },
  },
];
const planner = [
  {
    plannable_type: "assignment", plannable_id: 102, course_id: Number(courseId), context_name: "MATH 1300",
    html_url: `/courses/${courseId}/assignments/102`, plannable: { title: "Homework 2", due_at: hw2.due_at, points_possible: 10 },
  },
];
const assignment = {
  id: 102, course_id: Number(courseId), name: "Homework 2", due_at: hw2.due_at, points_possible: 10,
  html_url: `https://canvas.colorado.edu/courses/${courseId}/assignments/102`,
  description: "<p>Answer questions 1-5 from section 2.3.</p><p>Show all work for full credit.</p><script>alert(1)</script>",
  rubric: [
    { id: "r1", description: "Correct answers", long_description: "Each question is worth 1 point.", points: 5 },
    { id: "r2", description: "Work shown", points: 4 },
    { id: "r3", description: "<b>Neat</b> & on time", points: 1 },
  ],
};

let signedInCookie = false;
const requests = [];
const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  const url = new URL(req.url, "https://canvas.colorado.edu");
  const authed = /(^|;\s*)canvas_session=mock/.test(req.headers.cookie || "");
  requests.push({ method: req.method, path: url.pathname, authed });
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(`while(1);${JSON.stringify(body)}`);
  };
  if (url.pathname === "/login") {
    signedInCookie = true;
    res.setHeader("Set-Cookie", [
      "canvas_session=mock; Path=/; Secure; HttpOnly; SameSite=None",
      "log_session_id=mock; Path=/; Secure; HttpOnly; SameSite=Lax",
    ]);
    res.end("<html><body>signed in</body></html>");
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (!authed) return json(401, { status: "unauthenticated" });
    if (url.pathname === "/api/v1/users/self/activity_stream/summary") return json(200, summary);
    if (url.pathname === "/api/v1/users/self/activity_stream") return json(200, stream);
    if (url.pathname === "/api/v1/planner/items") return json(200, planner);
    if (url.pathname === `/api/v1/courses/${courseId}/assignments/102`) return json(200, assignment);
    return json(404, { errors: [{ message: "not found" }] });
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  if (url.pathname === "/") {
    res.end(`<!doctype html><html><head><title>Dashboard</title></head><body style="margin:0;background:#fff;font-family:Lato,Helvetica,sans-serif">
      <div id="content" style="padding:24px 32px;max-width:1080px"><h1 style="font-size:28px;font-weight:300;margin:0 0 16px">Dashboard</h1>
      <div id="dashboard"><div id="DashboardCard_Container" style="display:grid;grid-template-columns:repeat(3,262px);gap:24px">
      ${["MATH 1300", "WRTG 1150", "CSCI 1300"].map((c, i) => `<div style="height:250px;border:1px solid #c7cdd1;border-radius:4px"><div style="height:146px;background:${["#2d3b45", "#6b8e23", "#8b4513"][i]}"></div><div style="padding:12px;color:#2d3b45">${c}</div></div>`).join("")}
      </div></div></div></body></html>`);
    return;
  }
  res.end(`<!doctype html><html><body><div id="content"><h1>Homework 2</h1></div></body></html>`);
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

// ---------------------------------------------------------------- native host
const profile = path.join(OUT, "chrome-profile");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(path.join(profile, "NativeMessagingHosts"), { recursive: true });
// Same as install-macos.sh: run a copy outside the checkout (Chrome-launched
// processes cannot read iCloud Drive), under the system interpreter.
const hostCopy = path.join(OUT, "host.py");
fs.copyFileSync(path.join(REPO, "app/native-messaging/host.py"), hostCopy);
const wrapper = path.join(OUT, "host.sh");
const python = fs.existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3";
fs.writeFileSync(wrapper, `#!/bin/sh\nexport DEV_USER_ROOT="${userRoot}"\nexec ${python} "${hostCopy}"\n`, { mode: 0o755 });
fs.writeFileSync(
  path.join(profile, "NativeMessagingHosts", "com.kairosstudy.daemon.json"),
  JSON.stringify({ name: "com.kairosstudy.daemon", description: "e2e", path: wrapper, type: "stdio", allowed_origins: ["chrome-extension://jkjkbgcbpakeenemjgkfohbcfbghmall/"] })
);

const tick = () =>
  JSON.parse(
    execFileSync(process.execPath, [path.join(BROWSER, "scripts/freshness-tick.mjs")], {
      env: { ...process.env, DEV_USER_ROOT: userRoot },
      encoding: "utf8",
    }).trim().split("\n").pop()
  );

// ---------------------------------------------------------------- run
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP canvas.colorado.edu 127.0.0.1:${PORT}`,
    "--ignore-certificate-errors",
  ],
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  check("extension_id_stable", extId === "jkjkbgcbpakeenemjgkfohbcfbghmall", extId);

  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/panel.html`);
  const message = (m) => ext.evaluate((msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r)), m);

  const signedOut = await message({ type: "poll_now" });
  check("signed_out_is_401", signedOut?.signedIn === false && signedOut.lastStatus === 401, signedOut);
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check("signed_out_badge", badge === "!", badge);

  const login = await context.newPage();
  await login.goto("https://canvas.colorado.edu/login");
  await login.close();

  const signedIn = await message({ type: "poll_now" });
  check("background_poll_signed_in_no_canvas_tab", signedIn?.signedIn === true && signedIn.changed === true, signedIn);
  const queued = fs.existsSync(path.join(userRoot, "inbox/freshness/deltas")) ? fs.readdirSync(path.join(userRoot, "inbox/freshness/deltas")).length : 0;
  check("native_host_queued_deltas", queued >= 1, queued);

  const t = tick();
  check("tick_processed_delta", t.ok && t.deltas_processed >= 2 && t.new_events >= 3, t);

  const view = await message({ type: "get_view" });
  check("view_full_mode", view?.mode === "full" && view.status.host === "ok", { mode: view?.mode, host: view?.status?.host });
  const nextTitle = view?.dashboard?.next_step?.title;
  check("next_step_present", Boolean(nextTitle), nextTitle);
  // Either a real number or an honest "cannot calculate" — never an invented one.
  const cost = view?.dashboard?.next_step?.skip_cost;
  check(
    "skip_cost_honest",
    cost && (cost.if_zero != null || (cost.status === "cannot_calculate" && cost.share_of_final == null)),
    cost
  );
  check("digest_actions", (view?.dashboard?.digest?.items?.[0]?.actions || []).length >= 2, view?.dashboard?.digest?.items?.[0]?.actions);
  check(
    "due_change_collapsed_once",
    (view?.dashboard?.changes || []).filter((c) => c.kind === "due_changed" && c.title === "Homework 2").length === 1,
    (view?.dashboard?.changes || []).map((c) => `${c.kind}:${c.title}`)
  );

  const dash = await context.newPage();
  await dash.goto("https://canvas.colorado.edu/");
  await dash.waitForFunction(() => document.querySelector("#kairos-stage")?.shadowRoot?.querySelector(".pn-title"), null, { timeout: 15000 });
  await dash.waitForTimeout(600);
  const stageText = await dash.evaluate(() => document.querySelector("#kairos-stage").shadowRoot.textContent);
  check("stage_renders", stageText.includes(nextTitle) && /Homework 2/.test(stageText) && /What changed/.test(stageText) && /Professors said/.test(stageText));
  const fonts = await dash.evaluate(async () => {
    await document.fonts.ready;
    return ["PN Big Shoulders Display", "PN IBM Plex Sans", "PN IBM Plex Mono"].map((f) => document.fonts.check(`16px "${f}"`));
  });
  check("self_hosted_fonts_load", fonts.every(Boolean), fonts);
  await dash.locator("#kairos-stage").screenshot({ path: path.join(OUT, "dashboard.png") });
  await dash.setViewportSize({ width: 640, height: 1100 });
  await dash.waitForTimeout(300);
  await dash.locator("#kairos-stage").screenshot({ path: path.join(OUT, "dashboard-narrow.png") });
  await dash.setViewportSize({ width: 1280, height: 900 });

  // A real (trusted) click: the stage ignores synthetic clicks from page script.
  const blockButton = dash.locator("#kairos-stage button", { hasText: /^Block 90 min$/ });
  const clicked = (await blockButton.count()) > 0;
  if (clicked) await blockButton.first().click();
  check("block_button_present", clicked);
  await dash.waitForTimeout(800);
  const suggestionsFile = path.join(userRoot, "inbox/calendar-suggestions.jsonl");
  const suggestions = fs.existsSync(suggestionsFile)
    ? fs.readFileSync(suggestionsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    : [];
  check("calendar_suggestion_queued", suggestions.length === 1 && suggestions[0].title === `Work on ${nextTitle}`, suggestions);

  const assignmentUrl = `https://canvas.colorado.edu/courses/${courseId}/assignments/102`;
  const tab = await context.newPage();
  await tab.goto(assignmentUrl);
  const panel = await context.newPage();
  await panel.addInitScript((url) => {
    const original = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (q) => ((await original(q)).length ? [{ url }] : [{ url }]);
  }, assignmentUrl);
  await panel.setViewportSize({ width: 380, height: 1100 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.waitForSelector(".pn-check", { timeout: 15000 });
  await panel.waitForTimeout(400);
  const panelText = await panel.evaluate(() => document.body.textContent);
  check("panel_rubric_checklist", (await panel.locator(".pn-check").count()) === 3);
  check("panel_mentions_announcement", /Homework 2 update/.test(panelText));
  check("panel_skip_cost", /With a zero/.test(panelText) && /%/.test(panelText));
  check("panel_path_by_points", /Correct answers \(5 pts\), then Work shown \(4 pts\)/.test(panelText));
  check("canvas_html_not_rendered", await panel.evaluate(() => !document.querySelector("#panel b, #panel script")));
  await panel.screenshot({ path: path.join(OUT, "panel.png"), fullPage: true });

  const readout = await message({ type: "beta_readout" });
  const r = readout?.readout || {};
  check(
    "beta_funnel_marks",
    ["installed_at", "first_signed_in_at", "native_ok_at", "first_delta_at", "first_dashboard_view_at", "first_panel_open_at"].every((k) => r[k]),
    r
  );
  const writes = requests.filter((q) => q.method !== "GET");
  check("extension_sent_only_gets", writes.length === 0, writes);
} catch (e) {
  check("harness_completed", false, String(e?.message || e).split("\n")[0]);
} finally {
  await context.close();
  server.close();
}

report.ok = Object.values(report.checks).every((c) => c.ok);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, out: OUT, failed: Object.entries(report.checks).filter(([, c]) => !c.ok) }, null, 2));
process.exit(report.ok ? 0 : 1);
