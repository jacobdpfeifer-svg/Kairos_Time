/**
 * Content script. On every Canvas page: tell the worker which Canvas this is.
 * On the Canvas dashboard: mount the Kairos stage above Canvas's own
 * dashboard (shadow DOM, so neither side's styles leak).
 *
 * Canvas-authored text (titles, announcement lines) is inserted with
 * textContent only — never as HTML.
 */
(async () => {
  const send = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? null : reply));
      } catch {
        resolve(null);
      }
    });

  send({ type: "hello" });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "get_selection") return false;
    sendResponse({ ok: true, text: (window.getSelection()?.toString() || "").trim().slice(0, 8000) });
    return true;
  });
  if (location.pathname !== "/" || document.getElementById("kairos-stage")) return;

  const fmt = await import(chrome.runtime.getURL("lib/format.js"));

  // @font-face does not apply inside shadow roots; declare unique families on the document.
  if (!document.getElementById("kairos-fonts")) {
    const faces = [
      ["PN Gabarito", "gabarito-latin-wght-normal.woff2", "400 900"],
      ["PN Caveat", "caveat-latin-wght-normal.woff2", "400 700"],
    ];
    const style = document.createElement("style");
    style.id = "kairos-fonts";
    style.textContent = faces
      .map(([family, file, weight]) => `@font-face{font-family:"${family}";src:url("${chrome.runtime.getURL(`fonts/${file}`)}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap;}`)
      .join("");
    document.head.appendChild(style);
  }

  const host = document.createElement("div");
  host.id = "kairos-stage";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyMotion = () => {
    if (motionQuery.matches) host.setAttribute("data-motion", "reduced");
    else host.removeAttribute("data-motion");
  };
  applyMotion();
  motionQuery.addEventListener("change", applyMotion);
  const root = host.attachShadow({ mode: "open" });
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("ui/dashboard.css");
  root.appendChild(css);
  const anchor = document.getElementById("dashboard") || document.getElementById("content") || document.body;
  anchor.prepend(host);

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
      const u = new URL(url, location.origin);
      return u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  }

  function link(text, url, cls) {
    const href = safeHref(url);
    return href ? el("a", { class: cls, href, text }) : el("span", { class: cls, text });
  }

  const { collapsed = false } = await chrome.storage.local.get("collapsed").catch(() => ({}));
  let isCollapsed = Boolean(collapsed);
  const stage = el("section", { class: "pn-stage", "aria-label": "Kairos", "data-collapsed": String(isCollapsed) });
  root.appendChild(stage);

  function meta(view) {
    const status = view?.status || {};
    const state = status.signedIn === false ? "signed-out" : status.signedIn ? "ok" : "unknown";
    const liveText =
      state === "signed-out"
        ? "Signed out. Sign in to Canvas to refresh."
        : status.lastPollAt
          ? `Checked ${fmt.relTime(status.lastPollAt)}`
          : "Checking Canvas";
    const refresh = el("button", { class: "pn-quiet", type: "button", text: "Refresh" });
    refresh.addEventListener("click", async (event) => {
      if (!event.isTrusted) return; // a Canvas page script cannot press Kairos buttons
      refresh.disabled = true;
      await send({ type: "poll_now" });
      await render();
    });
    const toggle = el("button", { class: "pn-quiet", type: "button", "aria-expanded": String(!isCollapsed), text: isCollapsed ? "Show" : "Hide" });
    toggle.addEventListener("click", () => {
      isCollapsed = !isCollapsed;
      stage.dataset.collapsed = String(isCollapsed);
      toggle.textContent = isCollapsed ? "Show" : "Hide";
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      chrome.storage.local.set({ collapsed: isCollapsed }).catch(() => {});
    });
    return el(
      "header",
      { class: "pn-meta" },
      el("img", {
        class: "pn-mark",
        src: chrome.runtime.getURL("brand/kairos-wordmark.svg"),
        alt: "kairos",
        width: "2552",
        height: "864",
      }),
      el("span", { class: "pn-live", "data-state": state, text: liveText }),
      el("span", { class: "pn-spacer" }),
      refresh,
      toggle
    );
  }

  function queueButton(label, suggestion, row) {
    const button = el("button", { class: "pn-secondary", type: "button", text: label });
    button.addEventListener("click", async (event) => {
      // The stage lives in the Canvas page (open shadow root): only the
      // student's own click may queue anything, never a synthetic page click.
      if (!event.isTrusted) return;
      button.disabled = true;
      const reply = await send({ type: "queue_suggestion", suggestion });
      if (reply?.ok) {
        button.textContent = reply.queued ? "Sent. Say yes to it in Kairos, on Week." : "Already in Kairos";
        if (row) row.dataset.state = "queued";
      } else {
        button.disabled = false;
        button.textContent = "Couldn't send it. Open the Kairos app on this Mac first.";
      }
    });
    return button;
  }

  function subject(view) {
    const next = view.dashboard?.next_step;
    if (view.mode === "pending") {
      return el(
        "div",
        { class: "pn-subject" },
        el("p", { class: "pn-label", text: "Next" }),
        el("h2", { class: "pn-title", text: "Syncing your semester" })
      );
    }
    if (view.mode === "local") {
      return el(
        "div",
        { class: "pn-subject" },
        el("p", { class: "pn-label", text: "Next" }),
        el("h2", { class: "pn-title", text: "Open the Kairos app on this Mac" }),
        el("p", { class: "pn-note", text: "Once it's open, your next step and what skipping costs show here. Changes below keep updating either way." })
      );
    }
    if (!next) {
      return el(
        "div",
        { class: "pn-subject" },
        el("p", { class: "pn-label", text: "Next" }),
        el("h2", { class: "pn-title", text: "Nothing due this week" })
      );
    }
    const sub = [next.course, next.due_at ? `due ${fmt.formatDue(next.due_at)}` : null, next.points_possible ? `${next.points_possible} pts` : null]
      .filter(Boolean)
      .join(", ");
    const cost = fmt.costLine(next.skip_cost);
    const slot = fmt.blockBefore(next.due_at);
    const actions = el("div", { class: "pn-actions" });
    if (safeHref(next.url)) actions.append(el("a", { class: "pn-primary", href: safeHref(next.url), text: "Open in Canvas" }));
    if (view.mode === "full") actions.append(el("a", { class: "pn-quiet", href: fmt.kairosItemLink(next.course_id, next.assignment_id), text: "Open in Kairos" }));
    if (slot) {
      actions.append(
        queueButton("Block 90 min", {
          key: `${next.course_id}:${next.assignment_id}`,
          title: `Work on ${next.title}`,
          start: slot.start,
          end: slot.end,
          why: `Due ${fmt.formatDue(next.due_at)}`,
        })
      );
    }
    // The extension checks Canvas every 5 minutes, but the next step comes from the app's last run.
    const generated = Date.parse(view.dashboard?.generated_at || "");
    const stale = Number.isFinite(generated) && Date.now() - generated > 6 * 60 * 60 * 1000;
    return el(
      "div",
      { class: "pn-subject" },
      stale ? el("p", { class: "pn-note", text: `Kairos last worked this out ${fmt.relTime(view.dashboard.generated_at)}. Open the app to bring it up to date.` }) : null,
      el("p", { class: "pn-label", text: next.why === "missing" ? "Missing" : "Next" }),
      el("h2", { class: "pn-title" }, link(next.title, next.url)),
      el("p", { class: "pn-sub", text: sub }),
      next.moved?.from ? el("p", { class: "pn-signal", text: `Due date moved. It was ${fmt.formatDue(next.moved.from)}.` }) : null,
      cost
        ? el(
            "p",
            { class: "pn-cost" },
            cost.share ? `Worth ${cost.share} of your grade. ` : "",
            "Skip it: ",
            el("strong", { text: cost.skip }),
            "Full marks: ",
            el("strong", { text: cost.full }),
            cost.estimate ? " (estimate)" : ""
          )
        : null,
      actions
    );
  }

  function ledger(view) {
    const changes = view.dashboard?.changes || [];
    const section = el("section", { class: "pn-ledger", "aria-label": "What changed" });
    section.append(el("p", { class: "pn-label", text: changes.length ? `What changed, ${changes.length}` : "What changed" }));
    if (!changes.length) {
      section.append(el("p", { class: "pn-empty", text: "Nothing new since you last looked." }));
      return section;
    }
    const list = el("ol");
    changes.forEach((c) => {
      const detail =
        c.kind === "due_changed" && c.detail?.to
          ? `now ${fmt.formatDue(c.detail.to)}`
          : c.kind === "graded" && c.detail?.score != null
            ? `${c.detail.score}${c.detail.points_possible ? ` / ${c.detail.points_possible}` : ""}`
            : null;
      list.append(
        el(
          "li",
          {},
          el(
            "span",
            { class: "pn-row-main" },
            el("span", { class: "pn-kind", text: c.label }),
            link(c.title || c.label, c.url, "pn-row-title"),
            el("span", { class: "pn-row-meta", text: [c.course, detail].filter(Boolean).join(", ") })
          ),
          el("span", { class: "pn-when", text: fmt.relTime(c.at || c.detected_at) })
        )
      );
    });
    section.append(list);
    return section;
  }

  function rail(view) {
    const digest = view.dashboard?.digest || { items: [], announcements_7d: 0, with_actions: 0 };
    const agent = view.dashboard?.agent_can_do || [];
    const railEl = el("div", { class: "pn-rail" });
    const d = el("section", { class: "pn-digest", "aria-label": "What your professors said" });
    d.append(
      el("p", {
        class: "pn-label",
        text: digest.announcements_7d ? `What professors said, ${digest.with_actions} of ${digest.announcements_7d} need you` : "What professors said",
      })
    );
    if (!digest.items.length) d.append(el("p", { class: "pn-empty", text: "No announcements with action items this week." }));
    for (const item of digest.items.slice(0, 4)) {
      d.append(
        el(
          "article",
          {},
          link(item.title, item.url, "pn-row-title"),
          el("span", { class: "pn-row-meta", text: [item.course, fmt.relTime(item.at)].filter(Boolean).join(", ") }),
          el("ul", {}, (item.actions || []).map((a) => el("li", { "data-kind": a.kind, text: a.text })))
        )
      );
    }
    railEl.append(d);
    if (agent.length) {
      const a = el("section", { class: "pn-agent", "aria-label": "Suggested for your calendar" });
      a.append(el("p", { class: "pn-label", text: "Suggested for your calendar" }));
      a.append(el("p", { class: "pn-note", text: "Nothing goes on your calendar until you say yes in Kairos." }));
      for (const item of agent) {
        const row = el("div", { class: "pn-agent-row" }, el("span", { text: item.label }));
        row.append(queueButton("Send to Kairos", item.suggestion, row));
        a.append(row);
      }
      railEl.append(a);
    }
    return railEl;
  }

  let rendering = false;
  async function render() {
    if (rendering) return;
    rendering = true;
    try {
      const view = await send({ type: "get_view" });
      if (!view || !view.dashboard) {
        stage.replaceChildren(meta(null), el("div", { class: "pn-body" }, el("p", { class: "pn-empty", text: "Checking Canvas…" })));
        return;
      }
      stage.replaceChildren(meta(view), el("div", { class: "pn-body" }, subject(view), ledger(view), rail(view)));
    } finally {
      rendering = false;
    }
  }

  await render();
  send({ type: "funnel", event: "dashboard_view" });
  let timer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.viewStamp) return;
    clearTimeout(timer);
    timer = setTimeout(render, 300);
  });
})();
