/**
 * Kairos for Canvas — background worker.
 *
 * Every 5 minutes: one cheap activity-stream summary GET with the student's
 * own Canvas session (cost ~0.04 of Canvas's 700-point budget). When the
 * summary moves, fetch the changed slice (recent stream + planner window),
 * classify it here for the extension-only view, and hand it to the local
 * brain through the native host. A 401 means "sign in to Canvas".
 *
 * Reads Canvas only (lib/canvas-read.js). Writes go to the student's own
 * machine: chrome.storage and, via the native host, {user_root}.
 */
import { SUMMARY_PATH, canvasGet, isAllowedBase, isBuiltInHost, originPattern, trimPlannerItem, trimStreamItem } from "./lib/canvas-read.js";
import { callHost } from "./lib/native.js";
import { classifyDelta, summarySignature } from "./shared/classify.js";
import { buildDigest, recentChanges } from "./shared/view.js";

const POLL_MINUTES = 5;
const LOCAL_EVENT_CAP = 60;
const MAX_DELTA_BYTES = 900_000;
const PING_EVERY_MS = 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const get = (keys) => chrome.storage.local.get(keys);
const set = (values) => chrome.storage.local.set(values);

/** Chrome lets the extension read this Canvas: built into the manifest, or granted by the student. */
async function canRead(base) {
  if (!isAllowedBase(base)) return false;
  try {
    return await chrome.permissions.contains({ origins: [originPattern(base)] });
  } catch {
    return false;
  }
}

/**
 * The student's Canvas origin. There is no default school: it is learned the first
 * time the student opens their own Canvas (the content script says "hello"), or
 * when they turn Kairos on for their school's Canvas from the side panel.
 */
async function canvasBase() {
  const { base } = await get("base");
  return (await canRead(base)) ? base : null;
}

/** Run the dashboard stage on a granted school Canvas that isn't in the manifest. */
async function registerSchoolScript(base) {
  if (isBuiltInHost(base) || !chrome.scripting?.registerContentScripts) return;
  const id = `kairos-${new URL(base).hostname}`;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    { id, matches: [originPattern(base)], js: ["ui/dashboard.js"], runAt: "document_idle", persistAcrossSessions: true },
  ]);
}

chrome.permissions?.onRemoved?.addListener(async ({ origins = [] }) => {
  const { base } = await get("base");
  for (const pattern of origins) {
    try {
      const host = new URL(pattern.replace("/*", "/")).hostname;
      await chrome.scripting?.unregisterContentScripts?.({ ids: [`kairos-${host}`] }).catch(() => {});
      if (base && new URL(base).hostname === host) await set({ base: null });
    } catch {
      /* not an origin we registered */
    }
  }
});

function ensureSetup() {
  chrome.alarms.create("poll", { periodInMinutes: POLL_MINUTES, delayInMinutes: 0.1 });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch?.(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSetup();
  bumpFunnel({ mark: "installed_at" });
});
chrome.runtime.onStartup.addListener(ensureSetup);
chrome.alarms.get("poll").then((alarm) => {
  if (!alarm) ensureSetup();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll") poll("alarm");
});

// ------------------------------------------------------------ beta funnel (Phase C)

/** Timestamps and counts only — no Canvas content ever lands here. */
async function bumpFunnel({ mark, count }) {
  const { funnel = {} } = await get("funnel");
  if (mark && !funnel[mark]) funnel[mark] = new Date().toISOString();
  if (count) funnel[count] = (funnel[count] || 0) + 1;
  await set({ funnel });
  return funnel;
}

/** "ok" whenever the host answered — an app-level error (e.g. no dashboard yet) still means it is installed. */
async function noteHost(reply) {
  const hostState = reply?.error === "host_missing" ? "missing" : ["host_error", "empty_reply"].includes(reply?.error) ? "error" : "ok";
  await set({ hostState });
  if (hostState === "ok") await bumpFunnel({ mark: "native_ok_at" });
  if (hostState === "missing") await bumpFunnel({ count: "native_missing" });
  return hostState;
}

async function maybePing() {
  const { lastPingAt = 0 } = await get("lastPingAt");
  if (Date.now() - lastPingAt < PING_EVERY_MS) return;
  const { funnel = {} } = await get("funnel");
  const reply = await callHost({ type: "ping", funnel });
  await noteHost(reply);
  if (reply.ok) await set({ lastPingAt: Date.now() });
}

// ------------------------------------------------------------ polling

const NEEDS_YOU = new Set(["due_changed", "assignment_added", "comment"]);

/** Badge: "!" when signed out, else how many things need the student since they last opened the panel. */
async function setBadge(signedIn) {
  const { localEvents = [], panelSeenAt = 0 } = await get(["localEvents", "panelSeenAt"]);
  const count = localEvents.filter((e) => NEEDS_YOU.has(e.kind) && Date.parse(e.detected_at || 0) > panelSeenAt).length;
  const text = signedIn === false ? "!" : count ? String(Math.min(count, 9)) : "";
  chrome.action.setBadgeText({ text });
  // Ink on paper (MASTER §03), not an alarm red.
  chrome.action.setBadgeBackgroundColor({ color: "#1d1d1f" });
  chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  chrome.action.setTitle({
    title:
      signedIn === false
        ? "Kairos: sign in to Canvas to keep this fresh"
        : count
          ? `Kairos: ${count === 1 ? "1 thing needs" : `${count} things need`} you`
          : "Kairos: open the side panel",
  });
}

async function fetchDelta(base, summary, now) {
  const start = encodeURIComponent(new Date(now - 7 * DAY).toISOString());
  const end = encodeURIComponent(new Date(now + 21 * DAY).toISOString());
  const [stream, planner] = await Promise.all([
    canvasGet(base, "/api/v1/users/self/activity_stream?per_page=30&only_active_courses=true"),
    canvasGet(base, `/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`),
  ]);
  const delta = {
    v: 1,
    ts: new Date(now).toISOString(),
    summary,
    stream: (Array.isArray(stream.json) ? stream.json : []).slice(0, 100).map(trimStreamItem),
    planner: (Array.isArray(planner.json) ? planner.json : []).slice(0, 200).map(trimPlannerItem),
  };
  if (JSON.stringify(delta).length > MAX_DELTA_BYTES) {
    for (const item of delta.stream) if (item.message) item.message = item.message.slice(0, 800);
  }
  return delta;
}

async function classifyLocally(delta) {
  const { classifier = {}, localEvents = [], courseNames = {} } = await get(["classifier", "localEvents", "courseNames"]);
  const result = classifyDelta(delta, classifier, { now: Date.parse(delta.ts) });
  const keys = new Set(localEvents.map((e) => e.key));
  const merged = [...localEvents, ...result.events.filter((e) => !keys.has(e.key))].slice(-LOCAL_EVENT_CAP);
  for (const p of delta.planner) if (p.course_id && p.context_name) courseNames[p.course_id] = p.context_name;
  await set({ classifier: result.state, localEvents: merged, courseNames });
}

let inFlight = null;

async function poll(trigger) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const base = await canvasBase();
    const now = Date.now();
    const { last = {} } = await get("last");
    if (!base) {
      const status = { lastPollAt: null, lastStatus: 0, trigger, needsSchool: true };
      await set({ last: { ...last, ...status } });
      return status;
    }
    const res = await canvasGet(base, SUMMARY_PATH);
    const status = { lastPollAt: new Date(now).toISOString(), lastStatus: res.status, trigger, needsSchool: false };
    if (res.status === 401 || (res.ok && !Array.isArray(res.json))) {
      await bumpFunnel({ count: "signed_out_polls" });
      if (last.signedIn !== false) await callHost({ type: "canvas_signed_out", ts: status.lastPollAt });
      await set({ last: { ...last, ...status, signedIn: false }, viewStamp: now });
      await setBadge(false);
      return { ...status, signedIn: false };
    }
    if (!res.ok) {
      await set({ last: { ...last, ...status } });
      return status;
    }
    await bumpFunnel({ mark: "first_signed_in_at", count: "polls" });
    const sig = summarySignature(res.json);
    const changed = sig !== last.sig;
    // The signature only advances once the change reached the app, or there is
    // no app to reach. A full backlog or a host error retries on the next poll
    // instead of silently dropping that change.
    let delivered = true;
    if (changed) {
      const delta = await fetchDelta(base, res.json, now);
      await classifyLocally(delta);
      const reply = await callHost({ type: "canvas_delta", delta });
      const hostState = await noteHost(reply);
      if (reply.ok) await bumpFunnel({ mark: "first_delta_at" });
      delivered = Boolean(reply.ok) || hostState === "missing";
    }
    await set({ last: { ...last, ...status, signedIn: true, sig: delivered ? sig : last.sig, summary: res.json }, viewStamp: now });
    await setBadge(true);
    await maybePing();
    return { ...status, signedIn: true, changed };
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ------------------------------------------------------------ views

async function buildView() {
  const now = Date.now();
  const { localEvents = [], courseNames = {}, last = {} } = await get(["localEvents", "courseNames", "last"]);
  const host = await callHost({ type: "get_dashboard" });
  const hostState = await noteHost(host);
  const status = { signedIn: last.signedIn ?? null, lastPollAt: last.lastPollAt || null, host: hostState, needsSchool: Boolean(last.needsSchool) };
  if (hostState === "ok" && host.ok) {
    const d = host.dashboard;
    // The brain processes deltas on its own tick; show anything newer right away.
    const known = new Set((d.changes || []).map((c) => c.key));
    const early = recentChanges(localEvents.filter((e) => !known.has(e.key)), { now, courseNames });
    const changes = [...early, ...(d.changes || [])]
      .sort((a, b) => Date.parse(b.detected_at || 0) - Date.parse(a.detected_at || 0))
      .slice(0, 12);
    return { mode: "full", status, dashboard: { ...d, changes } };
  }
  return {
    // "pending": the app is installed but its first sync has not produced a dashboard yet.
    mode: hostState === "ok" ? "pending" : "local",
    status,
    dashboard: {
      next_step: null,
      changes: recentChanges(localEvents, { now, courseNames }),
      digest: buildDigest(localEvents, { now, courseNames }),
      agent_can_do: [],
    },
  };
}

function pickAssignment(a) {
  const types = Array.isArray(a.submission_types) ? a.submission_types.map((t) => String(t)).slice(0, 8) : [];
  const courseCode = typeof a.course_code === "string" && !/^\d+$/.test(a.course_code) ? a.course_code.slice(0, 40) : "";
  return {
    id: a.id,
    course_id: a.course_id,
    name: a.name,
    due_at: a.due_at,
    points_possible: a.points_possible,
    html_url: a.html_url,
    description: typeof a.description === "string" ? a.description.slice(0, 20000) : "",
    submission_types: types,
    is_quiz_assignment: Boolean(a.is_quiz_assignment) || types.includes("online_quiz"),
    external_tool: types.includes("external_tool") || Boolean(a.external_tool_tag_attributes),
    proctored: Boolean(a.proctored || a.require_lockdown_browser),
    course_code: courseCode,
    rubric: (Array.isArray(a.rubric) ? a.rubric : []).slice(0, 40).map((c) => ({
      id: c.id,
      description: c.description,
      long_description: c.long_description,
      points: c.points,
    })),
  };
}

/** A quiz or graded discussion page → the assignment behind it (read-only GETs). */
async function resolveAssignmentId(base, courseId, kind, id) {
  if (kind === "assignment") return String(id);
  const path = kind === "quiz" ? `/api/v1/courses/${courseId}/quizzes/${id}` : `/api/v1/courses/${courseId}/discussion_topics/${id}`;
  const res = await canvasGet(base, path);
  const assignmentId = res.ok ? res.json?.assignment_id : null;
  return assignmentId != null && /^\d+$/.test(String(assignmentId)) ? String(assignmentId) : null;
}

async function assignmentContext({ courseId, assignmentId, kind = "assignment", id }) {
  const workId = id ?? assignmentId;
  if (!/^\d+$/.test(String(courseId)) || !/^\d+$/.test(String(workId))) return { ok: false, error: "invalid_ids" };
  if (!["assignment", "quiz", "discussion"].includes(kind)) return { ok: false, error: "invalid_ids" };
  const base = await canvasBase();
  if (!base) return { ok: false, error: "no_school" };
  assignmentId = await resolveAssignmentId(base, courseId, kind, workId);
  if (!assignmentId) return { ok: false, error: kind === "assignment" ? "not_found" : "ungraded" };
  const res = await canvasGet(base, `/api/v1/courses/${courseId}/assignments/${assignmentId}`);
  if (!res.ok || !res.json) return { ok: false, status: res.status, error: res.status === 401 ? "signed_out" : "not_found" };
  const assignment = pickAssignment(res.json);
  const host = await callHost({
    type: "get_assignment_context",
    course_id: String(courseId),
    assignment_id: String(assignmentId),
    title: assignment.name,
  });
  const hostState = await noteHost(host);
  const { localEvents = [] } = await get("localEvents");
  const title = String(assignment.name || "").toLowerCase();
  const localMentions = localEvents.filter(
    (e) => e.kind === "announcement" && String(e.course_id) === String(courseId) && title && `${e.title} ${e.detail?.preview || ""}`.toLowerCase().includes(title)
  );
  return {
    ok: true,
    assignment,
    hostState,
    skip_cost: host.ok ? host.skip_cost : null,
    mentions: host.ok ? host.mentions : localMentions.map((e) => ({ key: e.key, title: e.title, at: e.at, url: e.url, actions: e.actions })),
    changes: host.ok ? host.changes : [],
  };
}

function validSuggestion(s) {
  return (
    s &&
    typeof s.key === "string" &&
    typeof s.title === "string" &&
    typeof s.start === "string" &&
    typeof s.end === "string" &&
    s.title.length <= 200 &&
    s.key.length <= 300
  );
}

async function handleMessage(msg, sender) {
  switch (msg?.type) {
    case "hello": {
      if (!sender.tab || (sender.frameId ?? 0) !== 0) return { ok: false };
      const origin = sender.url ? new URL(sender.url).origin + "/" : null;
      if (origin && (await canRead(origin))) await set({ base: origin });
      return { ok: true };
    }
    case "get_school": {
      // The school the Mac app found at sign-up, so the panel can offer to turn Kairos on there.
      const reply = await callHost({ type: "get_school" });
      await noteHost(reply);
      const base = reply?.ok && isAllowedBase(reply.canvas_base_url) ? reply.canvas_base_url : null;
      const { base: current } = await get("base");
      return { ok: true, base, name: reply?.ok ? String(reply.name || "").slice(0, 120) : "", enabled: Boolean(base && (await canRead(base))), current: current || null };
    }
    case "enable_school": {
      // Called by the panel right after the student granted this origin in Chrome's prompt.
      const base = String(msg.base || "");
      if (!(await canRead(base))) return { ok: false, error: "not_granted" };
      await registerSchoolScript(base);
      await set({ base });
      poll("enabled");
      return { ok: true };
    }
    case "panel_seen":
      await set({ panelSeenAt: Date.now() });
      await setBadge((await get("last")).last?.signedIn ?? null);
      return { ok: true };
    case "get_view":
      return buildView();
    case "poll_now":
      return poll("manual");
    case "queue_ask": {
      let selection = "";
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id) {
          const picked = await chrome.tabs.sendMessage(tab.id, { type: "get_selection" });
          if (typeof picked?.text === "string") selection = picked.text.trim();
        }
      } catch {
        selection = "";
      }
      const content = (selection || String(msg.content || "")).trim().slice(0, 8000);
      if (!content) return { ok: false, error: "empty_ask" };
      const canvas = msg.canvas && typeof msg.canvas === "object" ? msg.canvas : {};
      const reply = await callHost({
        type: "queue_ask",
        content_kind: selection ? "selection" : "source_ref",
        content,
        course_hint: String(msg.course_hint || "").slice(0, 200),
        assignment_hint: String(msg.assignment_hint || canvas.title || "").slice(0, 300),
        canvas: {
          kind: String(canvas.kind || canvas.type || "assignment").slice(0, 64),
          submission_types: Array.isArray(canvas.submission_types) ? canvas.submission_types.map(String).slice(0, 8) : [],
          title: String(canvas.title || msg.assignment_hint || "").slice(0, 300),
          due_at: typeof canvas.due_at === "string" ? canvas.due_at.slice(0, 64) : "",
          points: Number(canvas.points || canvas.points_possible) || 0,
          lti: Boolean(canvas.lti),
          proctored: Boolean(canvas.proctored),
        },
      });
      await noteHost(reply);
      return reply || { ok: false, error: "host_missing" };
    }
    case "queue_suggestion": {
      if (!validSuggestion(msg.suggestion)) return { ok: false, error: "invalid_suggestion" };
      const reply = await callHost({ type: "queue_calendar_suggestion", suggestion: msg.suggestion });
      await noteHost(reply);
      if (reply.ok && reply.queued) await bumpFunnel({ count: "suggestions_queued" });
      return reply;
    }
    case "assignment_context":
      return assignmentContext(msg);
    case "funnel":
      if (msg.event === "dashboard_view") await bumpFunnel({ mark: "first_dashboard_view_at", count: "dashboard_views" });
      if (msg.event === "panel_open") await bumpFunnel({ mark: "first_panel_open_at", count: "panel_opens" });
      return { ok: true };
    case "beta_readout": {
      const { funnel = {}, hostState = null } = await get(["funnel", "hostState"]);
      return { ok: true, readout: { extension_version: chrome.runtime.getManifest().version, host: hostState, ...funnel } };
    }
    default:
      return { ok: false, error: "unknown_type" };
  }
}

/**
 * What each surface may ask for. Content scripts run inside Canvas pages
 * (sender.tab is set); everything else — reading the student's selection,
 * queueing an Ask, granting a school, the beta readout — is only for the
 * extension's own pages (side panel).
 */
const CONTENT_SCRIPT_MESSAGES = new Set(["hello", "get_view", "poll_now", "queue_suggestion", "funnel"]);
const EXTENSION_PAGE_ORIGIN = new URL(chrome.runtime.getURL("/")).origin;

function senderMayAsk(type, sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const fromExtensionPage = !sender.tab && typeof sender.url === "string" && new URL(sender.url).origin === EXTENSION_PAGE_ORIGIN;
  if (fromExtensionPage) return true;
  return Boolean(sender.tab) && CONTENT_SCRIPT_MESSAGES.has(type);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return false;
  try {
    if (!senderMayAsk(msg.type, sender)) return false;
  } catch {
    return false;
  }
  handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
