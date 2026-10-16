/**
 * Canvas tokenized feeds: capture once with the SSO session, then watch
 * without any session.
 *
 * Feed URLs are bearer links (read-only, but anyone holding one can read that
 * stream), so they live only in {user_root}/auth/feeds.json (0600). State
 * keys are URL hashes so the watcher state never repeats a token.
 *
 * Verified 2026-09-29 against CU Boulder: feeds return 200 with no cookies,
 * ignore If-None-Match (always a full body), announcement feeds are 2–44 KB,
 * course feeds up to ~550 KB, the calendar ICS ~470 KB.
 */
import crypto from "node:crypto";
import { extractActions, htmlToText, normalizeTitle, previewText } from "./freshness/actions.mjs";
import { parseAtom, parseIcs } from "./freshness/feeds-parse.mjs";

export const FEED_CADENCE_MS = {
  announcements: 10 * 60 * 1000,
  content: 60 * 60 * 1000,
  ics: 60 * 60 * 1000,
};
/** Re-capture feed links weekly (new courses, reset tokens). */
export const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_LOOK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FEED_BYTES = 4 * 1024 * 1024;

const ANNOUNCEMENT_FEED_RE = /\/feeds\/announcements\/enrollment_[A-Za-z0-9-]+\.atom/;
const CONTENT_FEED_RE = /\/feeds\/courses\/enrollment_[A-Za-z0-9-]+\.atom/;

export function feedHash(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex").slice(0, 16);
}

export function captureIsStale(feeds, courseIds, { now = Date.now() } = {}) {
  if (!feeds?.captured_at) return true;
  if (now - Date.parse(feeds.captured_at) > CAPTURE_MAX_AGE_MS) return true;
  const known = new Set(Object.keys(feeds.courses || {}));
  return courseIds.some((id) => !known.has(String(id)));
}

/** Extract the per-enrollment feed paths from a Canvas course page's HTML. */
export function feedLinksFromHtml(html) {
  const text = String(html || "").replace(/&amp;/g, "&");
  return {
    announcements: (text.match(ANNOUNCEMENT_FEED_RE) || [])[0] || null,
    content: (text.match(CONTENT_FEED_RE) || [])[0] || null,
  };
}

async function pageGetText(page, pathname) {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: "include", headers: { Accept: "text/html" } });
    return { status: res.status, text: res.ok ? await res.text() : "" };
  }, pathname);
}

/**
 * Collect feed URLs with the live Canvas session (GET only).
 * @param {{ page, api, base: string, courses: { id, name }[], now?: number }} opts
 */
export async function captureFeeds({ page, api, base, courses, now = Date.now() }) {
  const out = { captured_at: new Date(now).toISOString(), base, ics: null, courses: {} };
  const profile = await api(page, "/api/v1/users/self/profile");
  if (profile.ok && profile.json?.calendar?.ics) out.ics = profile.json.calendar.ics;
  for (const course of courses) {
    const id = String(course.id);
    const entry = { name: course.name || course.course_code || id, announcements: null, content: null };
    for (const pathname of [`/courses/${id}/announcements`, `/courses/${id}`]) {
      if (entry.announcements && entry.content) break;
      const res = await pageGetText(page, pathname);
      if (res.status !== 200) continue;
      const links = feedLinksFromHtml(res.text);
      entry.announcements = entry.announcements || (links.announcements ? base + links.announcements : null);
      entry.content = entry.content || (links.content ? base + links.content : null);
    }
    out.courses[id] = entry;
  }
  return out;
}

/** Every feed the watcher knows about, with its cadence class. */
/** A feed URL the poller may request: https, no embedded credentials, and (when given) on that origin. */
function safeFeedUrl(url, origin = null) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:" || u.username || u.password) return false;
    return origin ? u.origin === origin : true;
  } catch {
    return false;
  }
}

export function feedList(feeds) {
  const list = [];
  let origin = null;
  try {
    origin = feeds?.base ? new URL(feeds.base).origin : null;
  } catch {
    origin = null;
  }
  if (feeds?.ics && safeFeedUrl(feeds.ics)) list.push({ url: feeds.ics, cls: "ics", course_id: null, course_name: null });
  for (const [id, c] of Object.entries(feeds?.courses || {})) {
    // Course feeds are captured from the student's own Canvas pages; never poll another host.
    if (c.announcements && safeFeedUrl(c.announcements, origin)) list.push({ url: c.announcements, cls: "announcements", course_id: id, course_name: c.name });
    if (c.content && safeFeedUrl(c.content, origin)) list.push({ url: c.content, cls: "content", course_id: id, course_name: c.name });
  }
  return list;
}

export function announcementEvents(entries, seen, feed, { baselined, now, detectedAt }) {
  const events = [];
  for (const e of entries) {
    const known = seen[e.id];
    seen[e.id] = e.updated || e.published || "";
    if (known !== undefined) continue;
    const at = e.published || e.updated;
    if (!baselined && Date.parse(at || 0) < now - FIRST_LOOK_MS) continue;
    const text = htmlToText(e.html);
    events.push({
      key: `announcement:${e.object_id || e.id}`,
      kind: "announcement",
      source: "feed",
      course_id: feed.course_id,
      course_name: feed.course_name,
      title: e.title || "Announcement",
      url: e.url,
      at: at ? new Date(Date.parse(at)).toISOString() : detectedAt,
      detected_at: detectedAt,
      // Keep a bounded-but-complete local body for action extraction, search,
      // and exam context. `preview` remains the compact UI field.
      detail: { preview: previewText(text), body: text.slice(0, 100_000) },
      actions: extractActions(text),
    });
  }
  return events;
}

function contentEvents(entries, seen, feed, { baselined, detectedAt }) {
  const events = [];
  for (const e of entries) {
    const known = seen[e.id];
    const stamp = e.updated || e.published || "";
    seen[e.id] = stamp;
    if (!baselined) continue;
    if (known === undefined && (e.type === "assignment" || e.type === "wiki_page")) {
      events.push({
        key: `content-added:${e.type}:${e.object_id || e.id}`,
        kind: e.type === "assignment" ? "assignment_added" : "page_updated",
        source: "feed",
        course_id: feed.course_id,
        course_name: feed.course_name,
        title: e.title,
        url: e.url,
        at: stamp ? new Date(Date.parse(stamp)).toISOString() : detectedAt,
        detected_at: detectedAt,
        group: e.type === "assignment" ? `added:${normalizeTitle(e.title)}` : undefined,
        detail: { new: true },
      });
    } else if (known !== undefined && known !== stamp && e.type === "wiki_page") {
      // Assignment <updated> moves on system touches (73 of 75 in one course),
      // so only page edits count here; assignment edits come from snapshot diffs.
      events.push({
        key: `page-updated:${e.object_id || e.id}:${stamp}`,
        kind: "page_updated",
        source: "feed",
        course_id: feed.course_id,
        course_name: feed.course_name,
        title: e.title,
        url: e.url,
        at: stamp ? new Date(Date.parse(stamp)).toISOString() : detectedAt,
        detected_at: detectedAt,
        detail: {},
      });
    }
  }
  return events;
}

/** Canvas ICS summaries read "HW 5 [APPM 1235-001]". */
export function splitIcsSummary(summary) {
  const m = String(summary || "").match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return m ? { title: m[1], course_name: m[2] } : { title: String(summary || ""), course_name: null };
}

function icsEvents(items, seen, { baselined, detectedAt }) {
  const events = [];
  for (const ev of items) {
    if (ev.kind !== "assignment" && ev.kind !== "assignment_override") continue;
    const known = seen[ev.uid];
    seen[ev.uid] = ev.start || "";
    if (!baselined) continue;
    const { title, course_name } = splitIcsSummary(ev.summary);
    const base = { source: "ics", course_id: null, course_name, title, url: ev.url, at: detectedAt, detected_at: detectedAt };
    if (known === undefined) {
      events.push({
        ...base,
        key: `ics-added:${ev.uid}`,
        kind: "assignment_added",
        group: `added:${normalizeTitle(title)}`,
        detail: { due_at: ev.start },
      });
    } else if (known !== (ev.start || "")) {
      events.push({
        ...base,
        key: `ics-due:${ev.uid}:${ev.start || "none"}`,
        kind: "due_changed",
        group: `due:${normalizeTitle(title)}`,
        detail: { from: known || null, to: ev.start || null },
      });
    }
  }
  return events;
}

async function fetchFeed(fetchImpl, url) {
  const res = await fetchImpl(url, { redirect: "follow", headers: { Accept: "application/atom+xml, text/calendar, */*" } });
  if (!res.ok) return { ok: false, status: res.status, text: "" };
  const declared = Number(res.headers?.get?.("content-length") || 0);
  if (declared > MAX_FEED_BYTES) return { ok: false, status: 413, text: "" };
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) return { ok: false, status: 413, text: "" };
  return { ok: true, status: res.status, text };
}

/**
 * Poll the feeds that are due. Each feed's first successful look is a
 * baseline (announcements from the last 7 days still surface).
 *
 * @returns {Promise<{ events: object[], state: object, polled: object[] }>}
 */
export async function pollFeeds({ feeds, state = {}, now = Date.now(), fetchImpl = fetch, force = false }) {
  const next = { ...state };
  const events = [];
  const polled = [];
  const detectedAt = new Date(now).toISOString();
  const list = feedList(feeds);
  const live = new Set(list.map((feed) => feedHash(feed.url)));
  for (const h of Object.keys(next)) if (!live.has(h)) delete next[h];
  for (const feed of list) {
    const h = feedHash(feed.url);
    const s = { seen: {}, ...(next[h] || {}) };
    if (!force && s.last_polled && now - Date.parse(s.last_polled) < FEED_CADENCE_MS[feed.cls]) continue;
    let res;
    try {
      res = await fetchFeed(fetchImpl, feed.url);
    } catch (e) {
      res = { ok: false, status: 0, text: "", error: String(e?.message || e).slice(0, 120) };
    }
    s.last_polled = detectedAt;
    polled.push({ cls: feed.cls, course_id: feed.course_id, status: res.status, ok: res.ok });
    if (!res.ok) {
      s.error = { status: res.status, at: detectedAt };
      next[h] = s;
      continue;
    }
    delete s.error;
    const baselined = Boolean(s.baselined_at);
    const seen = { ...s.seen };
    if (feed.cls === "announcements") {
      events.push(...announcementEvents(parseAtom(res.text), seen, feed, { baselined, now, detectedAt }));
    } else if (feed.cls === "content") {
      events.push(...contentEvents(parseAtom(res.text), seen, feed, { baselined, detectedAt }));
    } else {
      events.push(...icsEvents(parseIcs(res.text), seen, { baselined, detectedAt }));
    }
    s.seen = seen;
    s.baselined_at = s.baselined_at || detectedAt;
    next[h] = s;
  }
  return { events, state: next, polled };
}
