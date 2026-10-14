/**
 * Side panel. On a Canvas assignment page: the rubric as a checklist, what the
 * professor said about it, what changed, the cost of skipping, and the
 * fastest honest path. Elsewhere: the next step.
 *
 * The panel never produces the graded work and never submits anything: the
 * "path" is an order of attack built from the rubric, not an answer.
 * Canvas-authored text is inserted with textContent only.
 */
import { blockBefore, costLine, formatDue, kairosItemLink, relTime, workFromUrl } from "./lib/format.js";
import { originPattern } from "./lib/canvas-read.js";
import { checklistItems, honestPath } from "./lib/assignment-plan.js";

const main = document.getElementById("panel");
const statusEl = document.getElementById("pn-status");

const send = (message) =>
  new Promise((resolve) => chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? null : reply)));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function link(text, url) {
  const href = safeHref(url);
  return href ? el("a", { href, target: "_blank", rel: "noopener", text }) : el("span", { text });
}

function section(label, ...children) {
  return el("section", {}, el("p", { class: "pn-label", text: label }), ...children);
}

async function checklist(assignment) {
  const key = `check:${assignment.course_id}:${assignment.id}`;
  const stored = (await chrome.storage.local.get(key))[key] || {};
  const items = checklistItems(assignment);
  if (!items.length) return el("p", { class: "pn-note", text: "No rubric or instructions to check against yet." });
  const wrap = el("div");
  for (const item of items) {
    const box = el("input", { type: "checkbox", "aria-label": item.text });
    box.checked = Boolean(stored[item.id]);
    box.addEventListener("change", async () => {
      stored[item.id] = box.checked;
      await chrome.storage.local.set({ [key]: stored });
    });
    wrap.append(
      el(
        "label",
        { class: "pn-check" },
        box,
        el("span", {}, el("span", { class: "pn-check-text", text: item.text }), item.long ? el("span", { class: "pn-check-long", text: item.long }) : null),
        item.points != null ? el("span", { class: "pn-pts", text: `${item.points} pts` }) : el("span")
      )
    );
  }
  const source = assignment.rubric?.length ? "From the rubric." : "No rubric attached, so these lines come from the instructions.";
  return el("div", {}, wrap, el("p", { class: "pn-note", text: `${source} Checks stay in this browser.` }));
}

async function signInLink() {
  const { base } = await chrome.storage.local.get("base");
  return base ? el("p", {}, link("Sign in to Canvas", base)) : null;
}

async function assignmentView(work) {
  const ctx = await send({ type: "assignment_context", courseId: work.courseId, kind: work.kind, id: work.id });
  if (!ctx?.ok) {
    const title =
      ctx?.error === "signed_out"
        ? "Sign in to Canvas"
        : ctx?.error === "ungraded"
          ? "This one isn't graded"
          : `Couldn't load this ${work.kind}`;
    return [el("p", { class: "pn-label", text: work.kind === "assignment" ? "Assignment" : work.kind === "quiz" ? "Quiz" : "Discussion" }), el("h1", { class: "pn-title", text: title }), ctx?.error === "signed_out" ? await signInLink() : null];
  }
  const a = ctx.assignment;
  const sub = [a.due_at ? `due ${formatDue(a.due_at)}` : "no due date", a.points_possible ? `${a.points_possible} pts` : null].filter(Boolean).join(", ");
  const out = [el("p", { class: "pn-label", text: a.is_quiz_assignment ? "Quiz" : "Assignment" }), el("h1", { class: "pn-title", text: a.name }), el("p", { class: "pn-sub", text: sub })];
  if (ctx.hostState === "ok") out.push(el("p", {}, el("a", { class: "pn-quiet", href: kairosItemLink(a.course_id, a.id), text: "Open in Kairos" })));
  for (const c of ctx.changes || []) {
    const text =
      c.kind === "due_changed" && c.detail?.to
        ? `Due date moved to ${formatDue(c.detail.to)} (${relTime(c.detected_at)})`
        : c.kind === "instructions_edited"
          ? `Instructions changed ${relTime(c.detected_at)}`
          : c.kind === "points_changed"
            ? `Points changed to ${c.detail?.to}`
            : null;
    if (text) out.push(el("p", { class: "pn-signal", text }));
  }

  out.push(section("Checklist", await checklist(a)));

  const mentions = ctx.mentions || [];
  out.push(
    section(
      "What your professor said",
      mentions.length
        ? mentions.map((m) =>
            el(
              "div",
              { class: "pn-mention" },
              link(m.title, m.url),
              el("span", { class: "pn-sub", text: `, ${relTime(m.at)}` }),
              m.actions?.length ? el("ul", {}, m.actions.map((x) => el("li", { text: x.text }))) : null
            )
          )
        : el("p", { class: "pn-note", text: "No announcements mention this assignment in the last two weeks." })
    )
  );

  const cost = costLine(ctx.skip_cost);
  out.push(
    section(
      "Cost of skipping",
      cost
        ? el(
            "div",
            {},
            el(
              "div",
              { class: "pn-cost" },
              el("span", { class: "pn-meta-text", text: "Now" }),
              el("span", { class: "pn-meta-text", text: "With a zero" }),
              el("span", { class: "pn-meta-text", text: "Full marks" }),
              el("strong", { text: ctx.skip_cost.current != null ? `${ctx.skip_cost.current.toFixed(1)}%` : "None yet" }),
              el("strong", { text: `${ctx.skip_cost.if_zero.toFixed(1)}%` }),
              el("strong", { text: cost.full })
            ),
            el("p", {
              class: "pn-note",
              text: `${cost.share ? `Worth ${cost.share} of your final grade. ` : ""}From your graded work in Canvas${cost.estimate ? "; an estimate (check the course's weights)" : ""}. Your call.`,
            })
          )
        : el("p", {
            class: "pn-note",
            text: ctx.hostState === "ok" ? "Not enough graded work to say yet." : "Connect the Kairos app on this Mac to see this.",
          })
    )
  );

  const pathSection = section("Fastest honest path", el("ol", { class: "pn-steps" }, honestPath(a).map((s) => el("li", { text: s }))));
  const slot = blockBefore(a.due_at);
  const ask = el("button", { class: "pn-secondary", type: "button", text: "Ask about this" });
  ask.addEventListener("click", async () => {
    ask.disabled = true;
    const types = Array.isArray(a.submission_types) ? a.submission_types : [];
    const kind = a.is_quiz_assignment ? "quiz" : a.external_tool ? "external_tool" : "assignment";
    const reply = await send({
      type: "queue_ask",
      content: a.description || a.name || "",
      course_hint: a.course_code || "",
      assignment_hint: a.name || "",
      canvas: {
        kind,
        title: a.name || "",
        due_at: a.due_at || "",
        points: a.points_possible || 0,
        submission_types: types,
        lti: Boolean(a.external_tool),
        proctored: Boolean(a.proctored),
      },
    });
    if (reply?.ok) ask.replaceChildren("Saved. ", el("a", { href: "kairos://ask", text: "Open Kairos to answer it" }));
    else if (!reply || reply.error === "host_missing") ask.textContent = "Open the Kairos app on this Mac, then try again";
    else ask.textContent = "Couldn't save the question";
    if (!reply?.ok) ask.disabled = false;
  });
  pathSection.append(ask);
  if (slot && ctx.hostState === "ok") {
    const button = el("button", { class: "pn-secondary", type: "button", text: "Block 90 min before it's due" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      const reply = await send({
        type: "queue_suggestion",
        suggestion: { key: `${a.course_id}:${a.id}`, title: `Work on ${a.name}`, start: slot.start, end: slot.end, why: `Due ${formatDue(a.due_at)}` },
      });
      button.textContent = reply?.ok ? (reply.queued ? "Sent. Say yes to it in Kairos, on Week." : "Already in Kairos") : "Couldn't send it";
      if (!reply?.ok) button.disabled = false;
    });
    pathSection.append(button);
  }
  out.push(pathSection);
  return out;
}

/** Kairos runs on the student's own school Canvas only after they say so in Chrome's prompt. */
async function schoolOffer() {
  const school = await send({ type: "get_school" });
  if (!school?.ok || !school.base || school.enabled) return null;
  const host = new URL(school.base).hostname;
  const button = el("button", { class: "pn-primary", type: "button", text: `Use Kairos on ${host}` });
  const note = el("p", { class: "pn-note", text: "Chrome will ask once. Kairos reads that Canvas with your own sign-in and never posts or submits anything." });
  button.addEventListener("click", async () => {
    const granted = await chrome.permissions.request({ origins: [originPattern(school.base)] }).catch(() => false);
    if (!granted) {
      note.textContent = "Chrome didn't allow it. You can try again any time.";
      return;
    }
    const reply = await send({ type: "enable_school", base: school.base });
    note.textContent = reply?.ok ? "Done. Open Canvas and Kairos starts keeping an eye on it." : "That didn't take. Try again.";
    button.remove();
  });
  return el("section", {}, el("p", { class: "pn-label", text: school.name || "Your school" }), button, note);
}

async function homeView() {
  const view = await send({ type: "get_view" });
  const next = view?.dashboard?.next_step;
  const offer = await schoolOffer();
  const out = [offer, el("p", { class: "pn-label", text: "Next up" })];
  if (next) {
    out.push(el("h1", { class: "pn-title" }, link(next.title, next.url)));
    out.push(el("p", { class: "pn-sub", text: [next.course, next.due_at ? `due ${formatDue(next.due_at)}` : null].filter(Boolean).join(", ") }));
  } else {
    const title = view?.status?.needsSchool
      ? "Open your school's Canvas once"
      : view?.mode === "local"
        ? "Open the Kairos app on this Mac"
        : view?.mode === "pending"
          ? "Syncing your semester"
          : "Nothing due this week";
    out.push(el("h1", { class: "pn-title", text: title }));
  }
  if (next && view?.mode === "full") out.push(el("p", {}, el("a", { class: "pn-quiet", href: kairosItemLink(next.course_id, next.assignment_id), text: "Open in Kairos" })));
  out.push(el("p", { class: "pn-note", text: "Open an assignment, quiz, or graded discussion in Canvas to see its checklist, what changed, and the cost of skipping." }));
  return out.filter(Boolean);
}

let lastUrl = null;
async function refresh({ force = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tab?.url || "";
  if (url === lastUrl && !force) return;
  lastUrl = url;
  const work = workFromUrl(url);
  if (!force) main.replaceChildren(el("p", { class: "pn-note", text: "Loading…" }));
  main.replaceChildren(...(work ? await assignmentView(work) : await homeView()).filter(Boolean));
  const { last = {} } = await chrome.storage.local.get("last");
  statusEl.textContent = last.needsSchool
    ? "Open your school's Canvas in a tab"
    : last.signedIn === false
      ? "Signed out of Canvas"
      : last.lastPollAt
        ? `Checked ${relTime(last.lastPollAt)}`
        : "";
}


chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.status === "complete") refresh();
});
// A poll finished: show the new data without waiting for a tab change.
let pending = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.viewStamp) return;
  clearTimeout(pending);
  pending = setTimeout(() => refresh({ force: true }), 300);
});
send({ type: "funnel", event: "panel_open" });
send({ type: "panel_seen" });
refresh();
